// Stub for Node.js dev mode
export class ReadMcpResourceTool {
  static searchHint = ''
  static aliases = []
  static inputSchema = { type: 'object', properties: {} }
  static isEnabled() { return false }
  static isConcurrencySafe() { return true }
  static isReadOnly() { return true }
  static isOpenWorld() { return false }
  static requiresUserInteraction() { return false }
  static isMcp = false
  static isLsp = false
  static async call() { return { content: [], isError: true } }
  static async description() { return 'Stub tool (not available in dev mode)' }
}
