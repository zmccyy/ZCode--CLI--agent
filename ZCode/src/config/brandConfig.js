const DEFAULT_BRAND_CONFIG = Object.freeze({
  productName: 'ZCode',
  welcomeTitle: 'ZCode CLI Agent',
  logoVariant: 'zcode',
  theme: 'zcode',
  documentationUrl: 'https://example.com/zcode/docs',
  commandNamespace: 'zcode',
  productUrl: 'https://example.com/zcode',
  remoteBaseUrl: 'https://example.com/zcode',
  remoteStagingBaseUrl: 'https://staging.example.com/zcode',
  remoteLocalBaseUrl: 'http://localhost:4000',
})

function readEnv(key, fallback) {
  const value = process.env[key]
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

export function getBrandConfig() {
  return {
    productName: readEnv('ZCODE_PRODUCT_NAME', DEFAULT_BRAND_CONFIG.productName),
    welcomeTitle: readEnv(
      'ZCODE_WELCOME_TITLE',
      DEFAULT_BRAND_CONFIG.welcomeTitle,
    ),
    logoVariant: readEnv(
      'ZCODE_LOGO_VARIANT',
      DEFAULT_BRAND_CONFIG.logoVariant,
    ),
    theme: readEnv('ZCODE_THEME', DEFAULT_BRAND_CONFIG.theme),
    documentationUrl: readEnv(
      'ZCODE_DOCUMENTATION_URL',
      DEFAULT_BRAND_CONFIG.documentationUrl,
    ),
    commandNamespace: readEnv(
      'ZCODE_COMMAND_NAMESPACE',
      DEFAULT_BRAND_CONFIG.commandNamespace,
    ),
    productUrl: readEnv('ZCODE_PRODUCT_URL', DEFAULT_BRAND_CONFIG.productUrl),
    remoteBaseUrl: readEnv(
      'ZCODE_REMOTE_BASE_URL',
      DEFAULT_BRAND_CONFIG.remoteBaseUrl,
    ),
    remoteStagingBaseUrl: readEnv(
      'ZCODE_REMOTE_STAGING_BASE_URL',
      DEFAULT_BRAND_CONFIG.remoteStagingBaseUrl,
    ),
    remoteLocalBaseUrl: readEnv(
      'ZCODE_REMOTE_LOCAL_BASE_URL',
      DEFAULT_BRAND_CONFIG.remoteLocalBaseUrl,
    ),
  }
}
