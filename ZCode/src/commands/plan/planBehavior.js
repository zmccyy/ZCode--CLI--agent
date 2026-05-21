export function shouldPlanModeQuery(args) {
  const description = String(args ?? '').trim()
  return Boolean(description) && description !== 'open'
}

export function formatPlanDisplayText({
  planContent,
  planPath,
  editorName,
}) {
  const lines = ['Current Plan', planPath, '', planContent]

  if (editorName) {
    lines.push('', `"/plan open" to edit this plan in ${editorName}`)
  }

  return lines.join('\n')
}

export async function resolvePlanCommandBehavior({
  args,
  currentMode,
  getPlanContent,
  getPlanPath,
  editorName,
  openPlanInEditor,
  renderPlanDisplay,
}) {
  if (currentMode !== 'plan') {
    const shouldQuery = shouldPlanModeQuery(args)
    return {
      type: 'enable',
      result: 'Enabled plan mode',
      options: shouldQuery ? { shouldQuery: true } : undefined,
    }
  }

  const planContent = getPlanContent()
  const planPath = getPlanPath()

  if (!planContent) {
    return {
      type: 'done',
      result: 'Already in plan mode. No plan written yet.',
    }
  }

  const argList = String(args ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)

  if (argList[0] === 'open') {
    const result = await openPlanInEditor(planPath)
    if (result?.error) {
      return {
        type: 'done',
        result: `Failed to open plan in editor: ${result.error}`,
      }
    }

    return {
      type: 'done',
      result: `Opened plan in editor: ${planPath}`,
    }
  }

  const output = await renderPlanDisplay({
    planContent,
    planPath,
    editorName,
  })

  return {
    type: 'done',
    result: output,
  }
}
