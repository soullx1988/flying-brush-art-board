import { describe, expect, it } from 'vitest'

import {
  addMindMapChild,
  addMindMapSibling,
  applyMindMapDrop,
  copyMindMapBranch,
  copyMindMapNodeVisualStyle,
  countMindMapDescendants,
  createMindMapProps,
  deleteMindMapBranch,
  duplicateMindMapBranch,
  getMindMapDropCandidate,
  getMindMapRoot,
  getMindMapRootAnchorDelta,
  layoutMindMap,
  moveMindMapNode,
  pasteMindMapBranch,
  pasteMindMapNodeVisualStyle,
  promoteMindMapNode,
  setMindMapBranchSide,
  setMindMapLayout,
  setMindMapTheme,
  toggleMindMapCollapsed,
  updateMindMapNodeStyle,
} from './operations.js'

function ids() {
  let value = 0
  return (prefix: string) => `${prefix}-${value++}`
}

describe('mind map operations', () => {
  it('adds children and siblings with stable tree relationships', () => {
    const source = createMindMapProps('Root', ids())
    const root = getMindMapRoot(source)!
    const child = addMindMapChild(source, root.id, ids())
    const sibling = addMindMapSibling(child.props, child.nodeId!, ids())

    expect(child.props.nodes.find((node) => node.id === child.nodeId)?.parentId).toBe(root.id)
    expect(sibling.props.nodes.filter((node) => node.parentId === root.id).map((node) => node.order)).toEqual([0, 1])
  })

  it('promotes a nested node and deletes an entire branch', () => {
    const source = createMindMapProps('Root', ids())
    const root = getMindMapRoot(source)!
    const parent = addMindMapChild(source, root.id, ids())
    const child = addMindMapChild(parent.props, parent.nodeId!, ids())
    const promoted = promoteMindMapNode(child.props, child.nodeId!)
    const removed = deleteMindMapBranch(promoted, parent.nodeId!)

    expect(promoted.nodes.find((node) => node.id === child.nodeId)?.parentId).toBe(root.id)
    expect(removed.nodes.some((node) => node.id === parent.nodeId)).toBe(false)
    expect(removed.nodes.some((node) => node.id === child.nodeId)).toBe(true)
  })

  it('lays out right and bilateral trees deterministically', () => {
    const source = createMindMapProps('Root', ids())
    const root = getMindMapRoot(source)!
    const first = addMindMapChild(source, root.id, ids())
    const second = addMindMapChild(first.props, root.id, ids())
    const bilateral = setMindMapBranchSide(setMindMapLayout(second.props, 'bilateral'), second.nodeId!, 'left')
    const layout = layoutMindMap(bilateral)
    const rootPosition = layout.nodes.find((node) => node.id === root.id)!

    expect(layout.nodes.find((node) => node.id === first.nodeId)!.x).toBeGreaterThan(rootPosition.x)
    expect(layout.nodes.find((node) => node.id === second.nodeId)!.x).toBeLessThan(rootPosition.x)
    expect(layoutMindMap(bilateral)).toEqual(layout)
  })

  it('hides descendants of collapsed nodes without deleting them', () => {
    const source = createMindMapProps('Root', ids())
    const root = getMindMapRoot(source)!
    const parent = addMindMapChild(source, root.id, ids())
    const child = addMindMapChild(parent.props, parent.nodeId!, ids())
    const collapsed = toggleMindMapCollapsed(child.props, parent.nodeId!)

    expect(collapsed.nodes.some((node) => node.id === child.nodeId)).toBe(true)
    expect(layoutMindMap(collapsed).nodes.some((node) => node.id === child.nodeId)).toBe(false)
  })

  it('reorders siblings and reparents whole branches without cycles', () => {
    const source = createMindMapProps('Root', ids())
    const root = getMindMapRoot(source)!
    const first = addMindMapChild(source, root.id, ids())
    const second = addMindMapChild(first.props, root.id, ids())
    const nested = addMindMapChild(second.props, first.nodeId!, ids())
    const reordered = moveMindMapNode(nested.props, second.nodeId!, root.id, 0)
    const reparented = moveMindMapNode(reordered, first.nodeId!, second.nodeId!)

    expect(reordered.nodes.filter((node) => node.parentId === root.id).sort((a, b) => a.order - b.order)[0]?.id).toBe(second.nodeId)
    expect(reparented.nodes.find((node) => node.id === first.nodeId)?.parentId).toBe(second.nodeId)
    expect(reparented.nodes.find((node) => node.id === nested.nodeId)?.parentId).toBe(first.nodeId)
    expect(moveMindMapNode(reparented, second.nodeId!, nested.nodeId!)).toBe(reparented)
  })

  it('computes pointer drop candidates for sibling insertion, reparenting and bilateral sides', () => {
    const source = createMindMapProps('Root', ids())
    const root = getMindMapRoot(source)!
    const first = addMindMapChild(source, root.id, ids())
    const second = addMindMapChild(first.props, root.id, ids())
    const nested = addMindMapChild(second.props, first.nodeId!, ids())
    const before = getMindMapDropCandidate(nested.props, second.nodeId!, first.nodeId!, 0.5, 0.1)!
    const child = getMindMapDropCandidate(nested.props, second.nodeId!, first.nodeId!, 0.5, 0.5)!
    const bilateral = setMindMapLayout(nested.props, 'bilateral')
    const left = getMindMapDropCandidate(bilateral, second.nodeId!, root.id, 0.1, 0.5)!

    expect(before).toMatchObject({ mode: 'before', targetParentId: root.id, targetIndex: 0 })
    expect(child).toMatchObject({ mode: 'child', targetParentId: first.nodeId })
    expect(left).toMatchObject({ mode: 'child', targetParentId: root.id, side: 'left' })
    expect(getMindMapDropCandidate(nested.props, first.nodeId!, nested.nodeId!, 0.5, 0.5)).toBeUndefined()
  })

  it('applies a drop once, expands the target and preserves the root anchor with a shape offset', () => {
    const source = createMindMapProps('Root', ids())
    const root = getMindMapRoot(source)!
    const first = addMindMapChild(source, root.id, ids())
    const second = addMindMapChild(first.props, root.id, ids())
    const collapsed = toggleMindMapCollapsed(second.props, first.nodeId!)
    const candidate = getMindMapDropCandidate(collapsed, second.nodeId!, first.nodeId!, 0.5, 0.5)!
    const moved = applyMindMapDrop(collapsed, second.nodeId!, candidate)
    const delta = getMindMapRootAnchorDelta(collapsed, moved)

    expect(moved.nodes.find((node) => node.id === second.nodeId)).toMatchObject({ parentId: first.nodeId })
    expect(moved.nodes.find((node) => node.id === first.nodeId)?.collapsed).toBe(false)
    expect(Number.isFinite(delta.x) && Number.isFinite(delta.y)).toBe(true)
    expect(applyMindMapDrop(moved, second.nodeId!, undefined)).toBe(moved)
  })

  it('copies and pastes an entire styled branch with new stable ids', () => {
    const source = createMindMapProps('Root', ids())
    const root = getMindMapRoot(source)!
    const branch = addMindMapChild(source, root.id, ids())
    const child = addMindMapChild(branch.props, branch.nodeId!, ids())
    const styled = setMindMapTheme(updateMindMapNodeStyle(child.props, branch.nodeId!, { color: 'green', shape: 'pill' }), 'colorful')
    const snapshot = copyMindMapBranch(styled, branch.nodeId!)!
    const pasted = pasteMindMapBranch(styled, root.id, snapshot, ids())

    expect(countMindMapDescendants(styled, branch.nodeId!)).toBe(1)
    expect(pasted.props.nodes).toHaveLength(styled.nodes.length + 2)
    expect(pasted.nodeId).not.toBe(branch.nodeId)
    expect(pasted.props.nodes.find((node) => node.id === pasted.nodeId)).toMatchObject({ color: 'green', shape: 'pill' })
    expect(pasted.props.theme).toBe('colorful')
  })

  it('copies visual styles without structure and duplicates a complete branch after the source', () => {
    const source = createMindMapProps('Root', ids())
    const root = getMindMapRoot(source)!
    const branch = addMindMapChild(source, root.id, ids())
    const child = addMindMapChild(branch.props, branch.nodeId!, ids())
    const styled = updateMindMapNodeStyle(child.props, branch.nodeId!, {
      shape: 'pill',
      style: {
        fillColor: 'purple', fillOpacity: 0.65, textColor: 'black', fontSize: 'xl',
        fontFamily: 'serif', textAlign: 'center', bold: false, italic: true,
        underline: true, strike: true, edgeColor: 'teal', edgeOpacity: 0.4,
        edgeDash: 'dotted', edgeWidth: 4,
      },
    })
    const snapshot = copyMindMapNodeVisualStyle(styled, branch.nodeId!)!
    const pastedStyle = pasteMindMapNodeVisualStyle(styled, child.nodeId!, snapshot)
    const duplicate = duplicateMindMapBranch(styled, branch.nodeId!, ids())

    expect(pastedStyle.nodes.find((node) => node.id === child.nodeId)).toMatchObject({
      parentId: branch.nodeId,
      shape: 'pill',
      style: { fillColor: 'purple', fontSize: 'xl', edgeDash: 'dotted', edgeWidth: 4 },
    })
    expect(duplicate.props.nodes).toHaveLength(styled.nodes.length + 2)
    expect(duplicate.props.nodes.find((node) => node.id === duplicate.nodeId)).toMatchObject({
      parentId: root.id,
      order: 1,
      style: { fillColor: 'purple', edgeColor: 'teal' },
    })
  })

  it('lays out the 500 node limit deterministically', () => {
    let props = createMindMapProps('Root', ids())
    const root = getMindMapRoot(props)!
    let parentId = root.id
    for (let index = 1; index < 500; index += 1) {
      const added = addMindMapChild(props, parentId, ids())
      props = added.props
      parentId = added.nodeId!
    }
    const firstLayout = layoutMindMap(props)
    expect(props.nodes).toHaveLength(500)
    expect(firstLayout.nodes).toHaveLength(500)
    expect(layoutMindMap(props)).toEqual(firstLayout)
    expect(addMindMapChild(props, parentId, ids()).props).toBe(props)
  })
})
