/**
 * Harness core types — provider-agnostic message, tool, and loop contracts.
 *
 * Wire-format specifics (OpenAI vs Anthropic) live in translate.ts; the loop
 * and tools only ever see the shapes in this file.
 */

export type ToolCallId = string

/** A tool invocation requested by the model. */
export interface ToolCall {
  id: ToolCallId | null
  name: string
  input: unknown
}

/** One conversation turn, in provider-agnostic form. */
export type ChatMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; text: string | null; toolCalls: ToolCall[] }
  | {
      role: 'tool'
      toolCallId: ToolCallId
      toolName: string
      content: string
      isError?: boolean
    }

/** JSON-schema object describing a tool's input. */
export type JsonSchemaObject = {
  type: 'object'
  properties?: Record<string, unknown>
  required?: string[]
  [key: string]: unknown
}

/** Result returned by a tool execution. */
export interface ToolResult {
  content: string
  isError?: boolean
}

/** Execution context handed to tools by the loop. */
export interface ToolContext {
  cwd: string
  /** Session-scoped state shared between tool executions (e.g. files read). */
  state: ToolSessionState
  signal?: AbortSignal
  /**
   * Workspace boundary for the file tools. When present, paths outside the
   * roots are rejected (secure-by-default: the loop always provides one
   * unless the embedder explicitly disables it).
   */
  boundary?: import('./boundary.ts').WorkspaceBoundary
}

export interface ToolSessionState {
  /** Absolute paths read via the Read tool this session (Edit/Write precondition). */
  readFiles: Set<string>
  /** Current task list from the TodoWrite tool (session-scoped, not persisted across resume). */
  todos?: TodoItem[]
}

export type TodoStatus = 'pending' | 'in_progress' | 'completed'

export interface TodoItem {
  content: string
  status: TodoStatus
}

export interface ToolDefinition {
  name: string
  description: string
  inputSchema: JsonSchemaObject
  /** Read-only tools run in Plan mode without approval. */
  readOnly: boolean
  execute(input: unknown, context: ToolContext): Promise<ToolResult> | ToolResult
}

export type PermissionMode = 'plan' | 'agent' | 'yolo'

/** Async y/n approval callback used by Agent mode for non-read-only tools. */
export type ConfirmHandler = (request: {
  toolName: string
  input: unknown
  reason: string
}) => Promise<boolean> | boolean

export interface UsageSummary {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

export type StopReason =
  | 'end_turn'
  | 'max_turns'
  | 'budget_exceeded'
  | 'aborted'
  | 'error'

export type LoopEvent =
  | { type: 'session_start'; sessionId: string; cwd: string; model: string | null; permissionMode: PermissionMode }
  | { type: 'turn_start'; turn: number }
  | { type: 'text_delta'; text: string }
  | { type: 'reasoning_delta'; text: string }
  | { type: 'assistant_message'; text: string | null; toolCalls: ToolCall[] }
  | { type: 'permission_request'; toolCallId: string; name: string; input: unknown }
  | { type: 'permission_denied'; toolCallId: string; name: string; input: unknown; reason: string }
  | { type: 'tool_execution_start'; toolCallId: string; name: string; input: unknown }
  | {
      type: 'tool_execution_end'
      toolCallId: string
      name: string
      isError: boolean
      durationMs: number
      preview: string
    }
  | { type: 'turn_end'; turn: number; usage: UsageSummary }
  | {
      type: 'context_compact'
      ok: boolean
      summarizedMessages: number
      keptMessages: number
      message: string | null
    }
  | { type: 'provider_retry'; attempt: number; message: string }
  | { type: 'loop_end'; stopReason: StopReason; turns: number; usage: UsageSummary }

/** A tool call executed during the loop, for reporting in the JSON envelope. */
export interface ExecutedToolCall {
  toolCallId: string
  name: string
  input: unknown
  result: string
  isError: boolean
  durationMs: number
}

export interface AgentLoopResult {
  sessionId: string
  stopReason: StopReason
  /** Final assistant text (empty when the loop stopped on guardrails/errors). */
  text: string
  /** Full transcript of the conversation, provider-agnostic. */
  messages: ChatMessage[]
  toolCalls: ExecutedToolCall[]
  usage: UsageSummary
  turns: number
  /** Successful auto-compactions performed during this run. */
  compactions: number
  finishReason: string | null
  error: string | null
  /**
   * Non-fatal problems the caller must surface (e.g. transcript persistence
   * failed). Empty when nothing noteworthy happened during the run.
   */
  warnings: string[]
}

/** Provider duck-type used by the loop (subset of the public provider adapter). */
export interface LoopProvider {
  id: string
  kind?: string
  streamChat(input: Record<string, unknown>): AsyncIterable<ProviderStreamEvent>
}

export type ProviderStreamEvent =
  | { type: 'response_start'; messageId: string | null; model: string; provider: string }
  | { type: 'text_delta'; text: string }
  | { type: 'reasoning_delta'; text: string }
  | { type: 'tool_call'; toolCall: ToolCall }
  | { type: 'response_end'; finishReason: string; usage?: UsageSummary }

export type WireDialect = 'openai' | 'anthropic'
