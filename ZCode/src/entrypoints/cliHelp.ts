import {
  getCliDescription,
  getCommandName,
  getLaunchCommandTip,
  getProductName,
  getVersionBanner,
} from '../config/brandText.js'

export function renderCliEntrypointHelp(version: string): string {
  const commandName = getCommandName()
  const productName = getProductName()

  return [
    `${productName} CLI`,
    getCliDescription(),
    '',
    `Version: ${getVersionBanner(version)}`,
    '',
    'Usage:',
    `  bun src/entrypoints/cli.tsx [prompt] [options]`,
    `  ${commandName} [prompt] [options]`,
    '',
    'Common Options:',
    '  -h, --help                         Show this help message',
    '  -v, --version                      Show version',
    '  -p, --print                        Print response and exit',
    '  -c, --continue                     Continue the latest conversation',
    '  -r, --resume [value]               Resume a conversation or open picker',
    '  --model <model>                    Select model alias or full model ID',
    '  --permission-mode <mode>           Set permission mode for the session',
    '  --dangerously-skip-permissions     Bypass permission checks',
    '  --add-dir <directories...>         Add directories for tool access',
    '  --settings <file-or-json>          Load additional settings',
    '  --mcp-config <configs...>          Load MCP server configs',
    '  --agent <agent>                    Override the current agent',
    '  --ide                              Connect to IDE on startup when possible',
    '  --verbose                          Override verbose mode setting',
    '  --debug-file <path>                Write debug logs to a file',
    '',
    'Common Commands:',
    '  mcp                               Manage MCP servers',
    '  auth                              Manage authentication',
    '  doctor                            Check local runtime health',
    '  update                            Check for updates and install if available',
    '  plugin                            Manage plugins',
    '',
    'Notes:',
    '  This is the full interactive CLI entrypoint.',
    '  Bun is the supported runtime for the full REPL/TUI startup path.',
    `  ${getLaunchCommandTip()}`,
  ].join('\n')
}
