export interface ProjectPreferences {
  recentIds: string[]
  favoriteIds: string[]
  archivedIds: string[]
}

const STORAGE_KEY = 'infinite-board.project-preferences.v1'
const EMPTY_PREFERENCES: ProjectPreferences = {
  recentIds: [],
  favoriteIds: [],
  archivedIds: [],
}

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && item.length > 0))]
}

export function readProjectPreferences(): ProjectPreferences {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (!stored) return EMPTY_PREFERENCES
    const parsed = JSON.parse(stored) as Partial<ProjectPreferences>
    return {
      recentIds: uniqueStrings(parsed.recentIds),
      favoriteIds: uniqueStrings(parsed.favoriteIds),
      archivedIds: uniqueStrings(parsed.archivedIds),
    }
  } catch {
    return EMPTY_PREFERENCES
  }
}

export function writeProjectPreferences(preferences: ProjectPreferences): ProjectPreferences {
  const normalized = {
    recentIds: uniqueStrings(preferences.recentIds).slice(0, 12),
    favoriteIds: uniqueStrings(preferences.favoriteIds),
    archivedIds: uniqueStrings(preferences.archivedIds),
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
  return normalized
}

export function markProjectOpened(projectId: string): ProjectPreferences {
  const current = readProjectPreferences()
  return writeProjectPreferences({
    ...current,
    recentIds: [projectId, ...current.recentIds.filter((id) => id !== projectId)],
  })
}

export function toggleProjectFavorite(projectId: string): ProjectPreferences {
  const current = readProjectPreferences()
  const favoriteIds = current.favoriteIds.includes(projectId)
    ? current.favoriteIds.filter((id) => id !== projectId)
    : [projectId, ...current.favoriteIds]
  return writeProjectPreferences({ ...current, favoriteIds })
}

export function setProjectArchived(projectId: string, archived: boolean): ProjectPreferences {
  const current = readProjectPreferences()
  return writeProjectPreferences({
    ...current,
    archivedIds: archived
      ? [projectId, ...current.archivedIds.filter((id) => id !== projectId)]
      : current.archivedIds.filter((id) => id !== projectId),
  })
}

export function removeProjectPreference(projectId: string): ProjectPreferences {
  const current = readProjectPreferences()
  return writeProjectPreferences({
    recentIds: current.recentIds.filter((id) => id !== projectId),
    favoriteIds: current.favoriteIds.filter((id) => id !== projectId),
    archivedIds: current.archivedIds.filter((id) => id !== projectId),
  })
}
