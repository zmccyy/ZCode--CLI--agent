export const NO_CONVERSATIONS_FOUND_MESSAGE = 'No conversations found to resume.'

export function formatResumeSessionNotFoundMessage(arg) {
  return `Session ${arg} was not found.`
}

export function formatResumeMultipleMatchesMessage(arg, count) {
  return `Found ${count} sessions matching ${arg}. Please use /resume to pick a specific session.`
}

function sortLogsByModifiedDesc(logs) {
  return [...logs].sort((a, b) => {
    const left = a?.modified instanceof Date ? a.modified.getTime() : 0
    const right = b?.modified instanceof Date ? b.modified.getTime() : 0
    return right - left
  })
}

export async function resolveResumeLookup({
  arg,
  logs,
  validateSessionId,
  getSessionIdFromLog,
  isLiteLog,
  loadFullLog,
  getLastSessionLog,
  isCustomTitleEnabled,
  searchSessionsByCustomTitle,
}) {
  const trimmedArg = String(arg ?? '').trim()

  if (!trimmedArg) {
    return {
      type: 'picker',
    }
  }

  if (!Array.isArray(logs) || logs.length === 0) {
    return {
      type: 'noConversations',
      message: NO_CONVERSATIONS_FOUND_MESSAGE,
    }
  }

  const maybeSessionId = validateSessionId(trimmedArg)
  if (maybeSessionId) {
    const matchingLogs = sortLogsByModifiedDesc(
      logs.filter(log => getSessionIdFromLog(log) === maybeSessionId),
    )

    if (matchingLogs.length > 0) {
      const log = matchingLogs[0]
      const fullLog = isLiteLog(log) ? await loadFullLog(log) : log
      return {
        type: 'resume',
        sessionId: maybeSessionId,
        log: fullLog,
        entrypoint: 'slash_command_session_id',
      }
    }

    const directLog = await getLastSessionLog(maybeSessionId)
    if (directLog) {
      return {
        type: 'resume',
        sessionId: maybeSessionId,
        log: directLog,
        entrypoint: 'slash_command_session_id',
      }
    }
  }

  if (isCustomTitleEnabled()) {
    const titleMatches = await searchSessionsByCustomTitle(trimmedArg, {
      exact: true,
    })

    if (titleMatches.length === 1) {
      const log = titleMatches[0]
      const sessionId = getSessionIdFromLog(log)
      if (sessionId) {
        const fullLog = isLiteLog(log) ? await loadFullLog(log) : log
        return {
          type: 'resume',
          sessionId,
          log: fullLog,
          entrypoint: 'slash_command_title',
        }
      }
    }

    if (titleMatches.length > 1) {
      return {
        type: 'error',
        message: formatResumeMultipleMatchesMessage(
          trimmedArg,
          titleMatches.length,
        ),
      }
    }
  }

  return {
    type: 'error',
    message: formatResumeSessionNotFoundMessage(trimmedArg),
  }
}
