type ProgressBase<TType extends string> = {
  type: TType
}

export type ShellProgress = ProgressBase<
  'bash_progress' | 'powershell_progress'
> & {
  output?: string
  fullOutput?: string
  elapsedTimeSeconds?: number
  totalLines?: number
  totalBytes?: number
  timeoutMs?: number
  taskId?: string
}

export type BashProgress = ShellProgress & {
  type: 'bash_progress'
}

export type PowerShellProgress = ShellProgress & {
  type: 'powershell_progress'
}

export type MCPProgress = ProgressBase<'mcp_progress'> & {
  status?: string
  message?: string
  serverName?: string
  toolName?: string
  requestId?: string
}

export type SkillToolProgress = ProgressBase<'skill_progress'> & {
  skillName?: string
  message?: string
}

export type TaskOutputProgress = ProgressBase<'task_output_progress'> & {
  taskId?: string
  output?: string
  status?: string
}

export type REPLToolProgress = ProgressBase<'repl_progress'> & {
  message?: string
}

export type WebSearchProgress = ProgressBase<'web_search_progress'> & {
  query?: string
  message?: string
  completedQueries?: number
  totalQueries?: number
}

export type SdkWorkflowProgress = {
  type: string
  index: number
  phaseIndex?: number
  label?: string
  status?: string
  detail?: string
  timestamp?: number
  [key: string]: unknown
}

export type AgentToolProgress = ProgressBase<'agent_progress'> & {
  agentId?: string
  prompt?: string
  message: {
    type: string
    [key: string]: unknown
  }
}

export type ToolProgressData =
  | AgentToolProgress
  | BashProgress
  | PowerShellProgress
  | MCPProgress
  | REPLToolProgress
  | SkillToolProgress
  | TaskOutputProgress
  | WebSearchProgress
