import { createInternalId, type InternalIdFactory } from '../table/operations.js'
import {
  MAX_MIND_MAP_NODES,
  MIND_MAP_PALETTE,
  type MindMapEdgeDash,
  type MindMapEdgeWidth,
  type MindMapFontFamily,
  type MindMapFontSize,
  type MindMapLayout,
  type MindMapNode,
  type MindMapNodeColor,
  type MindMapNodeShape,
  type MindMapNodeStyle,
  type MindMapPaletteColor,
  type MindMapShapeProps,
  type MindMapSide,
  type MindMapTextAlign,
  type MindMapTheme,
} from './schema.js'

export const MIND_MAP_ROOT_WIDTH = 176
export const MIND_MAP_NODE_WIDTH = 160
export const MIND_MAP_NODE_HEIGHT = 44
export const MIND_MAP_ROOT_HEIGHT = 48
export const MIND_MAP_HORIZONTAL_GAP = 60
export const MIND_MAP_VERTICAL_GAP = 16
export const MIND_MAP_PADDING = 24

export const MIND_MAP_PALETTE_COLORS: Record<MindMapPaletteColor, string> = {
  black: '#1f2329',
  gray: '#8f959e',
  purple: '#d46bfa',
  violet: '#9333ea',
  indigo: '#4e6ef2',
  blue: '#3b82f6',
  amber: '#f3a83b',
  orange: '#e76a24',
  teal: '#0f9f75',
  green: '#42b55d',
  coral: '#f87171',
  red: '#e53935',
}

export const MIND_MAP_FONT_SIZES: Record<MindMapFontSize, number> = {
  s: 12,
  m: 14,
  l: 18,
  xl: 24,
}

export const MIND_MAP_FONT_FAMILIES: Record<MindMapFontFamily, string> = {
  draw: 'var(--tl-font-draw)',
  sans: 'var(--tl-font-sans)',
  serif: 'var(--tl-font-serif)',
  mono: 'var(--tl-font-mono)',
}

export interface ResolvedMindMapNodeStyle {
  fillColor: string
  fillOpacity: number
  borderColor: string
  borderOpacity: number
  textColor: string
  textOpacity: number
  fontSize: MindMapFontSize
  fontFamily: MindMapFontFamily
  textAlign: MindMapTextAlign
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
  edgeColor: string
  edgeOpacity: number
  edgeDash: MindMapEdgeDash
  edgeWidth: MindMapEdgeWidth
}

const LEGACY_COLORS: Record<MindMapNodeColor, MindMapPaletteColor> = {
  blue: 'blue',
  violet: 'violet',
  green: 'green',
  orange: 'orange',
  red: 'red',
  gray: 'gray',
}

function opacity(value: unknown, fallback = 1): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : fallback
}

function palette(value: unknown): MindMapPaletteColor | undefined {
  return typeof value === 'string' && (MIND_MAP_PALETTE as readonly string[]).includes(value)
    ? value as MindMapPaletteColor
    : undefined
}

export function normalizeMindMapNodeStyle(style: MindMapNodeStyle | undefined): MindMapNodeStyle | undefined {
  if (!style) return undefined
  const next: MindMapNodeStyle = {
    ...(palette(style.fillColor) ? { fillColor: palette(style.fillColor) } : {}),
    ...(style.fillOpacity === undefined ? {} : { fillOpacity: opacity(style.fillOpacity) }),
    ...(palette(style.borderColor) ? { borderColor: palette(style.borderColor) } : {}),
    ...(style.borderOpacity === undefined ? {} : { borderOpacity: opacity(style.borderOpacity) }),
    ...(palette(style.textColor) ? { textColor: palette(style.textColor) } : {}),
    ...(style.textOpacity === undefined ? {} : { textOpacity: opacity(style.textOpacity) }),
    ...(['s', 'm', 'l', 'xl'].includes(String(style.fontSize)) ? { fontSize: style.fontSize } : {}),
    ...(['draw', 'sans', 'serif', 'mono'].includes(String(style.fontFamily)) ? { fontFamily: style.fontFamily } : {}),
    ...(['left', 'center', 'right'].includes(String(style.textAlign)) ? { textAlign: style.textAlign } : {}),
    ...(style.bold === undefined ? {} : { bold: Boolean(style.bold) }),
    ...(style.italic === undefined ? {} : { italic: Boolean(style.italic) }),
    ...(style.underline === undefined ? {} : { underline: Boolean(style.underline) }),
    ...(style.strike === undefined ? {} : { strike: Boolean(style.strike) }),
    ...(palette(style.edgeColor) ? { edgeColor: palette(style.edgeColor) } : {}),
    ...(style.edgeOpacity === undefined ? {} : { edgeOpacity: opacity(style.edgeOpacity) }),
    ...(['solid', 'dashed', 'dotted'].includes(String(style.edgeDash)) ? { edgeDash: style.edgeDash } : {}),
    ...([1, 2, 3, 4].includes(Number(style.edgeWidth)) ? { edgeWidth: style.edgeWidth } : {}),
  }
  return Object.keys(next).length ? next : undefined
}

export function resolveMindMapNodeStyle(
  props: MindMapShapeProps,
  node: MindMapNode,
): ResolvedMindMapNodeStyle {
  const explicit = normalizeMindMapNodeStyle(node.style)
  const isRoot = node.parentId === null
  const legacyColor = LEGACY_COLORS[node.color ?? (isRoot ? 'blue' : 'gray')]
  const colorful = (props.theme ?? 'classic') === 'colorful'
  return {
    fillColor: explicit?.fillColor
      ? MIND_MAP_PALETTE_COLORS[explicit.fillColor]
      : isRoot || colorful ? MIND_MAP_PALETTE_COLORS[legacyColor] : '#ffffff',
    fillOpacity: explicit?.fillOpacity ?? 1,
    borderColor: MIND_MAP_PALETTE_COLORS[explicit?.borderColor ?? legacyColor],
    borderOpacity: explicit?.borderOpacity ?? 1,
    textColor: explicit?.textColor
      ? MIND_MAP_PALETTE_COLORS[explicit.textColor]
      : isRoot || colorful ? '#ffffff' : MIND_MAP_PALETTE_COLORS.black,
    textOpacity: explicit?.textOpacity ?? 1,
    fontSize: explicit?.fontSize ?? 'm',
    fontFamily: explicit?.fontFamily ?? 'sans',
    textAlign: explicit?.textAlign ?? 'left',
    bold: explicit?.bold ?? true,
    italic: explicit?.italic ?? false,
    underline: explicit?.underline ?? false,
    strike: explicit?.strike ?? false,
    edgeColor: MIND_MAP_PALETTE_COLORS[explicit?.edgeColor ?? 'gray'],
    edgeOpacity: explicit?.edgeOpacity ?? 1,
    edgeDash: explicit?.edgeDash ?? 'solid',
    edgeWidth: explicit?.edgeWidth ?? 2,
  }
}

export function mindMapColorWithOpacity(color: string, alpha: number): string {
  const normalized = color.replace('#', '')
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return color
  const value = Number.parseInt(normalized, 16)
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${opacity(alpha)})`
}

export interface MindMapNodePosition {
  id: string
  x: number
  y: number
  w: number
  h: number
  side: MindMapSide
}

export interface MindMapEdgePosition {
  fromId: string
  toId: string
  side: MindMapSide
}

export interface MindMapLayoutResult {
  width: number
  height: number
  nodes: MindMapNodePosition[]
  edges: MindMapEdgePosition[]
}

export function createMindMapProps(
  text = '中心主题',
  id: InternalIdFactory = createInternalId,
): MindMapShapeProps {
  const props: MindMapShapeProps = {
    w: MIND_MAP_ROOT_WIDTH + MIND_MAP_PADDING * 2,
    h: MIND_MAP_ROOT_HEIGHT + MIND_MAP_PADDING * 2,
    layout: 'right',
    nodes: [{ id: id('node'), parentId: null, text, order: 0, side: 'right', collapsed: false, color: 'blue', shape: 'rounded' }],
    theme: 'classic',
  }
  return withMindMapBounds(props)
}

export function getMindMapRoot(props: MindMapShapeProps): MindMapNode | undefined {
  return props.nodes.find((node) => node.parentId === null)
}

function childrenOf(props: MindMapShapeProps, parentId: string): MindMapNode[] {
  return props.nodes
    .filter((node) => node.parentId === parentId)
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
}

function topBranch(props: MindMapShapeProps, node: MindMapNode): MindMapNode {
  const root = getMindMapRoot(props)
  let current = node
  while (current.parentId && current.parentId !== root?.id) {
    const parent = props.nodes.find((candidate) => candidate.id === current.parentId)
    if (!parent) break
    current = parent
  }
  return current
}

function reindex(nodes: MindMapNode[], parentId: string | null): MindMapNode[] {
  const siblings = nodes
    .filter((node) => node.parentId === parentId)
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
  const orderById = new Map(siblings.map((node, index) => [node.id, index]))
  return nodes.map((node) => node.parentId === parentId
    ? { ...node, order: orderById.get(node.id) ?? node.order }
    : node)
}

export function normalizeMindMapProps(
  props: MindMapShapeProps,
  id: InternalIdFactory = createInternalId,
): MindMapShapeProps {
  const source = props.nodes.slice(0, MAX_MIND_MAP_NODES)
  const root = source.find((node) => node.parentId === null) ?? {
    id: id('node'), parentId: null, text: '中心主题', order: 0, side: 'right' as const, collapsed: false,
  }
  const ids = new Set(source.map((node) => node.id))
  const nodes = [root, ...source.filter((node) => node.id !== root.id)].map((node) => ({
    ...node,
    parentId: node.id === root.id || !node.parentId || !ids.has(node.parentId) ? (node.id === root.id ? null : root.id) : node.parentId,
    side: node.side === 'left' ? 'left' as const : 'right' as const,
    collapsed: Boolean(node.collapsed),
    color: node.color ?? (node.id === root.id ? 'blue' : 'gray'),
    shape: node.shape ?? 'rounded',
    style: normalizeMindMapNodeStyle(node.style),
  }))
  let normalized: MindMapNode[] = nodes
  for (const parentId of new Set(nodes.map((node) => node.parentId))) normalized = reindex(normalized, parentId)
  return withMindMapBounds({
    ...props,
    layout: props.layout === 'bilateral' ? 'bilateral' : 'right',
    theme: props.theme ?? 'classic',
    nodes: normalized,
  })
}

function visibleNodeIds(props: MindMapShapeProps): Set<string> {
  const root = getMindMapRoot(props)
  const visible = new Set<string>()
  if (!root) return visible
  const visit = (node: MindMapNode) => {
    visible.add(node.id)
    if (!node.collapsed) for (const child of childrenOf(props, node.id)) visit(child)
  }
  visit(root)
  return visible
}

export function layoutMindMap(props: MindMapShapeProps): MindMapLayoutResult {
  const root = getMindMapRoot(props)
  if (!root) return { width: 1, height: 1, nodes: [], edges: [] }
  const childrenByParent = new Map<string, MindMapNode[]>()
  for (const node of props.nodes) {
    if (!node.parentId) continue
    const children = childrenByParent.get(node.parentId) ?? []
    children.push(node)
    childrenByParent.set(node.parentId, children)
  }
  for (const children of childrenByParent.values()) {
    children.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
  }
  const visible = new Set<string>()
  const visitVisible = (node: MindMapNode) => {
    visible.add(node.id)
    if (!node.collapsed) for (const child of childrenByParent.get(node.id) ?? []) visitVisible(child)
  }
  visitVisible(root)
  const visibleChildren = (nodeId: string) => (childrenByParent.get(nodeId) ?? []).filter((node) => visible.has(node.id))
  const rootChildren = visibleChildren(root.id)
  const sideFor = (node: MindMapNode): MindMapSide => props.layout === 'right' ? 'right' : node.side
  const heightById = new Map<string, number>()
  const subtreeHeight = (node: MindMapNode): number => {
    const cached = heightById.get(node.id)
    if (cached !== undefined) return cached
    const children = visibleChildren(node.id)
    const height = children.length === 0 ? MIND_MAP_NODE_HEIGHT : Math.max(
      MIND_MAP_NODE_HEIGHT,
      children.reduce((sum, child) => sum + subtreeHeight(child), 0) + MIND_MAP_VERTICAL_GAP * (children.length - 1),
    )
    heightById.set(node.id, height)
    return height
  }
  const depthById = new Map<string, number>()
  const maxDepth = (node: MindMapNode, depth = 1): number => {
    const cached = depthById.get(node.id)
    if (cached !== undefined) return depth - 1 + cached
    const children = visibleChildren(node.id)
    const relativeDepth = children.length ? 1 + Math.max(...children.map((child) => maxDepth(child, 1))) : 1
    depthById.set(node.id, relativeDepth)
    return depth - 1 + relativeDepth
  }
  const leftBranches = rootChildren.filter((node) => sideFor(node) === 'left')
  const rightBranches = rootChildren.filter((node) => sideFor(node) === 'right')
  const sideHeight = (branches: MindMapNode[]) => branches.length
    ? branches.reduce((sum, node) => sum + subtreeHeight(node), 0) + MIND_MAP_VERTICAL_GAP * (branches.length - 1)
    : 0
  const leftHeight = sideHeight(leftBranches)
  const rightHeight = sideHeight(rightBranches)
  const contentHeight = Math.max(MIND_MAP_ROOT_HEIGHT, leftHeight, rightHeight)
  const leftDepth = leftBranches.length ? Math.max(...leftBranches.map((node) => maxDepth(node))) : 0
  const rightDepth = rightBranches.length ? Math.max(...rightBranches.map((node) => maxDepth(node))) : 0
  const step = MIND_MAP_NODE_WIDTH + MIND_MAP_HORIZONTAL_GAP
  const rootX = MIND_MAP_PADDING + leftDepth * step
  const rootY = MIND_MAP_PADDING + (contentHeight - MIND_MAP_ROOT_HEIGHT) / 2
  const nodes: MindMapNodePosition[] = [{
    id: root.id, x: rootX, y: rootY, w: MIND_MAP_ROOT_WIDTH, h: MIND_MAP_ROOT_HEIGHT, side: 'right',
  }]
  const edges: MindMapEdgePosition[] = []
  const placeBranch = (node: MindMapNode, side: MindMapSide, depth: number, top: number) => {
    const height = subtreeHeight(node)
    const x = side === 'right'
      ? rootX + MIND_MAP_ROOT_WIDTH + MIND_MAP_HORIZONTAL_GAP + (depth - 1) * step
      : rootX - MIND_MAP_HORIZONTAL_GAP - MIND_MAP_NODE_WIDTH - (depth - 1) * step
    const y = top + (height - MIND_MAP_NODE_HEIGHT) / 2
    nodes.push({ id: node.id, x, y, w: MIND_MAP_NODE_WIDTH, h: MIND_MAP_NODE_HEIGHT, side })
    if (node.parentId) edges.push({ fromId: node.parentId, toId: node.id, side })
    let childTop = top
    for (const child of visibleChildren(node.id)) {
      placeBranch(child, side, depth + 1, childTop)
      childTop += subtreeHeight(child) + MIND_MAP_VERTICAL_GAP
    }
  }
  const placeSide = (branches: MindMapNode[], side: MindMapSide, totalHeight: number) => {
    let top = MIND_MAP_PADDING + (contentHeight - totalHeight) / 2
    for (const branch of branches) {
      placeBranch(branch, side, 1, top)
      top += subtreeHeight(branch) + MIND_MAP_VERTICAL_GAP
    }
  }
  placeSide(leftBranches, 'left', leftHeight)
  placeSide(rightBranches, 'right', rightHeight)
  return {
    width: rootX + MIND_MAP_ROOT_WIDTH + rightDepth * step + MIND_MAP_PADDING,
    height: contentHeight + MIND_MAP_PADDING * 2,
    nodes,
    edges,
  }
}

export function withMindMapBounds(props: MindMapShapeProps): MindMapShapeProps {
  const layout = layoutMindMap(props)
  return { ...props, w: layout.width, h: layout.height }
}

export function getMindMapRootAnchorDelta(
  before: MindMapShapeProps,
  after: MindMapShapeProps,
): { x: number; y: number } {
  const beforeRoot = getMindMapRoot(before)
  const afterRoot = getMindMapRoot(after)
  const beforePosition = beforeRoot ? layoutMindMap(before).nodes.find((node) => node.id === beforeRoot.id) : undefined
  const afterPosition = afterRoot ? layoutMindMap(after).nodes.find((node) => node.id === afterRoot.id) : undefined
  return beforePosition && afterPosition
    ? { x: beforePosition.x - afterPosition.x, y: beforePosition.y - afterPosition.y }
    : { x: 0, y: 0 }
}

export function updateMindMapNodeText(props: MindMapShapeProps, nodeId: string, text: string): MindMapShapeProps {
  return { ...props, nodes: props.nodes.map((node) => node.id === nodeId ? { ...node, text } : node) }
}

function nextSide(props: MindMapShapeProps): MindMapSide {
  if (props.layout === 'right') return 'right'
  const root = getMindMapRoot(props)
  if (!root) return 'right'
  const children = childrenOf(props, root.id)
  const left = children.filter((node) => node.side === 'left').length
  const right = children.length - left
  return left < right ? 'left' : 'right'
}

export function addMindMapChild(
  props: MindMapShapeProps,
  parentId: string,
  id: InternalIdFactory = createInternalId,
): { props: MindMapShapeProps; nodeId?: string } {
  if (props.nodes.length >= MAX_MIND_MAP_NODES || !props.nodes.some((node) => node.id === parentId)) return { props }
  const root = getMindMapRoot(props)
  const parent = props.nodes.find((node) => node.id === parentId)!
  const side = parent.id === root?.id ? nextSide(props) : topBranch(props, parent).side
  const existing = new Set(props.nodes.map((node) => node.id))
  let nodeId = id('node')
  for (let attempt = 0; existing.has(nodeId) && attempt < 10_000; attempt += 1) nodeId = id('node')
  if (existing.has(nodeId)) nodeId = createInternalId('node')
  const nodes = [...props.nodes, {
    id: nodeId,
    parentId,
    text: '新主题',
    order: childrenOf(props, parentId).length,
    side,
    collapsed: false,
    color: parent.id === root?.id ? (side === 'left' ? 'violet' : 'blue') : parent.color ?? 'gray',
    shape: parent.shape ?? 'rounded',
    ...(parent.style ? { style: structuredClone(parent.style) } : {}),
  }]
  return { props: withMindMapBounds({ ...props, nodes }), nodeId }
}

export function addMindMapSibling(
  props: MindMapShapeProps,
  nodeId: string,
  id: InternalIdFactory = createInternalId,
): { props: MindMapShapeProps; nodeId?: string } {
  const node = props.nodes.find((candidate) => candidate.id === nodeId)
  const root = getMindMapRoot(props)
  if (!node || node.id === root?.id || !node.parentId) return root ? addMindMapChild(props, root.id, id) : { props }
  const result = addMindMapChild(props, node.parentId, id)
  if (!result.nodeId) return result
  const inserted = result.props.nodes.map((candidate) => candidate.id === result.nodeId
    ? { ...candidate, side: node.side, order: node.order + 0.5 }
    : candidate)
  return { props: withMindMapBounds({ ...result.props, nodes: reindex(inserted, node.parentId) }), nodeId: result.nodeId }
}

export function deleteMindMapBranch(props: MindMapShapeProps, nodeId: string): MindMapShapeProps {
  const root = getMindMapRoot(props)
  const node = props.nodes.find((candidate) => candidate.id === nodeId)
  if (!node || node.id === root?.id) return props
  const removed = new Set<string>()
  const visit = (id: string) => {
    removed.add(id)
    for (const child of childrenOf(props, id)) visit(child.id)
  }
  visit(nodeId)
  return withMindMapBounds({ ...props, nodes: reindex(props.nodes.filter((candidate) => !removed.has(candidate.id)), node.parentId) })
}

export function promoteMindMapNode(props: MindMapShapeProps, nodeId: string): MindMapShapeProps {
  const node = props.nodes.find((candidate) => candidate.id === nodeId)
  if (!node?.parentId) return props
  const parent = props.nodes.find((candidate) => candidate.id === node.parentId)
  if (!parent?.parentId) return props
  const grandparent = props.nodes.find((candidate) => candidate.id === parent.parentId)
  if (!grandparent) return props
  let nodes = props.nodes.map((candidate) => candidate.id === nodeId
    ? { ...candidate, parentId: grandparent.id, order: childrenOf(props, grandparent.id).length, side: parent.side }
    : candidate)
  nodes = reindex(reindex(nodes, parent.id), grandparent.id)
  return withMindMapBounds({ ...props, nodes })
}

export function toggleMindMapCollapsed(props: MindMapShapeProps, nodeId: string): MindMapShapeProps {
  return withMindMapBounds({
    ...props,
    nodes: props.nodes.map((node) => node.id === nodeId ? { ...node, collapsed: !node.collapsed } : node),
  })
}

export function setMindMapLayout(props: MindMapShapeProps, layout: MindMapLayout): MindMapShapeProps {
  return withMindMapBounds({ ...props, layout })
}

export function setMindMapBranchSide(props: MindMapShapeProps, nodeId: string, side: MindMapSide): MindMapShapeProps {
  const root = getMindMapRoot(props)
  const node = props.nodes.find((candidate) => candidate.id === nodeId)
  if (!root || !node || node.parentId !== root.id) return props
  return withMindMapBounds({
    ...props,
    nodes: props.nodes.map((candidate) => candidate.id === nodeId ? { ...candidate, side } : candidate),
  })
}

function branchIds(props: MindMapShapeProps, nodeId: string): string[] {
  if (!props.nodes.some((node) => node.id === nodeId)) return []
  const childrenByParent = new Map<string, string[]>()
  for (const node of props.nodes) {
    if (node.parentId === null) continue
    const children = childrenByParent.get(node.parentId) ?? []
    children.push(node.id)
    childrenByParent.set(node.parentId, children)
  }
  const result: string[] = []
  const visit = (id: string) => {
    result.push(id)
    for (const childId of childrenByParent.get(id) ?? []) visit(childId)
  }
  visit(nodeId)
  return result
}

export function countMindMapDescendants(props: MindMapShapeProps, nodeId: string): number {
  return getMindMapDescendantCounts(props).get(nodeId) ?? 0
}

export function getMindMapDescendantCounts(props: MindMapShapeProps): Map<string, number> {
  const childrenByParent = new Map<string, string[]>()
  for (const node of props.nodes) {
    if (node.parentId === null) continue
    const children = childrenByParent.get(node.parentId) ?? []
    children.push(node.id)
    childrenByParent.set(node.parentId, children)
  }
  const counts = new Map<string, number>()
  const visiting = new Set<string>()
  const visit = (nodeId: string): number => {
    const cached = counts.get(nodeId)
    if (cached !== undefined) return cached
    if (visiting.has(nodeId)) return 0
    visiting.add(nodeId)
    let count = 0
    for (const childId of childrenByParent.get(nodeId) ?? []) count += 1 + visit(childId)
    visiting.delete(nodeId)
    counts.set(nodeId, count)
    return count
  }
  for (const node of props.nodes) visit(node.id)
  return counts
}

export interface MoveMindMapNodeOptions {
  side?: MindMapSide
  expandTarget?: boolean
}

export function moveMindMapNode(
  props: MindMapShapeProps,
  nodeId: string,
  targetParentId: string,
  targetIndex = Number.POSITIVE_INFINITY,
  options: MoveMindMapNodeOptions = {},
): MindMapShapeProps {
  const root = getMindMapRoot(props)
  const node = props.nodes.find((candidate) => candidate.id === nodeId)
  const target = props.nodes.find((candidate) => candidate.id === targetParentId)
  if (!root || !node || !target || node.id === root.id || node.id === target.id) return props
  const descendants = new Set(branchIds(props, nodeId))
  if (descendants.has(targetParentId)) return props
  const oldParentId = node.parentId
  const targetChildren = childrenOf(props, targetParentId).filter((child) => child.id !== nodeId)
  const safeIndex = Number.isFinite(targetIndex)
    ? Math.max(0, Math.min(targetChildren.length, Math.floor(targetIndex)))
    : targetChildren.length
  targetChildren.splice(safeIndex, 0, node)
  const targetOrder = new Map(targetChildren.map((child, index) => [child.id, index]))
  const side = props.layout === 'right'
    ? 'right'
    : target.id === root.id ? options.side ?? node.side : topBranch(props, target).side
  let nodes = props.nodes.map((candidate) => candidate.id === nodeId
    ? { ...candidate, parentId: targetParentId, order: targetOrder.get(candidate.id) ?? safeIndex, side }
    : descendants.has(candidate.id)
      ? { ...candidate, side }
      : options.expandTarget && candidate.id === targetParentId && candidate.collapsed
        ? { ...candidate, collapsed: false }
      : candidate)
  nodes = nodes.map((candidate) => candidate.parentId === targetParentId
    ? { ...candidate, order: targetOrder.get(candidate.id) ?? candidate.order }
    : candidate)
  if (oldParentId && oldParentId !== targetParentId) nodes = reindex(nodes, oldParentId)
  const changed = nodes.some((candidate, index) => {
    const previous = props.nodes[index]
    return !previous
      || candidate.parentId !== previous.parentId
      || candidate.order !== previous.order
      || candidate.side !== previous.side
      || candidate.collapsed !== previous.collapsed
  })
  return changed ? withMindMapBounds({ ...props, nodes }) : props
}

export function reorderMindMapNode(props: MindMapShapeProps, nodeId: string, targetIndex: number): MindMapShapeProps {
  const node = props.nodes.find((candidate) => candidate.id === nodeId)
  return node?.parentId ? moveMindMapNode(props, nodeId, node.parentId, targetIndex) : props
}

export interface MindMapBranchSnapshot {
  rootId: string
  nodes: MindMapNode[]
}

export interface MindMapVisualStyleSnapshot {
  color?: MindMapNodeColor
  shape?: MindMapNodeShape
  style?: MindMapNodeStyle
}

export function copyMindMapNodeVisualStyle(
  props: MindMapShapeProps,
  nodeId: string,
): MindMapVisualStyleSnapshot | undefined {
  const node = props.nodes.find((candidate) => candidate.id === nodeId)
  if (!node) return undefined
  return {
    ...(node.color ? { color: node.color } : {}),
    ...(node.shape ? { shape: node.shape } : {}),
    ...(node.style ? { style: structuredClone(node.style) } : {}),
  }
}

export function pasteMindMapNodeVisualStyle(
  props: MindMapShapeProps,
  nodeId: string,
  snapshot: MindMapVisualStyleSnapshot,
): MindMapShapeProps {
  if (!props.nodes.some((candidate) => candidate.id === nodeId)) return props
  return {
    ...props,
    nodes: props.nodes.map((node) => node.id === nodeId ? {
      ...node,
      ...(snapshot.color ? { color: snapshot.color } : {}),
      ...(snapshot.shape ? { shape: snapshot.shape } : {}),
      ...(snapshot.style ? { style: structuredClone(snapshot.style) } : { style: undefined }),
    } : node),
  }
}

export function copyMindMapBranch(props: MindMapShapeProps, nodeId: string): MindMapBranchSnapshot | undefined {
  const ids = new Set(branchIds(props, nodeId))
  if (!ids.size) return undefined
  return {
    rootId: nodeId,
    nodes: props.nodes.filter((node) => ids.has(node.id)).map((node) => ({ ...node })),
  }
}

export function pasteMindMapBranch(
  props: MindMapShapeProps,
  parentId: string,
  snapshot: MindMapBranchSnapshot,
  id: InternalIdFactory = createInternalId,
): { props: MindMapShapeProps; nodeId?: string } {
  if (!props.nodes.some((node) => node.id === parentId)) return { props }
  const capacity = MAX_MIND_MAP_NODES - props.nodes.length
  if (capacity <= 0 || snapshot.nodes.length > capacity) return { props }
  const sourceById = new Map(snapshot.nodes.map((node) => [node.id, node]))
  if (!sourceById.has(snapshot.rootId)) return { props }
  const used = new Set(props.nodes.map((node) => node.id))
  const idMap = new Map<string, string>()
  for (const source of snapshot.nodes) {
    let nextId = id('node')
    while (used.has(nextId)) nextId = id('node')
    used.add(nextId)
    idMap.set(source.id, nextId)
  }
  const root = getMindMapRoot(props)
  const parent = props.nodes.find((node) => node.id === parentId)!
  const side = parent.id === root?.id ? nextSide(props) : topBranch(props, parent).side
  const orderBase = childrenOf(props, parentId).length
  const copied = snapshot.nodes.map((source) => ({
    ...source,
    id: idMap.get(source.id)!,
    parentId: source.id === snapshot.rootId ? parentId : idMap.get(source.parentId ?? '') ?? parentId,
    order: source.id === snapshot.rootId ? orderBase : source.order,
    side,
  }))
  const nodeId = idMap.get(snapshot.rootId)
  const nextProps = withMindMapBounds({ ...props, nodes: [...props.nodes, ...copied] })
  return nodeId ? { props: nextProps, nodeId } : { props: nextProps }
}

export function duplicateMindMapBranch(
  props: MindMapShapeProps,
  nodeId: string,
  id: InternalIdFactory = createInternalId,
): { props: MindMapShapeProps; nodeId?: string } {
  const node = props.nodes.find((candidate) => candidate.id === nodeId)
  if (!node?.parentId) return { props }
  const snapshot = copyMindMapBranch(props, nodeId)
  if (!snapshot) return { props }
  const pasted = pasteMindMapBranch(props, node.parentId, snapshot, id)
  if (!pasted.nodeId) return pasted
  const siblings = childrenOf(pasted.props, node.parentId)
  const sourceIndex = siblings.findIndex((candidate) => candidate.id === node.id)
  return {
    props: moveMindMapNode(pasted.props, pasted.nodeId, node.parentId, sourceIndex + 1, { side: node.side }),
    nodeId: pasted.nodeId,
  }
}

export type MindMapDropMode = 'child' | 'before' | 'after'

export interface MindMapDropCandidate {
  targetNodeId: string
  targetParentId: string
  targetIndex: number
  mode: MindMapDropMode
  side?: MindMapSide
}

export function getMindMapDropCandidate(
  props: MindMapShapeProps,
  draggingNodeId: string,
  targetNodeId: string,
  relativeX: number,
  relativeY: number,
): MindMapDropCandidate | undefined {
  const root = getMindMapRoot(props)
  const dragging = props.nodes.find((node) => node.id === draggingNodeId)
  const target = props.nodes.find((node) => node.id === targetNodeId)
  if (!root || !dragging?.parentId || !target || dragging.id === target.id) return undefined
  const draggedBranch = new Set(branchIds(props, draggingNodeId))
  if (draggedBranch.has(target.id)) return undefined
  if (target.id === root.id) {
    const siblings = childrenOf(props, root.id).filter((node) => node.id !== draggingNodeId)
    return {
      targetNodeId: root.id,
      targetParentId: root.id,
      targetIndex: siblings.length,
      mode: 'child',
      side: props.layout === 'bilateral' && relativeX < 0.5 ? 'left' : 'right',
    }
  }
  if (target.parentId && relativeY < 0.25) {
    const siblings = childrenOf(props, target.parentId).filter((node) => node.id !== draggingNodeId)
    return {
      targetNodeId: target.id,
      targetParentId: target.parentId,
      targetIndex: Math.max(0, siblings.findIndex((node) => node.id === target.id)),
      mode: 'before',
    }
  }
  if (target.parentId && relativeY > 0.75) {
    const siblings = childrenOf(props, target.parentId).filter((node) => node.id !== draggingNodeId)
    const index = siblings.findIndex((node) => node.id === target.id)
    return {
      targetNodeId: target.id,
      targetParentId: target.parentId,
      targetIndex: index < 0 ? siblings.length : index + 1,
      mode: 'after',
    }
  }
  return {
    targetNodeId: target.id,
    targetParentId: target.id,
    targetIndex: childrenOf(props, target.id).filter((node) => node.id !== draggingNodeId).length,
    mode: 'child',
  }
}

export function applyMindMapDrop(
  props: MindMapShapeProps,
  draggingNodeId: string,
  candidate: MindMapDropCandidate | undefined,
): MindMapShapeProps {
  if (!candidate) return props
  return moveMindMapNode(
    props,
    draggingNodeId,
    candidate.targetParentId,
    candidate.targetIndex,
    {
      ...(candidate.side ? { side: candidate.side } : {}),
      expandTarget: candidate.mode === 'child',
    },
  )
}

export function updateMindMapNodeStyle(
  props: MindMapShapeProps,
  nodeId: string,
  patch: { color?: MindMapNodeColor; shape?: MindMapNodeShape; style?: Partial<MindMapNodeStyle> },
): MindMapShapeProps {
  return {
    ...props,
    nodes: props.nodes.map((node) => node.id === nodeId ? {
      ...node,
      ...(patch.color ? { color: patch.color } : {}),
      ...(patch.shape ? { shape: patch.shape } : {}),
      ...(patch.style ? { style: normalizeMindMapNodeStyle({ ...node.style, ...patch.style }) } : {}),
    } : node),
  }
}

export function setMindMapTheme(props: MindMapShapeProps, theme: MindMapTheme): MindMapShapeProps {
  return { ...props, theme }
}
