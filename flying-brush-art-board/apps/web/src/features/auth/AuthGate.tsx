import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ArrowRight, SignOut, UserCircle } from '@phosphor-icons/react'
import { Avatar, Button, Card, toast } from '@ttqtt/liquid-glass-react'

import type { AuthClient, CurrentUser } from './auth-client'
import { CurrentUserContext } from './current-user-context'
import { requestWorkspaceExit } from '../../app/workspace-exit-guard'

type AuthState =
  | { status: 'loading' }
  | { status: 'anonymous' }
  | { status: 'authenticated'; user: CurrentUser }
  | { status: 'error'; code: string }

function returnTo(): string {
  return `${window.location.pathname}${window.location.search}`
}

export function CurrentUserBar({ user, onLogout, loggingOut = false }: { user: CurrentUser; onLogout(): void; loggingOut?: boolean }) {
  const identity = [user.department, user.position].filter(Boolean).join(' · ')
  const displayName = Array.from(user.name).slice(0, 4).join('')
  return (
    <header className="current-user-bar">
      <div className="current-user-bar__identity">
        <Avatar size="sm" shape="circle" fallback={user.name.slice(0, 1)} />
        <div className="current-user-bar__copy">
          <strong title={user.name}>{displayName}</strong>
          {identity ? <span>{identity}</span> : null}
        </div>
      </div>
      <Button variant="ghost" size="sm" icon={<SignOut aria-hidden="true" />} type="button" loading={loggingOut} disabled={loggingOut} onClick={onLogout}>
        退出
      </Button>
    </header>
  )
}

function LoginScreen({ auth, errorCode, onRetry }: { auth: AuthClient; errorCode?: string; onRetry?: () => void }) {
  const loginHref = useMemo(() => auth.loginUrl(returnTo()), [auth])
  const message = errorCode === 'USER_NOT_ALLOWED'
    ? '此飞书账号不在允许名单中。'
    : errorCode === 'USER_DIRECTORY_UNAVAILABLE'
      ? '用户目录暂不可用，请稍后重试。'
      : errorCode ? '身份验证失败，请检查网络后重试。' : undefined
  return (
    <main className="auth-login-page">
      <Card as="section" className="auth-login-card" padding="lg" radius="30px">
        <div className="auth-brand-mark" aria-hidden="true"><UserCircle weight="duotone" /></div>
        <p className="eyebrow">魔灵画板工作区</p>
        <h1>{errorCode ? '身份验证失败' : '欢迎回来'}</h1>
        <p className="auth-login-card__description">使用飞书账号登录，继续访问项目、画板与协作记录。</p>
        {message ? <p role="alert">{message}</p> : null}
        {errorCode && onRetry ? <Button variant="glass" type="button" onClick={onRetry}>重新验证</Button> : null}
        <a className="auth-login-button" href={loginHref}>
          <span>使用飞书登录</span>
          <ArrowRight aria-hidden="true" />
        </a>
      </Card>
    </main>
  )
}

export function AuthGate({ auth, children }: { auth: AuthClient; children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [loggingOut, setLoggingOut] = useState(false)

  useEffect(() => {
    let current = true
    void auth.getMe().then(
      (user) => { if (current) setState(user ? { status: 'authenticated', user } : { status: 'anonymous' }) },
      (error: unknown) => { if (current) setState({ status: 'error', code: (error as { code?: string }).code ?? (error as Error).message }) },
    )
    return () => { current = false }
  }, [auth, attempt])

  if (state.status === 'loading') return <main className="auth-loading" aria-live="polite">正在验证身份…</main>
  if (state.status === 'anonymous') return <LoginScreen auth={auth} />
  if (state.status === 'error') return <LoginScreen auth={auth} errorCode={state.code} onRetry={() => { setState({ status: 'loading' }); setAttempt((value) => value + 1) }} />

  const logout = async () => {
    setLoggingOut(true)
    try {
      await requestWorkspaceExit()
    } catch {
      setLoggingOut(false)
      toast.error('当前画板尚未保存，已取消退出登录。')
      return
    }
    try {
      await auth.logout()
      setState({ status: 'anonymous' })
    } catch {
      toast.error('退出登录失败，请稍后重试。')
    } finally {
      setLoggingOut(false)
    }
  }

  return (
    <CurrentUserContext value={state.user}>
      <div className="authenticated-app">
        <CurrentUserBar
          user={state.user}
          loggingOut={loggingOut}
          onLogout={() => void logout()}
        />
        {children}
      </div>
    </CurrentUserContext>
  )
}
