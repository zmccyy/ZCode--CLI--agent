/**
 * ZCode Harness v1 — provider-agnostic agent runtime.
 *
 * Public surface: the agent loop, the core six tools, permission modes,
 * guardrails, and the JSONL transcript.
 */

export * from './types.ts'
export { runAgentLoop, type AgentLoopOptions, type RunningLoop } from './loop.ts'
export {
  createToolRegistry,
  type ToolRegistry,
} from './tools/registry.ts'
export { createCoreTools } from './tools/index.ts'
export {
  createReadTool,
  executeRead,
} from './tools/read.ts'
export { createGlobTool, executeGlob } from './tools/glob.ts'
export { createGrepTool, executeGrep } from './tools/grep.ts'
export { createWriteTool, executeWrite } from './tools/write.ts'
export { createEditTool, executeEdit } from './tools/edit.ts'
export { createBashTool, executeBash } from './tools/bash.ts'
export {
  createTranscriptWriter,
  defaultTranscriptDir,
  hashCwd,
  type TranscriptWriter,
} from './transcript.ts'
export {
  checkPermission,
  describeMode,
  PERMISSION_MODES,
} from './permissions.ts'
export {
  createWorkspaceBoundary,
  isPathInsideBoundary,
  describeBoundary,
  BoundaryError,
  type WorkspaceBoundary,
} from './boundary.ts'
export {
  resolveBashPolicy,
  classifyBashCommand,
  type BashPolicy,
  type BashGateDecision,
} from './bashPolicy.ts'
export {
  evaluateGuardrails,
  DEFAULT_MAX_TURNS,
} from './guardrails.ts'
export {
  compactConversation,
  selectCompactionBoundary,
  buildSummaryMessage,
  resolveCompactConfig,
  DEFAULT_COMPACT_LIMIT_TOKENS,
  DEFAULT_COMPACT_KEEP_MESSAGES,
  type CompactOptions,
  type ResolvedCompactConfig,
  type CompactionOutcome,
} from './compact.ts'
export {
  listSessions,
  findLatestSession,
  resolveSessionPath,
  loadSessionForResume,
  ResumeError,
  type SessionSummary,
  type ResumeSnapshot,
} from './resume.ts'
export {
  toOpenAIMessages,
  toOpenAITools,
  toAnthropicMessages,
  toAnthropicTools,
  translateRequest,
  resolveDialect,
} from './translate.ts'
export { emptyUsage, addUsage } from './usage.ts'
