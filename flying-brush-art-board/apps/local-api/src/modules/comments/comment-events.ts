export interface CommentChangedEvent {
  id: string
  type: 'comment.changed'
  boardId: string
  threadId: string
  action: 'create' | 'reply' | 'resolve' | 'reopen' | 'delete' | 'move'
  messageId?: string
}

export type CommentChangedEventInput = Omit<CommentChangedEvent, 'id'>

interface Subscriber {
  send(event: CommentChangedEvent): boolean
  close?(): void
}

export interface CommentEventHubOptions {
  maxSubscribersPerBoard?: number
  maxSubscribersTotal?: number
  replaySize?: number
}

export class CommentEventHub {
  private readonly subscribers = new Map<string, Set<Subscriber>>()
  private readonly history = new Map<string, CommentChangedEvent[]>()
  private readonly maxSubscribersPerBoard: number
  private readonly maxSubscribersTotal: number
  private readonly replaySize: number
  private nextEventId = 0

  constructor(options: CommentEventHubOptions = {}) {
    this.maxSubscribersPerBoard = options.maxSubscribersPerBoard ?? 32
    this.maxSubscribersTotal = options.maxSubscribersTotal ?? 256
    this.replaySize = options.replaySize ?? 200
  }

  canSubscribe(boardId: string): boolean {
    return this.subscriberCount(boardId) < this.maxSubscribersPerBoard
      && this.subscriberCount() < this.maxSubscribersTotal
  }

  subscribe(
    boardId: string,
    send: Subscriber['send'],
    close?: Subscriber['close'],
    afterEventId?: string,
  ): () => void {
    if (!this.canSubscribe(boardId)) throw new Error('COMMENT_EVENT_CONNECTION_LIMIT')
    const subscriber: Subscriber = { send, ...(close ? { close } : {}) }
    const boardSubscribers = this.subscribers.get(boardId) ?? new Set<Subscriber>()
    boardSubscribers.add(subscriber)
    this.subscribers.set(boardId, boardSubscribers)

    const unsubscribe = () => {
      boardSubscribers.delete(subscriber)
      if (boardSubscribers.size === 0) this.subscribers.delete(boardId)
    }
    for (const event of this.eventsAfter(boardId, afterEventId)) {
      if (subscriber.send(event)) continue
      unsubscribe()
      subscriber.close?.()
      break
    }
    return unsubscribe
  }

  publish(input: CommentChangedEventInput): CommentChangedEvent {
    const event: CommentChangedEvent = { ...input, id: String(++this.nextEventId) }
    const boardHistory = this.history.get(event.boardId) ?? []
    boardHistory.push(event)
    if (boardHistory.length > this.replaySize) boardHistory.splice(0, boardHistory.length - this.replaySize)
    this.history.set(event.boardId, boardHistory)

    for (const subscriber of [...(this.subscribers.get(event.boardId) ?? [])]) {
      let accepted = false
      try { accepted = subscriber.send(event) } catch { accepted = false }
      if (accepted) continue
      this.removeSubscriber(event.boardId, subscriber)
      subscriber.close?.()
    }
    return event
  }

  subscriberCount(boardId?: string): number {
    if (boardId) return this.subscribers.get(boardId)?.size ?? 0
    return [...this.subscribers.values()].reduce((total, subscribers) => total + subscribers.size, 0)
  }

  close(): void {
    for (const subscribers of this.subscribers.values()) {
      for (const subscriber of subscribers) subscriber.close?.()
    }
    this.subscribers.clear()
    this.history.clear()
  }

  private eventsAfter(boardId: string, afterEventId: string | undefined): CommentChangedEvent[] {
    if (!afterEventId) return []
    const history = this.history.get(boardId) ?? []
    const index = history.findIndex((event) => event.id === afterEventId)
    return index >= 0 ? history.slice(index + 1) : history
  }

  private removeSubscriber(boardId: string, subscriber: Subscriber): void {
    const boardSubscribers = this.subscribers.get(boardId)
    boardSubscribers?.delete(subscriber)
    if (boardSubscribers?.size === 0) this.subscribers.delete(boardId)
  }
}
