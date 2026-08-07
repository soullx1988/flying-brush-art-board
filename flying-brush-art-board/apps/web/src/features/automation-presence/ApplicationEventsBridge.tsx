import { useEffect } from 'react'

import { startApplicationEvents } from './application-events'

export function ApplicationEventsBridge() {
  useEffect(() => startApplicationEvents(), [])
  return null
}
