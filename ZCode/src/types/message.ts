import type { UUID } from 'node:crypto'

export type MessageOrigin =
  | { kind: 'channel'; [key: string]: unknown }
  | { kind: 'bridge'; [key: string]: unknown }
  | { kind: 'system'; [key: string]: unknown }
  | { kind: string; [key: string]: unknown }

export type PartialCompactDirection = 'from' | 'to'

export type SystemMessageLevel = 'info' | 'warning' | 'error'

export type BaseMessage = {
  uuid: UUID | string
  timestamp: string
  isMeta?: boolean
  origin?: MessageOrigin
}

export type AssistantMessage = BaseMessage & {
  type: 'assistant'
  message: {
    role?: 'assistant'
    content: unknown
    usage?: Record<string, unknown>
    [key: string]: unknown
  }
  requestId?: string
}

export type UserMessage = BaseMessage & {
  type: 'user'
  message: {
    role?: 'user'
    content: unknown
    [key: string]: unknown
  }
  toolUseResult?: unknown
}

export type AttachmentMessage = BaseMessage & {
  type: 'attachment'
  attachment: {
    type?: string
    toolUseID?: string
    hookEvent?: string
    source_uuid?: string
    content?: unknown
    [key: string]: unknown
  }
}

export type ProgressMessage<TData = unknown> = BaseMessage & {
  type: 'progress'
  data: TData
  toolUseID?: string
  parentToolUseID?: string
}

export type HookResultMessage = BaseMessage & {
  type: 'hook_result'
  attachment: {
    type?: string
    toolUseID?: string
    hookEvent?: string
    [key: string]: unknown
  }
}

type InformationalSystemMessage = BaseMessage & {
  type: 'system'
  subtype:
    | 'informational'
    | 'permission_retry'
    | 'bridge_status'
    | 'scheduled_task_fire'
    | 'stop_hook_summary'
    | 'turn_duration'
    | 'away_summary'
    | 'memory_saved'
    | 'agents_killed'
    | 'api_metrics'
    | 'local_command'
    | 'compact_boundary'
    | 'microcompact_boundary'
    | 'thinking'
  level?: SystemMessageLevel
  content?: string
  toolUseID?: string
  [key: string]: unknown
}

export type SystemInformationalMessage = InformationalSystemMessage & {
  subtype: 'informational'
}

export type SystemPermissionRetryMessage = InformationalSystemMessage & {
  subtype: 'permission_retry'
  commands: string[]
}

export type SystemBridgeStatusMessage = InformationalSystemMessage & {
  subtype: 'bridge_status'
  url: string
  upgradeNudge?: string
}

export type SystemScheduledTaskFireMessage = InformationalSystemMessage & {
  subtype: 'scheduled_task_fire'
}

export type StopHookInfo = {
  hookName?: string
  command?: string
  durationMs?: number
  [key: string]: unknown
}

export type SystemStopHookSummaryMessage = InformationalSystemMessage & {
  subtype: 'stop_hook_summary'
  hookCount: number
  hookInfos: StopHookInfo[]
  hookErrors: string[]
  preventedContinuation: boolean
  stopReason?: string
  hasOutput: boolean
  hookLabel?: string
  totalDurationMs?: number
}

export type SystemTurnDurationMessage = InformationalSystemMessage & {
  subtype: 'turn_duration'
  durationMs: number
}

export type SystemAwaySummaryMessage = InformationalSystemMessage & {
  subtype: 'away_summary'
}

export type SystemMemorySavedMessage = InformationalSystemMessage & {
  subtype: 'memory_saved'
  writtenPaths: string[]
}

export type SystemAgentsKilledMessage = InformationalSystemMessage & {
  subtype: 'agents_killed'
}

export type SystemApiMetricsMessage = InformationalSystemMessage & {
  subtype: 'api_metrics'
  ttftMs: number
  otps: number
}

export type SystemLocalCommandMessage = InformationalSystemMessage & {
  subtype: 'local_command'
}

export type SystemCompactBoundaryMessage = InformationalSystemMessage & {
  subtype: 'compact_boundary'
  compactMetadata: {
    trigger: 'manual' | 'auto'
    preTokens: number
    userContext?: string
    messagesSummarized?: number
    preservedSegment?: unknown
  }
  logicalParentUuid?: UUID | string
}

export type SystemMicrocompactBoundaryMessage = InformationalSystemMessage & {
  subtype: 'microcompact_boundary'
  microcompactMetadata: {
    trigger: 'auto'
    preTokens: number
    tokensSaved: number
    compactedToolIds: string[]
    clearedAttachmentUUIDs: string[]
  }
}

export type SystemThinkingMessage = InformationalSystemMessage & {
  subtype: 'thinking'
}

export type SystemAPIErrorMessage = BaseMessage & {
  type: 'system'
  subtype: 'api_error'
  level: 'error'
  error: unknown
  retryInMs: number
  retryAttempt: number
  maxRetries: number
  cause?: Error
}

export type SystemMessage =
  | SystemInformationalMessage
  | SystemPermissionRetryMessage
  | SystemBridgeStatusMessage
  | SystemScheduledTaskFireMessage
  | SystemStopHookSummaryMessage
  | SystemTurnDurationMessage
  | SystemAwaySummaryMessage
  | SystemMemorySavedMessage
  | SystemAgentsKilledMessage
  | SystemApiMetricsMessage
  | SystemLocalCommandMessage
  | SystemCompactBoundaryMessage
  | SystemMicrocompactBoundaryMessage
  | SystemThinkingMessage
  | SystemAPIErrorMessage

export type RequestStartEvent = {
  type: 'stream_request_start'
}

export type StreamEvent = {
  type: 'stream_event'
  event?: unknown
  [key: string]: unknown
}

export type TombstoneMessage = {
  type: 'tombstone'
  message: Message
}

export type ToolUseSummaryMessage = BaseMessage & {
  type: 'tool_use_summary'
  summary: string
  preceding_tool_use_ids: string[]
}

export type GroupedToolUseMessage = BaseMessage & {
  type: 'grouped_tool_use'
  toolUseMessages: NormalizedAssistantMessage[]
  toolResultMessages: NormalizedUserMessage[]
}

export type CollapsedReadSearchGroup = BaseMessage & {
  type: 'collapsed_read_search_group'
  messages: RenderableMessage[]
  summary?: string
}

export type NormalizedAssistantMessage<TContent = unknown> = AssistantMessage & {
  normalized?: true
  message: AssistantMessage['message'] & {
    content: TContent
  }
}

export type NormalizedUserMessage<TContent = unknown> = UserMessage & {
  normalized?: true
  message: UserMessage['message'] & {
    content: TContent
  }
}

export type NormalizedMessage =
  | NormalizedAssistantMessage
  | NormalizedUserMessage
  | AttachmentMessage
  | ProgressMessage
  | HookResultMessage
  | SystemMessage

export type RenderableMessage =
  | NormalizedMessage
  | GroupedToolUseMessage
  | CollapsedReadSearchGroup

export type Message =
  | AssistantMessage
  | UserMessage
  | AttachmentMessage
  | ProgressMessage
  | HookResultMessage
  | SystemMessage
