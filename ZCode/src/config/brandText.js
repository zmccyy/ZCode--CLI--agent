import { getBrandConfig } from './brandConfig.js'

function getBrand() {
  return getBrandConfig()
}

export function getCommandName() {
  return getBrand().commandNamespace
}

export function getProductName() {
  return getBrand().productName
}

export function getWelcomeTitle() {
  return getBrand().welcomeTitle
}

export function getCliDescription() {
  return `${getWelcomeTitle()} - starts an interactive session by default, use -p/--print for non-interactive output`
}

export function getVersionBanner(version) {
  return `${version} (${getProductName()})`
}

export function getLaunchCommandTip() {
  return `Tip: You can launch ${getProductName()} with just \`${getCommandName()}\``
}

export function getCliIdentityLine() {
  return `You are ${getProductName()}, a CLI coding agent.`
}

export function getCliIdentityLineWithSdk() {
  return `You are ${getProductName()}, a CLI coding agent running within the Claude Agent SDK.`
}

export function getAgentSdkIdentityLine() {
  return `You are a coding agent built on the Claude Agent SDK.`
}

export function getAgentIdentityLine() {
  return `You are an agent for ${getProductName()}. Given the user's message, you should use the tools available to complete the task.`
}

export function getAttributionMarkdown(productUrl) {
  return `🤖 Generated with [${getProductName()}](${productUrl})`
}
