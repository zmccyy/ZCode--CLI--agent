const CLAUDE_IN_CHROME_BROWSER_TOOL_NAMES = [
  'javascript_tool',
  'read_page',
  'find',
  'form_input',
  'computer',
  'navigate',
  'resize_window',
  'gif_creator',
  'upload_image',
  'get_page_text',
  'tabs_context_mcp',
  'tabs_create_mcp',
  'update_plan',
  'read_console_messages',
  'read_network_requests',
  'shortcuts_list',
  'shortcuts_execute',
]

export function getClaudeInChromeBrowserToolNames(): string[] {
  return [...CLAUDE_IN_CHROME_BROWSER_TOOL_NAMES]
}
