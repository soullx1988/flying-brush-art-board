export interface BoardPreferences {
  favoriteIds: string[]
  archivedIds: string[]
}

function storageKey(projectId: string): string {
  return `infinite-board.board-preferences.v1.${projectId}`
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && item.length > 0))]
}

export function readBoardPreferences(projectId: string): BoardPreferences {
  try {
    const stored = window.localStorage.getItem(storageKey(projectId))
    if (!stored) return { favoriteIds: [], archivedIds: [] }
    const parsed = JSON.parse(stored) as Partial<BoardPreferences>
    return { favoriteIds: strings(parsed.favoriteIds), archivedIds: strings(parsed.archivedIds) }
  } catch {
    return { favoriteIds: [], archivedIds: [] }
  }
}

export function writeBoardPreferences(projectId: string, preferences: BoardPreferences): BoardPreferences {
  const normalized = { favoriteIds: strings(preferences.favoriteIds), archivedIds: strings(preferences.archivedIds) }
  window.localStorage.setItem(storageKey(projectId), JSON.stringify(normalized))
  return normalized
}

export function toggleBoardFavorite(projectId: string, boardId: string): BoardPreferences {
  const current = readBoardPreferences(projectId)
  return writeBoardPreferences(projectId, {
    ...current,
    favoriteIds: current.favoriteIds.includes(boardId)
      ? current.favoriteIds.filter((id) => id !== boardId)
      : [boardId, ...current.favoriteIds],
  })
}

export function setBoardArchived(projectId: string, boardId: string, archived: boolean): BoardPreferences {
  const current = readBoardPreferences(projectId)
  return writeBoardPreferences(projectId, {
    ...current,
    archivedIds: archived
      ? [boardId, ...current.archivedIds.filter((id) => id !== boardId)]
      : current.archivedIds.filter((id) => id !== boardId),
  })
}

export function removeBoardPreference(projectId: string, boardId: string): BoardPreferences {
  const current = readBoardPreferences(projectId)
  return writeBoardPreferences(projectId, {
    favoriteIds: current.favoriteIds.filter((id) => id !== boardId),
    archivedIds: current.archivedIds.filter((id) => id !== boardId),
  })
}
