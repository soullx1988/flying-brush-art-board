export interface LocalAcceptanceUser {
  id: string
  name: string
}

export type AuthGate =
  | {
    authenticationEnabled: false
    whitelistEnabled: false
    mode: 'development-bypass'
    localUser: LocalAcceptanceUser
  }
  | {
    authenticationEnabled: true
    whitelistEnabled: boolean
    mode: 'feishu-login-required'
  }

type Environment = Record<string, string | undefined>

const localAcceptanceUser: LocalAcceptanceUser = {
  id: 'local-acceptance-user',
  name: 'Local acceptance user',
}

function readBoolean(environment: Environment, name: string, defaultValue: boolean): boolean {
  const value = environment[name]
  if (value === undefined || value === '') return defaultValue
  if (value === 'true') return true
  if (value === 'false') return false
  throw new Error(`${name} must be true or false`)
}

export function loadAuthGate(environment: Environment): AuthGate {
  const authenticationEnabled = readBoolean(environment, 'FEISHU_AUTH_ENABLED', false)
  const whitelistEnabled = readBoolean(environment, 'FEISHU_WHITELIST_ENABLED', false)

  if (environment.NODE_ENV === 'production' && !authenticationEnabled) {
    throw new Error('FEISHU_AUTH_ENABLED must be true in production')
  }
  if (whitelistEnabled && !authenticationEnabled) {
    throw new Error('FEISHU_WHITELIST_ENABLED requires FEISHU_AUTH_ENABLED')
  }
  if (!authenticationEnabled) {
    return {
      authenticationEnabled: false,
      whitelistEnabled: false,
      mode: 'development-bypass',
      localUser: localAcceptanceUser,
    }
  }

  return {
    authenticationEnabled: true,
    whitelistEnabled,
    mode: 'feishu-login-required',
  }
}
