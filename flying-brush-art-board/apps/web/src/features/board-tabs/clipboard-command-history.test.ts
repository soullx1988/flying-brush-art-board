import { describe, expect, it } from 'vitest'

import { ClipboardCommandHistoryStore } from './clipboard-command-history'

describe('clipboard command history', () => {
  it('undoes and redoes stacked commands in strict command order', () => {
    const history = new ClipboardCommandHistoryStore()
    history.record('tab-1', 'board-A', 'command-A')
    history.record('tab-1', 'board-A', 'command-B')

    expect(history.nextUndo('tab-1', 'board-A')).toBe('command-B')
    expect(history.confirmUndo('tab-1', 'board-A', 'command-B')).toBe(true)
    expect(history.nextUndo('tab-1', 'board-A')).toBe('command-A')
    expect(history.confirmUndo('tab-1', 'board-A', 'command-A')).toBe(true)

    expect(history.nextRedo('tab-1', 'board-A')).toBe('command-A')
    expect(history.confirmRedo('tab-1', 'board-A', 'command-A')).toBe(true)
    expect(history.nextRedo('tab-1', 'board-A')).toBe('command-B')
    expect(history.confirmRedo('tab-1', 'board-A', 'command-B')).toBe(true)
  })

  it('isolates history when the same tab navigates to another board', () => {
    const history = new ClipboardCommandHistoryStore()
    history.record('tab-1', 'board-A', 'command-A')

    expect(history.nextUndo('tab-1', 'board-B')).toBeUndefined()
    expect(history.nextRedo('tab-1', 'board-B')).toBeUndefined()
    expect(history.nextUndo('tab-1', 'board-A')).toBe('command-A')
  })

  it('drops the redo tail when a new command follows an undo', () => {
    const history = new ClipboardCommandHistoryStore()
    history.record('tab-1', 'board-A', 'command-A')
    history.record('tab-1', 'board-A', 'command-B')
    expect(history.confirmUndo('tab-1', 'board-A', 'command-B')).toBe(true)

    history.record('tab-1', 'board-A', 'command-C')

    expect(history.nextRedo('tab-1', 'board-A')).toBeUndefined()
    expect(history.nextUndo('tab-1', 'board-A')).toBe('command-C')
    expect(history.confirmUndo('tab-1', 'board-A', 'command-C')).toBe(true)
    expect(history.nextUndo('tab-1', 'board-A')).toBe('command-A')
  })
})
