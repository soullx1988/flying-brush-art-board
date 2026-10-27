import { describe, expect, it } from 'vitest'

import type { BoardHistoryEntry, BoardReferenceRecord } from '@infinite-board/board-core'

import {
  appendReferenceEntry,
  createReferenceTabHistory,
  currentReferenceTrail,
  findInboundReferences,
  historyBreadcrumbEntries,
  projectBrowserHistoryState,
  validateSharedReferencePath,
} from './navigation-state'

const now = '2026-07-23T00:00:00.000Z'

function reference(
  id: string,
  sourceBoardId: string,
  targetBoardId: string,
  kind: 'embed' | 'link' = 'link',
): BoardReferenceRecord {
  return {
    id,
    projectId: 'project-1',
    sourceBoardId,
    targetBoardId,
    shapeId: `shape:${id}`,
    kind,
    createdAt: now,
    updatedAt: now,
  }
}

function entry(entryId: string, boardId: string): BoardHistoryEntry {
  return {
    entryId,
    projectId: 'project-1',
    boardId,
    viewState: {
      camera: { x: 10, y: 20, z: 2 },
      selectedShapeIds: [`shape:${entryId}`],
      currentToolId: 'draw',
    },
  }
}

describe('board reference navigation state', () => {
  it('shows only the reference trail after a direct open while preserving the full history', () => {
    const first = appendReferenceEntry([entry('a', 'board-a')], 0, reference('a-b', 'board-a', 'board-b'), () => 'b-via')
    const history = [...first.history, entry('b-direct', 'board-b')]
    expect(currentReferenceTrail(history, 2).map((candidate) => candidate.entryId)).toEqual(['b-direct'])
    const next = appendReferenceEntry(history, 2, reference('b-c', 'board-b', 'board-c'), () => 'c')
    expect(currentReferenceTrail(next.history, 3).map((candidate) => candidate.entryId)).toEqual(['b-direct', 'c'])
    expect(currentReferenceTrail(next.history, 1).map((candidate) => candidate.entryId)).toEqual(['a', 'b-via'])
    expect(next.history).toHaveLength(4)
  })

  it('appends a new actual entry even when a link returns to a previously visited board', () => {
    const aToB = reference('a-b', 'board-a', 'board-b')
    const bToA = reference('b-a', 'board-b', 'board-a')
    const first = appendReferenceEntry([entry('entry-a-1', 'board-a')], 0, aToB, () => 'entry-b')
    const second = appendReferenceEntry(first.history, first.historyIndex, bToA, () => 'entry-a-2')

    expect(second.history.map(({ entryId, boardId }) => ({ entryId, boardId }))).toEqual([
      { entryId: 'entry-a-1', boardId: 'board-a' },
      { entryId: 'entry-b', boardId: 'board-b' },
      { entryId: 'entry-a-2', boardId: 'board-a' },
    ])
    expect(second.history[2]?.via).toMatchObject({
      referenceId: 'b-a',
      sourceBoardId: 'board-b',
      targetBoardId: 'board-a',
    })
  })

  it('truncates forward entries when a new reference is entered after a history jump', () => {
    const result = appendReferenceEntry(
      [entry('entry-a', 'board-a'), entry('entry-b', 'board-b'), entry('entry-c', 'board-c')],
      0,
      reference('a-d', 'board-a', 'board-d'),
      () => 'entry-d',
    )

    expect(result.history.map((candidate) => candidate.boardId)).toEqual(['board-a', 'board-d'])
    expect(result.historyIndex).toBe(1)
  })

  it('initializes a reference-opened tab with independent source and target entries', () => {
    const source = entry('source-original', 'board-a')
    const result = createReferenceTabHistory(source, reference('a-c', 'board-a', 'board-c'), (() => {
      const ids = ['source-copy', 'target-entry']
      return () => ids.shift()!
    })())

    expect(result.history.map(({ entryId, boardId }) => ({ entryId, boardId }))).toEqual([
      { entryId: 'source-copy', boardId: 'board-a' },
      { entryId: 'target-entry', boardId: 'board-c' },
    ])
    expect(result.history[0]).not.toBe(source)
    expect(result.history[0]?.viewState).toEqual(source.viewState)
    expect(result.history[0]?.viewState).not.toBe(source.viewState)
    expect(result.historyIndex).toBe(1)
  })

  it('derives breadcrumbs only from the actual path through the current entry', () => {
    const history = [entry('entry-a', 'board-a'), entry('entry-b', 'board-b'), entry('entry-a-2', 'board-a')]

    expect(historyBreadcrumbEntries(history, 2).map((candidate) => candidate.entryId)).toEqual([
      'entry-a',
      'entry-b',
      'entry-a-2',
    ])
    expect(historyBreadcrumbEntries(history, 1).map((candidate) => candidate.entryId)).toEqual([
      'entry-a',
      'entry-b',
    ])
  })

  it('validates every shared path edge and falls back to a bare deep link on any mismatch', () => {
    const references = [
      reference('a-b', 'board-a', 'board-b'),
      reference('b-c', 'board-b', 'board-c'),
      reference('a-c', 'board-a', 'board-c'),
    ]

    expect(validateSharedReferencePath('project-1', 'board-c', ['a-b', 'b-c'], references))
      .toEqual([references[0], references[1]])
    expect(validateSharedReferencePath('project-1', 'board-c', ['a-b', 'a-c'], references))
      .toEqual([])
    expect(validateSharedReferencePath('project-1', 'board-b', ['a-b', 'b-c'], references))
      .toEqual([])
  })

  it('lists every inbound reference position for a bare board URL', () => {
    const aToC = reference('a-c', 'board-a', 'board-c')
    const bToC = reference('b-c', 'board-b', 'board-c', 'embed')

    expect(findInboundReferences('board-c', [bToC, reference('a-b', 'board-a', 'board-b'), aToC]))
      .toEqual([aToC, bToC])
  })

  it('projects only the active tab entry identifiers into browser history state', () => {
    expect(projectBrowserHistoryState('tab-7', entry('entry-c', 'board-c'))).toEqual({
      tabId: 'tab-7',
      entryId: 'entry-c',
      projectId: 'project-1',
      boardId: 'board-c',
    })
  })
})
