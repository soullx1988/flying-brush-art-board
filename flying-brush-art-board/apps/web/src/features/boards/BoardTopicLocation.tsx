import { Button } from '@ttqtt/liquid-glass-react'
import { navigationPath } from '@infinite-board/board-core'
import type { ProjectHomeData } from './ProjectHomePage'

export function BoardTopicLocation({ data, boardId, onShowMap }: { data: ProjectHomeData; boardId: string; onShowMap(): void }) {
  const navigation = data.project.navigation
  if (!navigation?.topics.length) return null
  const path = navigationPath(navigation, boardId).map((id) => navigation.topics.find((topic) => topic.id === id)?.title ?? data.boards.find((board) => board.id === id)?.title ?? '待归类')
  const label = path.length > 1 ? path.slice(0, -1).join(' › ') : '待归类'
  return <div className="board-topic-location"><Button variant="ghost" size="sm" onClick={onShowMap}>主题地图与关系</Button><span className="board-topic-location__path" title={label}>所在位置：{label}</span></div>
}
