import type { ToolContext, ToolDefinition, ToolResult, TodoItem, TodoStatus } from '../types.ts'

const MAX_CONTENT_LENGTH = 500
const MAX_ITEMS = 50
const STATUSES: readonly TodoStatus[] = ['pending', 'in_progress', 'completed']

const STATUS_MARKERS: Record<TodoStatus, string> = {
  pending: '☐',
  in_progress: '◐',
  completed: '☒',
}

/**
 * Validates and normalizes a todos payload. Returns { items } or { error }.
 * Rules: non-empty array, non-empty content, known status, at most one
 * in_progress item (the single-task-in-flight convention).
 */
export function parseTodos(input: unknown): { items?: TodoItem[]; error?: string } {
  if (!Array.isArray(input) || input.length === 0) {
    return { error: 'todos is required and must be a non-empty array' }
  }
  if (input.length > MAX_ITEMS) {
    return { error: `todos accepts at most ${MAX_ITEMS} items (got ${input.length})` }
  }

  const items: TodoItem[] = []
  let inProgress = 0
  for (const raw of input) {
    const entry = (raw ?? {}) as { content?: unknown; status?: unknown }
    if (typeof entry.content !== 'string' || entry.content.trim() === '') {
      return { error: 'every todo needs a non-empty "content" string' }
    }
    if (entry.content.length > MAX_CONTENT_LENGTH) {
      return { error: `todo content exceeds ${MAX_CONTENT_LENGTH} characters` }
    }
    const status = entry.status ?? 'pending'
    if (!STATUSES.includes(status as TodoStatus)) {
      return { error: `todo status must be one of: ${STATUSES.join(', ')}` }
    }
    if (status === 'in_progress') inProgress += 1
    items.push({ content: entry.content.trim(), status: status as TodoStatus })
  }
  if (inProgress > 1) {
    return {
      error:
        `at most one todo may be in_progress (got ${inProgress}). ` +
        'Work on one item at a time: mark it completed before starting the next.',
    }
  }
  return { items }
}

/** Renders the checklist exactly as it is fed back to the model and shown in previews. */
export function renderTodos(items: TodoItem[]): string {
  return items.map(item => `${STATUS_MARKERS[item.status]} ${item.content}`).join('\n')
}

function summarize(items: TodoItem[]): string {
  const completed = items.filter(item => item.status === 'completed').length
  const inProgress = items.filter(item => item.status === 'in_progress').length
  const pending = items.length - completed - inProgress
  return `Todo list updated: ${completed} completed, ${inProgress} in progress, ${pending} pending (${items.length} total).`
}

export async function executeTodoWrite(
  input: unknown,
  context: ToolContext,
): Promise<ToolResult> {
  const params = (input ?? {}) as { todos?: unknown }
  const parsed = parseTodos(params.todos)
  if (parsed.error) {
    return { content: `Error: ${parsed.error}`, isError: true }
  }

  const items = parsed.items ?? []
  // Session-scoped state: the latest call replaces the whole list, so the
  // model always sends the full authoritative snapshot.
  context.state.todos = items
  return { content: `${summarize(items)}\n${renderTodos(items)}` }
}

export function createTodoTool(): ToolDefinition {
  return {
    name: 'TodoWrite',
    description:
      'Maintains the session task list for multi-step work. Create it before starting a task ' +
      'with more than a couple of steps (one item per concrete, verifiable step), then re-send ' +
      'the FULL list every time status changes: mark an item in_progress right before working ' +
      'on it (only one at a time) and completed only when its verification passed. Keeps the ' +
      'user informed of progress and keeps long tasks on track. Items are plain strings; the ' +
      'list is session-scoped.',
    readOnly: true,
    version: 1,
    sideEffect: 'write',
    cancellable: true,
    timeoutMs: 5_000,
    outputLimitBytes: 64_000,
    idempotent: true,
    inputSchema: {
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          description:
            'The complete todo list. Each item: { content: string, status: "pending" | "in_progress" | "completed" }. ' +
            'Resend the whole list on every update.',
          items: {
            type: 'object',
            properties: {
              content: { type: 'string', description: 'Concrete, verifiable step' },
              status: {
                type: 'string',
                enum: ['pending', 'in_progress', 'completed'],
                description: 'Defaults to pending',
              },
            },
            required: ['content'],
          },
        },
      },
      required: ['todos'],
    },
    execute: executeTodoWrite,
  }
}
