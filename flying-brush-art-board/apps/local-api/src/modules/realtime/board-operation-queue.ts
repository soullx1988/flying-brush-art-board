/** Serializes durable board mutations and realtime snapshot projections per board. */
export class BoardOperationQueue {
  private readonly queues = new Map<string, Promise<void>>()

  run<T>(boardId: string, operation: () => Promise<T> | T): Promise<T> {
    const previous = this.queues.get(boardId)
    let current: Promise<T>
    if (previous) {
      current = previous.then(operation)
    } else {
      try {
        const result = operation()
        if (!result || typeof (result as { then?: unknown }).then !== 'function') {
          return Promise.resolve(result)
        }
        current = Promise.resolve(result)
      } catch (error) {
        return Promise.reject(error)
      }
    }
    const settled = current.then(() => undefined, () => undefined)
    this.queues.set(boardId, settled)
    void settled.finally(() => {
      if (this.queues.get(boardId) === settled) this.queues.delete(boardId)
    })
    return current
  }
}
