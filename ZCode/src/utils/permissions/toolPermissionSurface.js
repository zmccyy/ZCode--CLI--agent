function permissionRuleValueToString(ruleValue) {
  if (!ruleValue?.ruleContent) {
    return ruleValue?.toolName ?? ''
  }

  return `${ruleValue.toolName}(${ruleValue.ruleContent})`
}

function permissionRuleSourceDisplayString(source) {
  switch (source) {
    case 'userSettings':
      return 'user settings'
    case 'projectSettings':
      return 'shared project settings'
    case 'localSettings':
      return 'project local settings'
    case 'flagSettings':
      return 'command line arguments'
    case 'policySettings':
      return 'enterprise managed settings'
    case 'cliArg':
      return 'CLI argument'
    case 'command':
      return 'command configuration'
    case 'session':
      return 'current session'
    default:
      return String(source ?? 'unknown source')
  }
}

export function createPermissionRequestMessage(toolName, decisionReason) {
  if (decisionReason) {
    switch (decisionReason.type) {
      case 'hook':
        return decisionReason.reason
          ? `Hook '${decisionReason.hookName}' blocked this action: ${decisionReason.reason}`
          : `Hook '${decisionReason.hookName}' requires approval for this ${toolName} command`
      case 'rule': {
        const ruleString = permissionRuleValueToString(
          decisionReason.rule.ruleValue,
        )
        const sourceString = permissionRuleSourceDisplayString(
          decisionReason.rule.source,
        )
        return `Permission rule '${ruleString}' from ${sourceString} requires approval for this ${toolName} command`
      }
      case 'permissionPromptTool':
        return `Tool '${decisionReason.permissionPromptToolName}' requires approval for this ${toolName} command`
      case 'sandboxOverride':
        return 'Run outside of the sandbox'
      case 'workingDir':
      case 'safetyCheck':
      case 'other':
      case 'asyncAgent':
        return decisionReason.reason
      case 'mode': {
        const modeTitle =
          decisionReason.mode === 'plan'
            ? 'Plan Mode'
            : decisionReason.mode === 'dontAsk'
              ? "Don't Ask"
              : decisionReason.mode === 'acceptEdits'
                ? 'Accept edits'
                : decisionReason.mode === 'bypassPermissions'
                  ? 'Bypass Permissions'
                  : decisionReason.mode === 'auto'
                    ? 'Auto mode'
                    : 'Default'
        return `Current permission mode (${modeTitle}) requires approval for this ${toolName} command`
      }
      default:
        break
    }
  }

  return `ZCode requested permission to use ${toolName}, but you haven't granted it yet.`
}

export function buildToolPermissionSurfaceDecision({
  toolName,
  input,
  denyRule = null,
  askRule = null,
  allowRule = null,
  toolPermissionResult = {
    behavior: 'passthrough',
    message: '',
  },
  shouldBypassPermissions = false,
  mode = 'default',
  requiresUserInteraction = false,
  canSkipAskRule = false,
}) {
  if (denyRule) {
    return {
      behavior: 'deny',
      decisionReason: {
        type: 'rule',
        rule: denyRule,
      },
      message: `Permission to use ${toolName} has been denied.`,
    }
  }

  if (askRule && !canSkipAskRule) {
    return {
      behavior: 'ask',
      decisionReason: {
        type: 'rule',
        rule: askRule,
      },
      message: createPermissionRequestMessage(toolName),
    }
  }

  if (toolPermissionResult?.behavior === 'deny') {
    return toolPermissionResult
  }

  if (
    requiresUserInteraction &&
    toolPermissionResult?.behavior === 'ask'
  ) {
    return toolPermissionResult
  }

  if (
    toolPermissionResult?.behavior === 'ask' &&
    toolPermissionResult?.decisionReason?.type === 'rule' &&
    toolPermissionResult.decisionReason.rule.ruleBehavior === 'ask'
  ) {
    return toolPermissionResult
  }

  if (
    toolPermissionResult?.behavior === 'ask' &&
    toolPermissionResult?.decisionReason?.type === 'safetyCheck'
  ) {
    return toolPermissionResult
  }

  if (shouldBypassPermissions) {
    return {
      behavior: 'allow',
      updatedInput: input,
      decisionReason: {
        type: 'mode',
        mode,
      },
    }
  }

  if (allowRule) {
    return {
      behavior: 'allow',
      updatedInput: input,
      decisionReason: {
        type: 'rule',
        rule: allowRule,
      },
    }
  }

  if (toolPermissionResult?.behavior === 'passthrough') {
    return {
      ...toolPermissionResult,
      behavior: 'ask',
      message:
        toolPermissionResult.message ||
        createPermissionRequestMessage(
          toolName,
          toolPermissionResult.decisionReason,
        ),
    }
  }

  return toolPermissionResult
}
