import { afterEach, describe, expect, it } from 'vitest'

import {
  acquireEditingLease,
  getEditingLease,
  releaseEditingLease,
} from './editing-lease'

const PROJECT_ID = 'project-a'
const BOARD_ID = 'board-a'

afterEach(() => {
  releaseEditingLease(PROJECT_ID, BOARD_ID, 'tab-a')
  releaseEditingLease(PROJECT_ID, BOARD_ID, 'tab-b')
})

describe('editing lease', () => {
  it('allows only one duplicate board tab to acquire before its first input', () => {
    expect(acquireEditingLease(PROJECT_ID, BOARD_ID, 'tab-a')).toEqual({
      acquired: true,
      lease: { projectId: PROJECT_ID, boardId: BOARD_ID, holderTabId: 'tab-a' },
    })

    expect(acquireEditingLease(PROJECT_ID, BOARD_ID, 'tab-b')).toEqual({
      acquired: false,
      holderTabId: 'tab-a',
    })
    expect(getEditingLease(PROJECT_ID, BOARD_ID)?.holderTabId).toBe('tab-a')
  })

  it('is idempotent for the holder and cannot be released by another tab', () => {
    acquireEditingLease(PROJECT_ID, BOARD_ID, 'tab-a')

    expect(acquireEditingLease(PROJECT_ID, BOARD_ID, 'tab-a').acquired).toBe(true)
    expect(releaseEditingLease(PROJECT_ID, BOARD_ID, 'tab-b')).toBe(false)
    expect(getEditingLease(PROJECT_ID, BOARD_ID)?.holderTabId).toBe('tab-a')

    expect(releaseEditingLease(PROJECT_ID, BOARD_ID, 'tab-a')).toBe(true)
    expect(getEditingLease(PROJECT_ID, BOARD_ID)).toBeUndefined()
  })
})
