import type { Command } from '../../commands.js'

const memory: Command = {
  type: 'local-jsx',
  name: 'memory',
  description: 'Edit ZCode memory files',
  load: () => import('./memory.js'),
}

export default memory
