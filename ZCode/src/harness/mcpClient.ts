/**
 * MCP stdio client (P1.3 minimal subset) — JSON-RPC 2.0 over a child process's
 * stdio, newline-delimited as the MCP spec requires.
 *
 * Scope is deliberately small: `initialize` handshake + initialized
 * notification, `tools/list` (cursor-following), `tools/call`, and
 * `notifications/cancelled` when a request is aborted or times out. Server
 * notifications (tools/list_changed, logging, roots, sampling) are ignored —
 * a reconnect reuses the tool list discovered at session start.
 *
 * Process model (v1 boundary): the server is a NODE SCRIPT. The launcher is
 * the fixed literal program `node`; the operator's settings only supply the
 * script path and its arguments, which are passed as an argv array with
 * `shell: false` — no shell ever re-parses the configured words (same pattern
 * as tools/bash.ts). Arbitrary executables (uvx/python/docker/…) are a P2
 * item gated on the project security policy's binary allowlist.
 *
 * Safety posture (roadmap P1.3 gate: the main loop must never be blocked by a
 * server):
 * - every request has a deadline; expiry cancels (best-effort) and rejects;
 * - a server crash rejects pending requests immediately and is visible as a
 *   model-visible error; the NEXT call may reconnect (bounded restart budget,
 *   after which the client is disabled for the session);
 * - stderr is drained into a bounded tail (never blocks the child), and
 *   malformed stdout lines are counted and skipped, never fatal.
 */

import { spawn, type ChildProcess } from 'node:child_process'

/** Oldest protocol version we speak; the others are accepted on handshake. */
export const MCP_PROTOCOL_VERSION = '2024-11-05'
const ACCEPTED_PROTOCOL_VERSIONS: readonly string[] = Object.freeze([
  '2024-11-05',
  '2025-03-26',
  '2025-06-18',
])

export const MCP_HANDSHAKE_TIMEOUT_MS = 10_000
/** Default per-call deadline; the tool adapter exposes it as its contract. */
export const MCP_REQUEST_TIMEOUT_MS = 30_000
/** Reconnect budget per client lifetime (crash → next call may respawn). */
export const MCP_MAX_RESTARTS = 2

const MAX_STDERR_TAIL_BYTES = 8 * 1024
/** A single stdout line larger than this is dropped (runaway server guard). */
const MAX_LINE_BYTES = 4 * 1024 * 1024

export type McpFailureKind =
  | 'start_failed'
  | 'timeout'
  | 'aborted'
  | 'exited'
  | 'protocol'
  | 'disposed'
  | 'restart_exhausted'

export class McpClientError extends Error {
  readonly kind: McpFailureKind
  readonly serverName: string

  constructor(kind: McpFailureKind, serverName: string, message: string) {
    super(message)
    this.name = 'McpClientError'
    this.kind = kind
    this.serverName = serverName
  }
}

export interface McpClientOptions {
  serverName: string
  /** Path to the MCP server's Node script (.js/.mjs/.cjs). */
  script: string
  /** Extra CLI arguments for the server script (config-supplied, verbatim). */
  args?: readonly string[]
  env?: Readonly<Record<string, string>>
  cwd?: string
  handshakeTimeoutMs?: number
  requestTimeoutMs?: number
  maxRestarts?: number
}

export interface McpToolInfo {
  name: string
  description?: string
  inputSchema?: unknown
}

export interface McpCallOptions {
  signal?: AbortSignal
  timeoutMs?: number
}

export interface McpCallResult {
  content: string
  isError: boolean
}

interface McpResponse {
  result?: unknown
  error?: { code?: number; message?: string } | null
}

interface RequestOptions {
  timeoutMs: number
  signal?: AbortSignal
}

export interface McpClient {
  readonly serverName: string
  /** The underlying process is running and completed the MCP handshake. */
  readonly alive: boolean
  listTools(signal?: AbortSignal): Promise<McpToolInfo[]>
  callTool(toolName: string, args: unknown, options?: McpCallOptions): Promise<McpCallResult>
  /** Kill the server process and make the client permanently unusable. */
  dispose(): void
}

export function startMcpClient(options: McpClientOptions): Promise<McpClient> {
  const client = new StdioMcpClient(options)
  return client.start().then(
    () => client,
    error => {
      // A failed handshake must not leak the half-started server process.
      client.dispose()
      throw error
    },
  )
}

class StdioMcpClient implements McpClient {
  private readonly options: McpClientOptions
  /** Launch target fixed at construction: the argv handed to the fixed `node`
   * program — script first, then the configured extra arguments verbatim. */
  private readonly launch: { script: string; argv: string[] }
  private child: ChildProcess | null = null
  private ready = false
  private running = false
  private disposed = false
  private disabled = false
  private restartsUsed = 0
  private nextId = 0
  private readonly pending = new Map<number, PendingEntry>()
  private startup: Promise<void> | null = null
  private stderrTail = ''
  private malformedLines = 0
  private exitHook: (() => void) | null = null
  private stdoutBuffer: Buffer = Buffer.alloc(0)

  constructor(options: McpClientOptions) {
    this.options = options
    this.launch = { script: options.script, argv: [...(options.args ?? [])] }
  }

  get serverName(): string {
    return this.options.serverName
  }

  get alive(): boolean {
    return this.running && this.ready && !this.disposed
  }

  start(): Promise<void> {
    if (this.startup) return this.startup
    this.startup = this.spawnAndHandshake()
    return this.startup
  }

  async listTools(signal?: AbortSignal): Promise<McpToolInfo[]> {
    const tools: McpToolInfo[] = []
    let cursor: string | undefined
    do {
      const page = (await this.request('tools/list', cursor ? { cursor } : {}, {
        timeoutMs: this.options.requestTimeoutMs ?? MCP_REQUEST_TIMEOUT_MS,
        signal,
      })) as { tools?: unknown; nextCursor?: unknown }
      if (Array.isArray(page.tools)) {
        for (const entry of page.tools) {
          if (!entry || typeof entry !== 'object') continue
          const name = (entry as { name?: unknown }).name
          if (typeof name !== 'string') continue
          const description = (entry as { description?: unknown }).description
          const inputSchema = (entry as { inputSchema?: unknown }).inputSchema
          tools.push({
            name,
            ...(typeof description === 'string' && description.trim() !== ''
              ? { description }
              : {}),
            ...(inputSchema !== undefined ? { inputSchema } : {}),
          })
        }
      }
      cursor =
        typeof page.nextCursor === 'string' && page.nextCursor !== '' ? page.nextCursor : undefined
    } while (cursor)
    return tools
  }

  async callTool(
    toolName: string,
    args: unknown,
    options: McpCallOptions = {},
  ): Promise<McpCallResult> {
    const result = (await this.request(
      'tools/call',
      { name: toolName, arguments: args ?? {} },
      {
        timeoutMs: options.timeoutMs ?? this.options.requestTimeoutMs ?? MCP_REQUEST_TIMEOUT_MS,
        signal: options.signal,
      },
    )) as { content?: unknown; structuredContent?: unknown; isError?: unknown }

    const parts = Array.isArray(result.content) ? result.content : []
    const texts: string[] = []
    for (const part of parts) {
      const record =
        part && typeof part === 'object' ? (part as { type?: unknown; text?: unknown }) : null
      if (record && record.type === 'text' && typeof record.text === 'string') {
        texts.push(record.text)
      } else {
        const kind = record ? String(record.type) : 'unknown'
        texts.push(`[${kind} content omitted]`)
      }
    }
    let content = texts.join('\n')
    if (content === '' && result.structuredContent !== undefined) {
      try {
        content = JSON.stringify(result.structuredContent, null, 2)
      } catch {
        content = ''
      }
    }
    return { content, isError: result.isError === true }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.ready = false
    this.rejectAllPending(
      new McpClientError('disposed', this.options.serverName, 'MCP client disposed'),
    )
    this.unregisterExitHook()
    this.killChild()
  }

  // ── internals ──

  private async request(method: string, params: unknown, options: RequestOptions): Promise<unknown> {
    if (this.disposed) {
      throw new McpClientError('disposed', this.options.serverName, 'MCP client is disposed')
    }
    if (this.disabled) {
      throw new McpClientError(
        'restart_exhausted',
        this.options.serverName,
        `MCP server "${this.options.serverName}" exhausted its reconnect budget ` +
          `(${this.options.maxRestarts ?? MCP_MAX_RESTARTS}) — its tools are unavailable for this session`,
      )
    }
    if (!this.running || !this.ready) {
      await this.ensureReady()
    }
    return this.sendRequest(method, params, options)
  }

  private ensureReady(): Promise<void> {
    if (this.running && this.ready) return Promise.resolve()
    // A start/restart already in flight is shared; it self-clears when it
    // settles, so a crash later falls through to a bounded fresh attempt.
    if (this.startup) return this.startup
    return this.beginRestart(null)
  }

  private beginRestart(previousError: unknown): Promise<void> {
    const budget = this.options.maxRestarts ?? MCP_MAX_RESTARTS
    if (this.disposed || this.disabled) {
      return Promise.reject(
        new McpClientError(
          this.disposed ? 'disposed' : 'restart_exhausted',
          this.options.serverName,
          `MCP server "${this.options.serverName}" is unavailable: ` +
            (previousError instanceof Error ? previousError.message : String(previousError ?? 'not running')),
        ),
      )
    }
    if (this.restartsUsed >= budget) {
      this.disabled = true
      return Promise.reject(
        new McpClientError(
          'restart_exhausted',
          this.options.serverName,
          `MCP server "${this.options.serverName}" exhausted its reconnect budget (${budget}) — ` +
            'its tools are unavailable for this session',
        ),
      )
    }
    this.restartsUsed += 1
    this.startup = this.spawnAndHandshake()
    return this.startup
  }

  private spawnAndHandshake(): Promise<void> {
    const { serverName } = this.options
    const child: ChildProcess = spawn('node', [this.launch.script, ...this.launch.argv], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...(this.options.env ?? {}) },
      ...(this.options.cwd ? { cwd: this.options.cwd } : {}),
      windowsHide: true,
      // argv-array semantics with a fixed program: the script path and extra
      // arguments are passed verbatim — no shell re-parses them.
      shell: false,
    })
    this.child = child
    this.running = true
    this.ready = false
    this.stdoutBuffer = Buffer.alloc(0)
    this.registerExitHook()

    child.stdin?.on('error', () => {
      // EPIPE when the child dies mid-write: the exit handler reports it.
    })
    child.stdout?.on('data', (chunk: Buffer) => this.consumeStdout(chunk))
    child.stderr?.on('data', (chunk: Buffer) => {
      this.stderrTail = `${this.stderrTail}${chunk.toString('utf8')}`.slice(-MAX_STDERR_TAIL_BYTES)
    })

    // Persistent per-child crash wiring: a server that dies at ANY point
    // (before or after the handshake) must surface immediately — pending
    // requests reject, and the next call may reconnect (bounded budget).
    child.on('exit', (code, signalName) => {
      const failure = new McpClientError(
        'exited',
        serverName,
        `MCP server "${serverName}" exited ` +
          `(${code === null ? `signal ${signalName}` : `code ${code}`})` +
          this.stderrSuffix(),
      )
      this.handleChildFailure(failure)
    })
    child.on('error', error => {
      this.handleChildFailure(
        new McpClientError('start_failed', serverName, `spawn failed: ${describe(error)}`),
      )
    })

    const handshake = (async () => {
      const response = (await this.sendRequest(
        'initialize',
        {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: {} },
          clientInfo: { name: 'zcode-cli-agent', version: '0.0.0' },
        },
        { timeoutMs: this.options.handshakeTimeoutMs ?? MCP_HANDSHAKE_TIMEOUT_MS },
      )) as { protocolVersion?: unknown }
      const version = response.protocolVersion
      if (typeof version !== 'string' || !ACCEPTED_PROTOCOL_VERSIONS.includes(version)) {
        throw new McpClientError(
          'start_failed',
          serverName,
          `server speaks protocol version ${String(version)}, this client accepts ` +
            ACCEPTED_PROTOCOL_VERSIONS.join(' / '),
        )
      }
      this.notify('notifications/initialized')
      this.ready = true
    })()

    // The in-flight startup is shared by concurrent ensureReady() callers and
    // self-clears when settled, so a later crash falls through to the bounded
    // reconnect path instead of consulting a stale resolved promise.
    this.startup = handshake
    void handshake
      .finally(() => {
        if (this.startup === handshake) this.startup = null
      })
      // The caller of start()/beginRestart() owns the rejection; this derived
      // promise only performs the cleanup above.
      .catch(() => {})
    return handshake
  }

  private sendRequest(method: string, params: unknown, options: RequestOptions): Promise<unknown> {
    if (!this.child || !this.running || !this.child.stdin?.writable) {
      return Promise.reject(
        new McpClientError(
          'exited',
          this.options.serverName,
          `MCP server "${this.options.serverName}" is not running` + this.stderrSuffix(),
        ),
      )
    }

    const id = ++this.nextId
    const message = { jsonrpc: '2.0' as const, id, method, params }
    const payload = `${JSON.stringify(message)}\n`

    return new Promise<unknown>((resolve, reject) => {
      let timer: NodeJS.Timeout | null = null
      const cleanup = (): void => {
        if (timer) clearTimeout(timer)
        options.signal?.removeEventListener('abort', onAbort)
        this.pending.delete(id)
      }
      const settle = (response: McpResponse): void => {
        cleanup()
        if (response.error) {
          reject(
            new McpClientError(
              'protocol',
              this.options.serverName,
              `MCP server rejected "${method}" (code ${response.error.code ?? 'unknown'}): ` +
                `${response.error.message ?? 'no message'}`,
            ),
          )
        } else {
          resolve(response.result)
        }
      }
      const fail = (error: McpClientError): void => {
        cleanup()
        reject(error)
      }
      const onAbort = (): void => {
        const reason = options.signal?.reason
        cleanup()
        this.notify('notifications/cancelled', { requestId: id })
        reject(
          new McpClientError(
            kindOfAbortReason(reason),
            this.options.serverName,
            `MCP request "${method}" was aborted: ${describe(reason ?? 'aborted')}`,
          ),
        )
      }

      this.pending.set(id, { settle, fail })
      if (options.signal) {
        if (options.signal.aborted) {
          this.pending.delete(id)
          onAbort()
          return
        }
        options.signal.addEventListener('abort', onAbort, { once: true })
      }
      timer = setTimeout(() => {
        cleanup()
        this.notify('notifications/cancelled', { requestId: id })
        reject(
          new McpClientError(
            'timeout',
            this.options.serverName,
            `MCP request "${method}" timed out after ${options.timeoutMs}ms`,
          ),
        )
      }, options.timeoutMs)

      try {
        this.child?.stdin?.write(payload)
      } catch (error) {
        cleanup()
        reject(
          new McpClientError(
            'exited',
            this.options.serverName,
            `MCP server "${this.options.serverName}" is not accepting input: ${describe(error)}`,
          ),
        )
      }
    })
  }

  private notify(method: string, params?: unknown): void {
    const stdin = this.child?.stdin
    if (!stdin?.writable) return
    try {
      const message: Record<string, unknown> = { jsonrpc: '2.0', method }
      if (params !== undefined) message.params = params
      stdin.write(`${JSON.stringify(message)}\n`)
    } catch {
      // Notifications are best-effort; the exit handler reports real failures.
    }
  }

  private consumeStdout(chunk: Buffer): void {
    this.stdoutBuffer =
      this.stdoutBuffer.length === 0 ? chunk : Buffer.concat([this.stdoutBuffer, chunk])
    for (;;) {
      const newline = this.stdoutBuffer.indexOf(0x0a)
      if (newline === -1) break
      const line = this.stdoutBuffer.subarray(0, newline)
      this.stdoutBuffer = this.stdoutBuffer.subarray(newline + 1)
      this.handleLine(line.toString('utf8'))
    }
    if (this.stdoutBuffer.length > MAX_LINE_BYTES) {
      // No newline in sight: drop the buffer rather than grow without bound.
      this.stdoutBuffer = Buffer.alloc(0)
      this.malformedLines += 1
    }
  }

  private handleLine(line: string): void {
    const trimmed = line.trim()
    if (trimmed === '') return
    let message: unknown
    try {
      message = JSON.parse(trimmed)
    } catch {
      this.malformedLines += 1
      return
    }
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      this.malformedLines += 1
      return
    }
    const record = message as {
      id?: unknown
      method?: unknown
      result?: unknown
      error?: { code?: number; message?: string } | null
    }
    // Notifications and server→client requests are out of the minimal subset.
    if (typeof record.method === 'string') return
    if (record.id === undefined || record.id === null) return
    const id = record.id as number
    const entry = this.pending.get(id)
    if (!entry) return
    this.pending.delete(id)
    entry.settle({ result: record.result, error: record.error ?? null })
  }

  private handleChildFailure(failure: McpClientError): void {
    this.running = false
    this.ready = false
    this.unregisterExitHook()
    this.rejectAllPending(failure)
  }

  private rejectAllPending(error: McpClientError): void {
    for (const entry of this.pending.values()) {
      entry.fail(error)
    }
    this.pending.clear()
  }

  private stderrSuffix(): string {
    const tail = this.stderrTail.trim()
    return tail === '' ? '' : ` — stderr: ${tail.slice(-400)}`
  }

  private killChild(): void {
    const child = this.child
    if (!child || child.exitCode !== null) return
    try {
      child.stdin?.end()
      child.kill()
    } catch {
      // Already gone.
    }
  }

  private registerExitHook(): void {
    this.unregisterExitHook()
    this.exitHook = (): void => this.killChild()
    process.once('exit', this.exitHook)
  }

  private unregisterExitHook(): void {
    if (this.exitHook) {
      process.removeListener('exit', this.exitHook)
      this.exitHook = null
    }
  }
}

function kindOfAbortReason(reason: unknown): McpFailureKind {
  return reason instanceof Error && reason.name === 'ToolTimeoutError' ? 'timeout' : 'aborted'
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

interface PendingEntry {
  settle: (response: McpResponse) => void
  /** Transport-level failure (crash/dispose): keeps the McpClientError kind. */
  fail: (error: McpClientError) => void
}
