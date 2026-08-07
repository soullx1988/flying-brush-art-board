import { performance } from 'node:perf_hooks'

import { describe, expect, it } from 'vitest'

import { interopSceneToSnapshot } from '../../packages/tldraw-adapter/src/index.js'
import { tldrawRealtimeRoomFactory } from '../../apps/local-api/src/modules/realtime/tldraw-realtime-room-factory.js'

function p95(samples: readonly number[]): number {
  const sorted = [...samples].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)]!
}

function largeBoardSnapshot() {
  return interopSceneToSnapshot({
    formatVersion: 1,
    elements: Array.from({ length: 2_000 }, (_, index) => ({
      id: `shape-${index}`,
      type: 'shape' as const,
      shape: 'rectangle',
      geometry: { x: (index % 50) * 120, y: Math.floor(index / 50) * 80, width: 100, height: 60, rotation: 0 },
      zIndex: `a${index.toString(36)}`,
      style: {},
    })),
  }, { referencePolicy: 'preserve' })
}

function localSocket() {
  const listeners = new Map<string, Set<(event: unknown) => void>>()
  return {
    readyState: 1,
    send() {},
    close() {},
    addEventListener(type: string, listener: (event: unknown) => void) {
      const entries = listeners.get(type) ?? new Set()
      entries.add(listener)
      listeners.set(type, entries)
    },
    removeEventListener(type: string, listener: (event: unknown) => void) {
      listeners.get(type)?.delete(listener)
    },
  }
}

describe('realtime room load baseline', () => {
  it('hydrates a 2,000-shape Board with a p95 under 300ms', () => {
    const snapshot = largeBoardSnapshot()
    const samples: number[] = []
    for (let run = 0; run < 10; run += 1) {
      const started = performance.now()
      const room = tldrawRealtimeRoomFactory.create({
        boardId: `load-${run}`,
        initialSnapshot: snapshot,
        onDataChange() {},
        onMessage() {},
      })
      samples.push(performance.now() - started)
      expect((room.getCurrentSnapshot() as { documents: unknown[] }).documents).toHaveLength(2_002)
    }
    expect(p95(samples)).toBeLessThanOrEqual(300)
  })

  it('admits 50 local sessions to one hydrated room within the connection baseline', () => {
    const room = tldrawRealtimeRoomFactory.create({
      boardId: 'many-sessions',
      initialSnapshot: largeBoardSnapshot(),
      onDataChange() {},
      onMessage() {},
    })
    const samples: number[] = []
    for (let index = 0; index < 50; index += 1) {
      const started = performance.now()
      room.handleSocketConnect({
        sessionId: `session-${index}`,
        socket: localSocket(),
        isReadonly: index >= 10,
        meta: { openId: `ou_${index}`, name: `User ${index}` },
      })
      samples.push(performance.now() - started)
    }
    expect(room.getNumActiveSessions()).toBe(50)
    expect(p95(samples)).toBeLessThanOrEqual(300)
  })
})
