export interface BoardEditingLease {
  projectId: string
  boardId: string
  holderTabId: string
}

export type EditingLeaseResult =
  | { acquired: true; lease: BoardEditingLease }
  | { acquired: false; holderTabId: string }

// A lease is intentionally process-local: it coordinates duplicate tabs in this
// workspace and is not a substitute for the server's revision CAS.
const leaseRegistry = new Map<string, BoardEditingLease>()

function leaseKey(projectId: string, boardId: string): string {
  return JSON.stringify([projectId, boardId])
}

export function acquireEditingLease(
  projectId: string,
  boardId: string,
  tabId: string,
): EditingLeaseResult {
  const key = leaseKey(projectId, boardId)
  const existing = leaseRegistry.get(key)
  if (existing && existing.holderTabId !== tabId) {
    return { acquired: false, holderTabId: existing.holderTabId }
  }

  const lease = existing ?? { projectId, boardId, holderTabId: tabId }
  leaseRegistry.set(key, lease)
  return { acquired: true, lease }
}

export function releaseEditingLease(
  projectId: string,
  boardId: string,
  tabId: string,
): boolean {
  const key = leaseKey(projectId, boardId)
  const existing = leaseRegistry.get(key)
  if (!existing || existing.holderTabId !== tabId) return false
  return leaseRegistry.delete(key)
}

export function getEditingLease(
  projectId: string,
  boardId: string,
): BoardEditingLease | undefined {
  return leaseRegistry.get(leaseKey(projectId, boardId))
}
