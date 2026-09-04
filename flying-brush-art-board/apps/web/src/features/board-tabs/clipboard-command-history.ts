interface ClipboardTargetHistory {
  commandIds: string[]
  cursor: number
}

function targetKey(tabId: string, boardId: string): string {
  return `${tabId}\u0000${boardId}`
}

/**
 * Clipboard structural commands are scoped to one tab/board pair. A cursor
 * gives deterministic LIFO undo and FIFO redo without allowing a tab that has
 * navigated elsewhere to replay commands from its previous board.
 */
export class ClipboardCommandHistoryStore {
  private readonly histories = new Map<string, ClipboardTargetHistory>()

  record(tabId: string, boardId: string, commandId: string): void {
    const key = targetKey(tabId, boardId)
    const current = this.histories.get(key) ?? { commandIds: [], cursor: 0 }
    const commandIds = current.commandIds.slice(0, current.cursor)
    commandIds.push(commandId)
    this.histories.set(key, { commandIds, cursor: commandIds.length })
  }

  nextUndo(tabId: string, boardId: string): string | undefined {
    const history = this.histories.get(targetKey(tabId, boardId))
    return history && history.cursor > 0 ? history.commandIds[history.cursor - 1] : undefined
  }

  nextRedo(tabId: string, boardId: string): string | undefined {
    const history = this.histories.get(targetKey(tabId, boardId))
    return history && history.cursor < history.commandIds.length
      ? history.commandIds[history.cursor]
      : undefined
  }

  confirmUndo(tabId: string, boardId: string, commandId: string): boolean {
    const history = this.histories.get(targetKey(tabId, boardId))
    if (!history || history.cursor === 0 || history.commandIds[history.cursor - 1] !== commandId) {
      return false
    }
    history.cursor -= 1
    return true
  }

  confirmRedo(tabId: string, boardId: string, commandId: string): boolean {
    const history = this.histories.get(targetKey(tabId, boardId))
    if (!history || history.cursor >= history.commandIds.length || history.commandIds[history.cursor] !== commandId) {
      return false
    }
    history.cursor += 1
    return true
  }
}
