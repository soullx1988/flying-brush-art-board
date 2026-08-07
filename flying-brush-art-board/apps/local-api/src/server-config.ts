import type { BuildAppConfig } from './app.js'

export function resolveFeishuOAuthConfig(
  environment: NodeJS.ProcessEnv = process.env,
): BuildAppConfig['feishuOAuth'] {
  if (environment.FEISHU_REAL_SMOKE !== '1') return undefined
  const clientId = environment.FEISHU_APP_ID
  const clientSecret = environment.FEISHU_APP_SECRET
  return clientId && clientSecret ? { clientId, clientSecret } : undefined
}
