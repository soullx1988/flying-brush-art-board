export interface CommentThreadView {
  id: string
  shapeId?: string
  x?: number
  y?: number
  shapeOffsetX?: number
  shapeOffsetY?: number
  status: 'open' | 'resolved'
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface CommentMessageView {
  id: string
  threadId: string
  authorOpenId: string
  body: string
  createdAt: string
  deletedAt?: string
}

export interface CommentBoardState {
  threads: CommentThreadView[]
  messages: CommentMessageView[]
}

export interface CommentClient {
  listThreads(boardId: string): Promise<CommentThreadView[]>
  listMessages(threadId: string): Promise<CommentMessageView[]>
  loadBoardComments?(boardId: string): Promise<CommentBoardState>
  createThread(boardId: string, input: { body: string; shapeId?: string; x?: number; y?: number; shapeOffsetX?: number; shapeOffsetY?: number }): Promise<{ thread: CommentThreadView }>
  addMessage(threadId: string, body: string): Promise<CommentMessageView>
  setThreadStatus(threadId: string, status: 'open' | 'resolved'): Promise<CommentThreadView>
  updateThreadAnchor(threadId: string, anchor: { x: number; y: number }): Promise<CommentThreadView>
  deleteThread(threadId: string): Promise<void>
  subscribeToChanges?(boardId: string, onChanged: () => void): () => void
}
