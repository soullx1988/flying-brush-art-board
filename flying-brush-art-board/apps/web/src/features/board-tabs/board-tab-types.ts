import type { BoardSessionStatus } from '../boards/board-session'

export interface BoardTabView {
  tabId: string
  boardId: string
  title: string
  status: BoardSessionStatus
  readOnly: boolean
}
