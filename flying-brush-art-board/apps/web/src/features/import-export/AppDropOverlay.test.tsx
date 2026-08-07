import { cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AppDropOverlay } from './AppDropOverlay'

afterEach(cleanup)

function fileDrop(file: File) {
  return {
    dataTransfer: {
      files: [file],
      types: ['Files'],
    },
  }
}

describe('AppDropOverlay', () => {
  it('dispatches typed tab-strip, canvas-point, and global drops through the same controller boundary', () => {
    const onDispatch = vi.fn()
    const file = new File([new Uint8Array([1])], 'fixture.iboard')
    render(<AppDropOverlay onDispatch={onDispatch} />)

    fireEvent.dragEnter(window, fileDrop(file))
    fireEvent.drop(document.querySelector('[data-drop-target="tab-strip"]')!, fileDrop(file))

    fireEvent.dragEnter(window, fileDrop(file))
    const canvasDrop = createEvent.drop(
      document.querySelector('[data-drop-target="canvas"]')!,
      fileDrop(file),
    )
    Object.defineProperties(canvasDrop, {
      clientX: { value: 140 },
      clientY: { value: 260 },
    })
    fireEvent(document.querySelector('[data-drop-target="canvas"]')!, canvasDrop)

    fireEvent.dragEnter(window, fileDrop(file))
    fireEvent.drop(window, fileDrop(file))

    expect(onDispatch).toHaveBeenNthCalledWith(1, [file], { kind: 'tab-strip' })
    expect(onDispatch).toHaveBeenNthCalledWith(2, [file], {
      kind: 'canvas',
      dropPoint: { x: 140, y: 260 },
    })
    expect(onDispatch).toHaveBeenNthCalledWith(3, [file], { kind: 'global' })
  })
})
