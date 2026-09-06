import { lookup } from 'node:dns/promises'
import type { ToolContext, ToolDefinition, ToolResult } from '../types.ts'

const DEFAULT_MAX_CHARS = 20_000
const MAX_BYTES = 512 * 1024
const TIMEOUT_MS = 15_000
const MAX_REDIRECTS = 3

/**
 * WebFetch — retrieves a public web page and returns readable text.
 *
 * Safety posture:
 * - http/https only, no credentials in the URL.
 * - SSRF guard: the host must resolve to a public address (loopback, RFC1918,
 *   link-local, CGNAT, and IPv6 site-local/link-local are rejected) and every
 *   redirect hop is re-validated.
 * - Hard byte cap and timeout; cancellation is honored via context.signal.
 * - Read-only: it never touches the workspace, but note the URL itself is
 *   model-chosen egress.
 */

/** True for addresses that must never be fetched from the sandbox. */
export function isPrivateAddress(address: string): boolean {
  const v4 = address.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (v4) {
    const octets = v4.slice(1).map(Number)
    if (octets.some(value => value > 255)) return true
    const [a, b] = octets
    if (a === 0 || a === 10 || a === 127) return true
    if (a === 169 && b === 254) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 100 && b >= 64 && b <= 127) return true
    return false
  }
  const lower = address.toLowerCase()
  if (lower === '::1' || lower === '::') return true
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true // fc00::/7 unique local
  if (/^fe[89ab]/.test(lower)) return true // fe80::/10 link-local
  const mapped = lower.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)
  if (mapped) return isPrivateAddress(mapped[1])
  return false
}

export interface WebFetchDeps {
  /** DNS resolution; injectable for tests. */
  lookup?: typeof lookup
  /** Private-address classifier; injectable for tests. */
  isPrivateAddress?: typeof isPrivateAddress
  /** Fetch implementation; injectable for tests. */
  fetchImpl?: typeof fetch
}

function privateHostError(hostname: string): ToolResult {
  return {
    content:
      `Error: refusing to fetch "${hostname}" — private, link-local, and loopback ` +
      'addresses are not reachable from WebFetch. Only public documentation/web pages.',
    isError: true,
  }
}

async function validatePublicHost(
  hostname: string,
  deps: Required<Pick<WebFetchDeps, 'lookup' | 'isPrivateAddress'>>,
): Promise<string | null> {
  const lower = hostname.toLowerCase()
  if (lower === 'localhost' || lower.endsWith('.localhost') || lower.endsWith('.local')) {
    return lower
  }
  let addresses
  try {
    addresses = await deps.lookup(lower, { all: true })
  } catch {
    return lower // unresolvable: let fetch surface the real error
  }
  for (const entry of addresses) {
    if (deps.isPrivateAddress(entry.address)) return lower
  }
  return null
}

/** Minimal HTML → text: drops script/style/comments, keeps line structure, decodes entities. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript\s*>/gi, ' ')
    .replace(/<\/(p|div|section|article|header|footer|li|tr|h[1-6]|blockquote|pre|table)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

interface FetchOutcome {
  status: number
  contentType: string
  bodyText: string
  truncatedBytes: boolean
  /** Raw `location` header for redirect responses. */
  location: string | null
}

async function fetchAndRead(
  url: string,
  signal: AbortSignal,
  deps: Required<Pick<WebFetchDeps, 'fetchImpl'>>,
): Promise<FetchOutcome> {
  const response = await deps.fetchImpl(url, {
    signal,
    redirect: 'manual',
    headers: {
      // Identify the agent honestly; many documentation sites require a UA.
      'user-agent': 'ZCode-WebFetch/1.5 (CLI coding agent; fetches pages on user request)',
      accept: 'text/html, text/plain, application/json;q=0.9, */*;q=0.5',
    },
  })

  const contentType = response.headers.get('content-type') ?? ''
  const location = response.headers.get('location')
  let bytes = 0
  let truncated = false
  const decoder = new TextDecoder('utf-8', { fatal: false })
  const parts: string[] = []
  const reader = response.body?.getReader()
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes >= MAX_BYTES) {
        parts.push(decoder.decode(value.slice(0, value.byteLength - (bytes - MAX_BYTES)), { stream: true }))
        truncated = true
        void reader.cancel().catch(() => {})
        break
      }
      parts.push(decoder.decode(value, { stream: true }))
    }
    parts.push(decoder.decode())
  }
  return {
    status: response.status,
    contentType,
    bodyText: parts.join(''),
    truncatedBytes: truncated,
    location,
  }
}

export async function executeWebFetch(
  input: unknown,
  context: ToolContext,
  deps: WebFetchDeps = {},
): Promise<ToolResult> {
  const merged: Required<WebFetchDeps> = {
    lookup: deps.lookup ?? lookup,
    isPrivateAddress: deps.isPrivateAddress ?? isPrivateAddress,
    fetchImpl: deps.fetchImpl ?? fetch,
  }

  const params = (input ?? {}) as { url?: unknown; max_chars?: unknown }
  if (typeof params.url !== 'string' || params.url.trim() === '') {
    return { content: 'Error: url is required', isError: true }
  }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(params.url.trim())
  } catch {
    return { content: `Error: invalid URL: ${params.url}`, isError: true }
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return {
      content: `Error: only http and https URLs are supported (got ${parsedUrl.protocol})`,
      isError: true,
    }
  }
  if (parsedUrl.username !== '' || parsedUrl.password !== '') {
    return { content: 'Error: URLs with embedded credentials are not supported', isError: true }
  }

  const maxChars =
    Number.isFinite(params.max_chars) && (params.max_chars as number) >= 200
      ? Math.min(Math.floor(params.max_chars as number), 100_000)
      : DEFAULT_MAX_CHARS

  // ── Cancellation + timeout wiring ──
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error(`timed out after ${TIMEOUT_MS} ms`)), TIMEOUT_MS)
  const onExternalAbort = () => controller.abort(new Error('cancelled'))
  if (context.signal) {
    if (context.signal.aborted) {
      clearTimeout(timer)
      return { content: 'Error: cancelled', isError: true }
    }
    context.signal.addEventListener('abort', onExternalAbort, { once: true })
  }

  try {
    let currentUrl = parsedUrl
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const blockedHost = await validatePublicHost(currentUrl.hostname, merged)
      if (blockedHost) return privateHostError(blockedHost)

      const outcome = await fetchAndRead(currentUrl.toString(), controller.signal, merged)

      if (outcome.status >= 300 && outcome.status < 400) {
        const location = outcome.location ?? ''
        if (location === '') {
          return { content: `Error: HTTP ${outcome.status} redirect without a location header`, isError: true }
        }
        if (hop === MAX_REDIRECTS) {
          return { content: `Error: too many redirects (more than ${MAX_REDIRECTS})`, isError: true }
        }
        let next: URL
        try {
          next = new URL(location, currentUrl)
        } catch {
          return { content: `Error: redirect to an invalid URL: ${location}`, isError: true }
        }
        if (next.protocol !== 'http:' && next.protocol !== 'https:') {
          return { content: `Error: redirect to a non-http(s) URL: ${next.protocol}`, isError: true }
        }
        currentUrl = next
        continue
      }

      if (outcome.status < 200 || outcome.status >= 300) {
        return {
          content: `Error: HTTP ${outcome.status} from ${currentUrl.toString()}`,
          isError: true,
        }
      }

      if (outcome.bodyText.includes('\u0000')) {
        return { content: `Error: binary content is not supported: ${currentUrl.toString()}`, isError: true }
      }

      const isHtml = /text\/html|application\/xhtml/i.test(outcome.contentType)
      const text = isHtml ? htmlToText(outcome.bodyText) : outcome.bodyText.trim()
      if (text === '') {
        return { content: `Error: page returned no readable text: ${currentUrl.toString()}`, isError: true }
      }

      const notes: string[] = []
      if (text.length > maxChars) {
        notes.push(`truncated to ${maxChars} of ${text.length} characters — raise max_chars or fetch a more specific page`)
      }
      if (outcome.truncatedBytes) {
        notes.push(`response exceeded ${MAX_BYTES} bytes and was cut off`)
      }
      const body = text.slice(0, maxChars)
      const footer = notes.length > 0 ? `\n\n[${notes.join('; ')}]` : ''
      return {
        content: `Fetched ${currentUrl.toString()} (HTTP ${outcome.status}, ${isHtml ? 'html→text' : outcome.contentType || 'unknown type'}):\n\n${body}${footer}`,
      }
    }
    return { content: `Error: too many redirects (more than ${MAX_REDIRECTS})`, isError: true }
  } catch (error) {
    if (controller.signal.aborted) {
      const reason = controller.signal.reason instanceof Error ? controller.signal.reason.message : 'cancelled'
      return { content: `Error: fetch aborted (${reason})`, isError: true }
    }
    return {
      content: `Error: fetch failed: ${error instanceof Error ? error.message : String(error)}`,
      isError: true,
    }
  } finally {
    clearTimeout(timer)
    context.signal?.removeEventListener('abort', onExternalAbort)
  }
}

export function createWebFetchTool(): ToolDefinition {
  return {
    name: 'WebFetch',
    description:
      'Fetches a public web page over http(s) and returns readable text (HTML is stripped; ' +
      'JSON/plain text passes through). Use it to consult official documentation, API references, ' +
      'and public issue threads when local files are not enough. Limits: public addresses only ' +
      '(loopback/private/intranet hosts are refused), response capped at 512 KB, text truncated ' +
      'to max_chars (default 20000), follows up to 3 redirects. It cannot authenticate, so ' +
      'login-walled pages will not work.',
    readOnly: true,
    version: 1,
    sideEffect: 'network',
    cancellable: true,
    timeoutMs: 30_000,
    outputLimitBytes: 1_000_000,
    idempotent: true,
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Absolute http(s) URL to fetch' },
        max_chars: {
          type: 'number',
          description: 'Maximum characters of text to return (default 20000, max 100000)',
        },
      },
      required: ['url'],
    },
    execute: executeWebFetch,
  }
}
