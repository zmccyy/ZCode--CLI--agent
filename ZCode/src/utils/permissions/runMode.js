/**
 * Run Mode — 三级运行模式定义与解析
 *
 * Plan   (--plan):  建议变更但不执行写入，权限模式 = plan
 * Agent  (默认):    标准权限模式，执行前征求用户确认，权限模式 = default
 * YOLO   (--yolo):  自动批准所有操作，权限模式 = acceptEdits / auto(ant)
 *
 * 该模块作为权限决策树的顶层开关，CLI 入口将 flags 传入 resolveRunMode()
 * 即可获得统一的三级模式定义。
 */

/**
 * @typedef {'plan' | 'agent' | 'yolo'} RunMode
 */

/** @type {ReadonlyArray<RunMode>} */
export const RUN_MODES = Object.freeze(['plan', 'agent', 'yolo'])

/** @type {Record<RunMode, string>} */
export const RUN_MODE_LABELS = Object.freeze({
  plan: 'Plan',
  agent: 'Agent',
  yolo: 'YOLO',
})

/** @type {Record<RunMode, string>} */
export const RUN_MODE_DESCRIPTIONS = Object.freeze({
  plan: 'Suggest changes without executing writes',
  agent: 'Ask for permission before executing operations',
  yolo: 'Auto-approve all operations without prompting',
})

/**
 * 将 RunMode 映射到对应的内部 PermissionMode。
 *
 * - plan  → 'plan'（仅建议不执行）
 * - agent → 'default'（标准权限询问）
 * - yolo  → 'acceptEdits'（外部）/ 'auto'（内部 ant + TRANSCRIPT_CLASSIFIER）
 *
 * @param {RunMode} runMode
 * @returns {string} PermissionMode
 */
export function runModeToPermissionMode(runMode) {
  switch (runMode) {
    case 'plan':
      return 'plan'
    case 'agent':
      return 'default'
    case 'yolo':
      // ant 用户且启用 TRANSCRIPT_CLASSIFIER 时走 auto 模式（含 AI 分类器）
      if (process.env.USER_TYPE === 'ant') {
        return 'auto'
      }
      return 'acceptEdits'
    default:
      return 'default'
  }
}

/**
 * 从 CLI flags 解析 RunMode。
 *
 * @param {{ plan?: boolean, yolo?: boolean }} options
 * @returns {{ runMode: RunMode, error?: string }}
 */
export function resolveRunMode({ plan = false, yolo = false } = {}) {
  if (plan && yolo) {
    return {
      runMode: 'agent',
      error: '--plan and --yolo are mutually exclusive; using default Agent mode',
    }
  }

  if (plan) {
    return { runMode: 'plan' }
  }

  if (yolo) {
    return { runMode: 'yolo' }
  }

  return { runMode: 'agent' }
}

/**
 * 判断给定字符串是否为合法的 RunMode。
 *
 * @param {string} str
 * @returns {str is RunMode}
 */
export function isValidRunMode(str) {
  return RUN_MODES.includes(str)
}

/**
 * 获取用于 CLI --help 的模式说明文本。
 *
 * @returns {string[]}
 */
export function getRunModeHelpLines() {
  return [
    '  --plan               Plan mode: suggest changes without executing writes',
    '  --yolo               YOLO mode: auto-approve all operations',
  ]
}
