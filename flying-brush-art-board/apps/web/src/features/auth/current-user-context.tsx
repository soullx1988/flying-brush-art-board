import { createContext, useContext } from 'react'

import type { CurrentUser } from './auth-client'

export const CurrentUserContext = createContext<CurrentUser | undefined>(undefined)

export function useCurrentUser(): CurrentUser {
  const user = useContext(CurrentUserContext)
  if (!user) throw new Error('Authenticated current user is required')
  return user
}
