import { loadModule, resolveFromHere } from './loadModule.js'

const publicCliCorePath = resolveFromHere(
  import.meta.url,
  '..',
  '..',
  'src',
  'cli',
  'publicCliCore.js',
)
const planBehaviorPath = resolveFromHere(
  import.meta.url,
  '..',
  '..',
  'src',
  'commands',
  'plan',
  'planBehavior.js',
)
const resumeBehaviorPath = resolveFromHere(
  import.meta.url,
  '..',
  '..',
  'src',
  'commands',
  'resume',
  'resumeBehavior.js',
)
const permissionSurfacePath = resolveFromHere(
  import.meta.url,
  '..',
  '..',
  'src',
  'utils',
  'permissions',
  'toolPermissionSurface.js',
)

function freshModulePath(absolutePath, label) {
  return `${absolutePath}?${label}=${Date.now()}-${Math.random()}`
}

async function loadFreshModule(absolutePath, label) {
  return loadModule(freshModulePath(absolutePath, label))
}

export function createToolPermissionContext(overrides = {}) {
  return {
    mode: 'default',
    additionalWorkingDirectories: new Map(),
    alwaysAllowRules: {},
    alwaysDenyRules: {},
    alwaysAskRules: {},
    isBypassPermissionsModeAvailable: false,
    ...overrides,
  }
}

export function createAppState(overrides = {}) {
  const toolPermissionContext = createToolPermissionContext(
    overrides.toolPermissionContext,
  )

  return {
    toolPermissionContext,
    ...overrides,
    toolPermissionContext,
  }
}

export async function readNewSessionSurface() {
  const { createDoctorReport } = await loadFreshModule(
    publicCliCorePath,
    'public-cli-core',
  )

  return createDoctorReport({
    cwd: 'D:\\workspace\\zcode',
    env: {},
    version: '0.1.0',
    runtime: {
      engine: 'bun',
      node: 'v22.16.0',
      bun: '1.3.14',
    },
  })
}

export async function runPlanSurface({
  args = '',
  appState,
  planContent = '',
  planPath = 'D:\\workspace\\zcode\\.zcode\\plan.md',
  editorName,
  openPlanResult = { error: undefined },
} = {}) {
  const { formatPlanDisplayText, resolvePlanCommandBehavior } =
    await loadFreshModule(planBehaviorPath, 'plan-behavior')

  const initialAppState = createAppState(appState)
  const action = await resolvePlanCommandBehavior({
    args,
    currentMode: initialAppState.toolPermissionContext.mode,
    getPlanContent: () => planContent,
    getPlanPath: () => planPath,
    editorName,
    openPlanInEditor: async () => openPlanResult,
    renderPlanDisplay: async input => formatPlanDisplayText(input),
  })

  const onDoneCalls = []
  let nextAppState = initialAppState

  if (action.type === 'enable') {
    nextAppState = {
      ...initialAppState,
      toolPermissionContext: {
        ...initialAppState.toolPermissionContext,
        prePlanMode: initialAppState.toolPermissionContext.mode,
        mode: 'plan',
      },
    }
  }

  onDoneCalls.push({
    result: action.result,
    options: action.options,
  })

  return {
    action,
    appState: nextAppState,
    onDoneCalls,
  }
}

export async function runResumeSurface({
  arg,
  logs = [],
  directLog = null,
  customTitleEnabled = false,
  titleMatches = [],
  resume = async () => {},
} = {}) {
  const { NO_CONVERSATIONS_FOUND_MESSAGE, resolveResumeLookup } =
    await loadFreshModule(resumeBehaviorPath, 'resume-behavior')

  const resumeCalls = []
  const action = await resolveResumeLookup({
    arg,
    logs,
    validateSessionId: value =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
      )
        ? value
        : null,
    getSessionIdFromLog: log => log.sessionId,
    isLiteLog: log => Boolean(log.isLite),
    loadFullLog: async log => ({
      ...log,
      hydrated: true,
    }),
    getLastSessionLog: async () => directLog,
    isCustomTitleEnabled: () => customTitleEnabled,
    searchSessionsByCustomTitle: async () => titleMatches,
  })

  if (action.type === 'resume') {
    await resume(action.sessionId, action.log, action.entrypoint)
    resumeCalls.push({
      sessionId: action.sessionId,
      log: action.log,
      entrypoint: action.entrypoint,
    })
  }

  return {
    action,
    resumeCalls,
    messages: {
      noConversations: NO_CONVERSATIONS_FOUND_MESSAGE,
    },
  }
}

export function createPermissionRule(toolName, ruleBehavior, source = 'session') {
  return {
    source,
    ruleBehavior,
    ruleValue: {
      toolName,
    },
  }
}

export async function evaluatePermissionSurface({
  toolName,
  denyRule = null,
  askRule = null,
  allowRule = null,
  toolPermissionResult = {
    behavior: 'passthrough',
    message: '',
  },
  mode = 'default',
} = {}) {
  const { buildToolPermissionSurfaceDecision } = await loadFreshModule(
    permissionSurfacePath,
    'permission-surface',
  )

  return buildToolPermissionSurfaceDecision({
    toolName,
    input: {},
    denyRule,
    askRule,
    allowRule,
    toolPermissionResult,
    shouldBypassPermissions: false,
    mode,
    requiresUserInteraction: false,
    canSkipAskRule: false,
  })
}
