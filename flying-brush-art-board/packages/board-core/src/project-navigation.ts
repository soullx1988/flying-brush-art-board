/** Shared reading structure. Content, titles and cross-links stay on existing boards. */
export interface ProjectTopic {
  id: string
  title: string
  description: string
}

export interface ProjectNavigation {
  version: 1
  revision: number
  topics: ProjectTopic[]
  /** Board ID -> topic ID or board ID. Missing entries are visibly unclassified. */
  parents: Record<string, string>
}

export function emptyProjectNavigation(): ProjectNavigation {
  return { version: 1, revision: 0, topics: [], parents: {} }
}

export function assertProjectNavigationValid(navigation: ProjectNavigation, boardIds: readonly string[]): void {
  const boards = new Set(boardIds)
  const topics = new Set(navigation.topics.map((topic) => topic.id))
  if (topics.size !== navigation.topics.length || navigation.topics.some((topic) => !topic.id.startsWith('topic:') || boards.has(topic.id))) {
    throw new Error('NAVIGATION_TOPIC_INVALID')
  }
  for (const [boardId, parentId] of Object.entries(navigation.parents)) {
    if (!boards.has(boardId) || (!boards.has(parentId) && !topics.has(parentId))) throw new Error('NAVIGATION_BOARD_NOT_FOUND')
    const visited = new Set([boardId])
    let cursor: string | undefined = parentId
    while (cursor && !topics.has(cursor)) {
      if (visited.has(cursor)) throw new Error('NAVIGATION_CYCLE')
      visited.add(cursor)
      cursor = navigation.parents[cursor]
    }
  }
}

/** Root-first path. Defensive against deleted nodes and damaged imported metadata. */
export function navigationPath(navigation: ProjectNavigation | undefined, id: string): string[] {
  const path = [id]
  const visited = new Set(path)
  let cursor = navigation?.parents[id]
  while (cursor && !visited.has(cursor)) {
    path.unshift(cursor)
    visited.add(cursor)
    cursor = navigation?.parents[cursor]
  }
  return path
}

export function removeNavigationBoard(navigation: ProjectNavigation, boardId: string): ProjectNavigation {
  const parents = { ...navigation.parents }
  const previousParent = parents[boardId]
  delete parents[boardId]
  for (const [child, parent] of Object.entries(parents)) {
    if (parent !== boardId) continue
    if (previousParent) parents[child] = previousParent
    else delete parents[child]
  }
  return { ...navigation, revision: navigation.revision + 1, parents }
}
