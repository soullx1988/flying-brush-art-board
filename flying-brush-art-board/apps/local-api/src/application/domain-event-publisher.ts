export interface DomainApplicationEvent {
  type: string
  actorOpenId: string
  actorName: string
  clientId: string
  operationId: string
  toolName?: string
  projectId?: string
  boardId?: string
  summary: string
  affectedIds?: string[]
  createdAt: string
}

export interface DomainEventPublisher {
  publish(event: DomainApplicationEvent): void
}

export class ApplicationEventHub implements DomainEventPublisher {
  private readonly listeners = new Set<(event: DomainApplicationEvent) => void>()

  publish(event: DomainApplicationEvent): void {
    for (const listener of this.listeners) listener(event)
  }

  subscribe(listener: (event: DomainApplicationEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}
