import { describe, expect, it } from 'vitest'

import { BoardOperationQueue } from './board-operation-queue.js'

describe('BoardOperationQueue', () => {
  it('serializes async operations per board while allowing other boards to proceed', async () => {
    const queue = new BoardOperationQueue()
    const events: string[] = []
    let release!: () => void
    const first = queue.run('board-a', async () => {
      events.push('a:start')
      await new Promise<void>((resolve) => { release = resolve })
      events.push('a:end')
    })
    const second = queue.run('board-a', () => { events.push('a:second') })
    const other = queue.run('board-b', () => { events.push('b:first') })

    await other
    expect(events).toEqual(['a:start', 'b:first'])
    release()
    await Promise.all([first, second])
    expect(events).toEqual(['a:start', 'b:first', 'a:end', 'a:second'])
  })
})
