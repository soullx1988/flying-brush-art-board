import { beforeEach, describe, expect, it } from 'vitest'

import {
  readCanvasToolStylePreference,
  writeCanvasToolStylePreference,
  writeTextBackgroundPreference,
} from './tool-style-preferences'

describe('canvas tool style preferences', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('isolates preferences by account id', () => {
    writeCanvasToolStylePreference('account-a', 'arrow', {
      styles: { 'tldraw:color': 'red' },
      opacity: 0.25,
    })
    writeCanvasToolStylePreference('account-b', 'arrow', {
      styles: { 'tldraw:color': 'blue' },
      opacity: 0.75,
    })

    expect(readCanvasToolStylePreference('account-a', 'arrow')).toEqual({
      styles: { 'tldraw:color': 'red' },
      opacity: 0.25,
    })
    expect(readCanvasToolStylePreference('account-b', 'arrow')).toEqual({
      styles: { 'tldraw:color': 'blue' },
      opacity: 0.75,
    })
    expect([...Array(window.localStorage.length)].map((_, index) => window.localStorage.key(index)))
      .toEqual(expect.arrayContaining([
        'infinite-board.canvas-tool-style-preferences.v1.account-a',
        'infinite-board.canvas-tool-style-preferences.v1.account-b',
      ]))
  })

  it('keeps arrow and text preferences independent while normalizing written values', () => {
    writeCanvasToolStylePreference('account-a', 'arrow', {
      styles: {
        'tldraw:color': 'red',
        'tldraw:size': 'l',
        ignoredObject: { nested: true },
        ignoredArray: ['solid'],
      },
      opacity: -1,
    })
    writeCanvasToolStylePreference('account-a', 'text', {
      styles: {
        'tldraw:font': 'serif',
        booleanPrimitive: true,
        numberPrimitive: 2,
        nullPrimitive: null,
      },
      opacity: 5,
      background: { color: '  yellow  ', fill: 'semi' },
    })

    expect(readCanvasToolStylePreference('account-a', 'arrow')).toEqual({
      styles: {
        'tldraw:color': 'red',
        'tldraw:size': 'l',
      },
      opacity: 0,
    })
    expect(readCanvasToolStylePreference('account-a', 'text')).toEqual({
      styles: {
        'tldraw:font': 'serif',
        booleanPrimitive: true,
        numberPrimitive: 2,
        nullPrimitive: null,
      },
      opacity: 1,
      background: { color: 'yellow', fill: 'semi' },
    })

    writeCanvasToolStylePreference('account-a', 'arrow', {
      styles: { 'tldraw:color': 'green' },
      opacity: 0.5,
    })
    expect(readCanvasToolStylePreference('account-a', 'text')).toEqual({
      styles: {
        'tldraw:font': 'serif',
        booleanPrimitive: true,
        numberPrimitive: 2,
        nullPrimitive: null,
      },
      opacity: 1,
      background: { color: 'yellow', fill: 'semi' },
    })
  })

  it('tolerates corrupt storage and drops invalid nested values', () => {
    const key = 'infinite-board.canvas-tool-style-preferences.v1.account-a'
    window.localStorage.setItem(key, '{not-json')
    expect(readCanvasToolStylePreference('account-a', 'arrow')).toBeUndefined()

    window.localStorage.setItem(key, JSON.stringify({
      arrow: {
        styles: {
          color: 'red',
          enabled: false,
          nested: { value: 'solid' },
          list: ['draw'],
        },
        opacity: 'opaque',
        background: { color: '', fill: 'invalid' },
      },
      text: 'invalid',
    }))

    expect(readCanvasToolStylePreference('account-a', 'arrow')).toEqual({
      styles: { color: 'red', enabled: false },
      opacity: 1,
    })
    expect(readCanvasToolStylePreference('account-a', 'text')).toBeUndefined()
  })

  it('merges text background with existing text styles and opacity', () => {
    writeCanvasToolStylePreference('account-a', 'arrow', {
      styles: { 'tldraw:color': 'violet' },
      opacity: 0.25,
    })
    writeCanvasToolStylePreference('account-a', 'text', {
      styles: {
        'tldraw:color': 'black',
        'tldraw:font': 'mono',
      },
      opacity: 0.5,
    })

    expect(writeTextBackgroundPreference('account-a', { color: 'blue', fill: 'pattern' }))
      .toEqual({ color: 'blue', fill: 'pattern' })
    expect(readCanvasToolStylePreference('account-a', 'text')).toEqual({
      styles: {
        'tldraw:color': 'black',
        'tldraw:font': 'mono',
      },
      opacity: 0.5,
      background: { color: 'blue', fill: 'pattern' },
    })
    expect(readCanvasToolStylePreference('account-a', 'arrow')).toEqual({
      styles: { 'tldraw:color': 'violet' },
      opacity: 0.25,
    })
  })

  it('creates a default text preference when only a background is written', () => {
    writeTextBackgroundPreference('account-a', { color: 'orange', fill: 'solid' })

    expect(readCanvasToolStylePreference('account-a', 'text')).toEqual({
      styles: {},
      opacity: 1,
      background: { color: 'orange', fill: 'solid' },
    })
  })
})
