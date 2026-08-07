import 'tldraw/tldraw.css'
import '@ttqtt/liquid-glass-react/style.css'
import './styles.css'
import { LiquidGlassConfig, Toaster } from '@ttqtt/liquid-glass-react'
import { AppRouter } from './app/router'
import { AuthGate } from './features/auth/AuthGate'
import { LocalAuthClient, type AuthClient } from './features/auth/auth-client'
import { appLiquidTheme } from './ui/liquid-theme'
import { ApplicationEventsBridge } from './features/automation-presence/ApplicationEventsBridge'

export function App({ authClient = new LocalAuthClient() }: { authClient?: AuthClient }) {
  return (
    <LiquidGlassConfig locale="zh-CN" theme={appLiquidTheme}>
      <AuthGate auth={authClient}><ApplicationEventsBridge /><AppRouter /></AuthGate>
      <Toaster position="top-center" />
    </LiquidGlassConfig>
  )
}
