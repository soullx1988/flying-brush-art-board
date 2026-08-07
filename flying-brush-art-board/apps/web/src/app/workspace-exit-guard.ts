export type WorkspaceExitGuard = () => void | Promise<void>

let activeGuard: WorkspaceExitGuard | undefined

export function registerWorkspaceExitGuard(guard: WorkspaceExitGuard): () => void {
  activeGuard = guard
  return () => {
    if (activeGuard === guard) activeGuard = undefined
  }
}

export async function requestWorkspaceExit(): Promise<void> {
  await activeGuard?.()
}
