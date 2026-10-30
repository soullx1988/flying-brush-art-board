import { z } from 'zod'
import { Box, getIndices, toRichText, type Editor, type TLGeoShape, type TLPageId, type TLShape, type TLShapeId, type TLStore } from 'tldraw'
import { createBoardStore, getStoreSnapshot, loadSnapshotIntoStore } from '@infinite-board/tldraw-adapter'
import { isCatalogProduct, type CommerceDataset } from './commerce-data'

const sourceSchema = z.object({ path: z.string(), sha256: z.string(), label: z.string() })
export const itemValueDatasetSchema = z.object({
  version: z.literal(1), updated: z.string(), sourceBoardId: z.string().min(1),
  priceUnit: z.string().min(1), scope: z.string(), sources: z.array(sourceSchema),
  stages: z.array(z.object({ id: z.string(), label: z.string(), order: z.number(), kind: z.enum(['progress', 'conditional', 'unknown']) })),
  reviewGroups: z.array(z.object({ id: z.string(), kind: z.enum(['price', 'name']), title: z.string(), itemIds: z.array(z.number().int()).min(1), question: z.string(), context: z.string(), sources: z.array(z.string()) })).optional(),
  items: z.array(z.object({
    id: z.number().int(), name: z.string(), category: z.string(), description: z.string(),
    family: z.string().optional(), quality: z.number().int().optional(),
    approvedPrice: z.object({ value: z.number().finite().nonnegative(), source: z.string().min(1) }).optional(),
    basePrice: z.number().finite().nonnegative().nullable(), priceSource: z.string(), priceNote: z.string(),
    priceEstimate: z.object({ min: z.number().finite().nonnegative(), max: z.number().finite().nonnegative() }).optional(),
    stageId: z.string(), firstPlacement: z.string(), placementNote: z.string(), placementSources: z.array(z.string()),
    exchangeUses: z.array(z.string()).optional(),
    contents: z.array(z.object({ id: z.number().int(), name: z.string(), kind: z.enum(['guaranteed', 'choice', 'random']), source: z.string() })).optional(),
    contentGaps: z.array(z.string()).optional(),
  })).max(10000),
}).superRefine((d, ctx) => {
  if (new Set(d.items.map(i => i.id)).size !== d.items.length || new Set(d.stages.map(s => s.id)).size !== d.stages.length) ctx.addIssue({ code: 'custom', message: '道具或投放节点身份重复' })
  if (d.items.some(i => !d.stages.some(s => s.id === i.stageId) || (i.basePrice !== null && !i.priceSource.trim()))) ctx.addIssue({ code: 'custom', message: '道具缺少投放节点或定价依据' })
  if (d.items.some(i => i.priceEstimate && (i.basePrice === null || i.priceEstimate.min > i.priceEstimate.max || i.basePrice < i.priceEstimate.min || i.basePrice > i.priceEstimate.max))) ctx.addIssue({ code: 'custom', message: '推算范围与道具价值不一致' })
  if (d.reviewGroups?.some(g => g.itemIds.some(id => !d.items.some(i => i.id === id)))) ctx.addIssue({ code: 'custom', message: '待处理事项引用了未收录道具' })
  if (d.items.some(i => i.approvedPrice && i.approvedPrice.value !== i.basePrice)) ctx.addIssue({ code: 'custom', message: '已确认价格与当前基础价不一致' })
}).transform(d => ({ ...d, items: d.items.map(i => {
  if (!i.priceEstimate) return i
  const { priceEstimate: _retired, ...rest } = i
  return { ...rest, basePrice: null, priceSource: '', priceNote: '旧版礼包反推值已停用，请更新为《商业化产出》道具定价页的直接值。' }
}) }))
export type ItemValueDataset = z.infer<typeof itemValueDatasetSchema>
export type ValueItem = ItemValueDataset['items'][number]
export const VALUE_PAGE = 'page:item-value-map' as TLPageId
export const PENDING_PAGE = 'page:item-value-pending' as TLPageId
export function readItemValueMap(meta: unknown) {
  const r = z.object({ itemValueOverview: itemValueDatasetSchema }).safeParse(meta)
  return r.success ? r.data.itemValueOverview : undefined
}
export function readItemValueNode(shape: { meta: unknown } | undefined) {
  const r = z.object({ itemValueNode: z.object({ version: z.literal(1), itemId: z.number().int() }) }).safeParse(shape?.meta)
  return r.success ? r.data.itemValueNode : undefined
}
export const itemShapeId = (id: number) => `shape:item-value-${id}` as TLShapeId
export function readItemValueGroup(shape: { meta: unknown } | undefined) {
  const r = z.object({ itemValueGroup: z.object({ key: z.string(), label: z.string(), itemIds: z.array(z.number().int()), expanded: z.boolean() }) }).safeParse(shape?.meta)
  return r.success ? r.data.itemValueGroup : undefined
}
export function itemValueVisibility(shape: TLShape, editor: Editor): 'hidden' | 'inherit' {
  const owner = shape.meta.itemValueGroupId
  if (typeof owner !== 'string') return 'inherit'
  const group = readItemValueGroup(editor.getShape(owner as TLShapeId))
  return group && !group.expanded ? 'hidden' : 'inherit'
}
const qualities = ['', '白色', '绿色', '蓝色', '紫色', '金色', '红色', '彩紫', '彩金', '彩红']
export function itemValueGroups(data: ItemValueDataset) {
  const buckets = new Map<string, ValueItem[]>()
  for (const i of data.items) {
    if (!i.family || !i.quality || i.basePrice === null) continue
    const key = `${i.family}-${i.quality}-${i.basePrice}-${i.stageId}`
    buckets.set(key, [...(buckets.get(key) ?? []), i])
  }
  return [...buckets].filter(([, items]) => items.length >= 2).map(([key, items]) => ({ key,
    label: `${qualities[items[0]!.quality!] ?? `品质${items[0]!.quality}`}·${items[0]!.family}`, items: items.sort((a, b) => a.id - b.id) }))
}
export function keepApprovedPrices(before: ItemValueDataset, next: ItemValueDataset): ItemValueDataset {
  const items = next.items.map(i => {
    const approval = i.approvedPrice ?? before.items.find(b => b.id === i.id)?.approvedPrice
    if (!approval) return i
    if (i.basePrice === approval.value && !i.approvedPrice) return { ...i, approvedPrice: approval }
    return { ...i, approvedPrice: approval, basePrice: approval.value, priceSource: approval.source,
      priceNote: i.basePrice !== null && i.basePrice !== approval.value ? `已确认 ${approval.value} 钻；新资料为 ${i.basePrice} 钻，源表差异待核对。` : '按用户已确认的同品质统一定价；正式定价表尚未收录这些道具。' }
  })
  return { ...next, items, ...(next.reviewGroups ? { reviewGroups: next.reviewGroups.map(g => g.kind === 'price' ? { ...g, itemIds: g.itemIds.filter(id => items.find(i => i.id === id)?.basePrice === null) } : g).filter(g => g.itemIds.length) } : {}) }
}
export function itemPriceLabel(d: ItemValueDataset, i: ValueItem) {
  const number = (n: number) => n.toLocaleString('zh-CN', { maximumFractionDigits: 6 })
  if (i.basePrice === null) return '基础价待补'
  if (i.priceEstimate) return '基础价待核验'
  return `${number(i.basePrice)} ${d.priceUnit}`
}
export function itemProducts(data: CommerceDataset | undefined, id: number) {
  return data?.products.filter(p => isCatalogProduct(p) && [...p.rewards, ...(p.extraRewards ?? [])].some(r => r.id === id)) ?? []
}

// Equal-height price bands are deliberately labelled ranges, never a pretend linear scale.
const bands = [
  { min: 10000, label: '≥ 10,000' }, { min: 1000, label: '1,000 — <10,000' },
  { min: 100, label: '100 — <1,000' }, { min: 10, label: '10 — <100' },
  { min: 1, label: '1 — <10' }, { min: 0, label: '0 — <1' },
]
export function valueBand(price: number) { return bands.findIndex(b => price >= b.min) }

/** Native shapes contain item identities only. Merchandise, icons and revenue stay in their owning board. */
export function valuePages(store: TLStore) {
  const pages = store.query.records('page').get()
  return {
    value: pages.find(p => p.meta.itemValuePage === 'value' || p.id === VALUE_PAGE)?.id,
    pending: pages.find(p => p.meta.itemValuePage === 'pending' || p.id === PENDING_PAGE)?.id,
  }
}
export function itemValueRecords(data: ItemValueDataset, pages = { value: VALUE_PAGE, pending: PENDING_PAGE }, expanded = new Set<string>()) {
  const { value: VALUE_PAGE, pending: PENDING_PAGE } = pages
  const records: Record<string, unknown>[] = [], indices = getIndices(data.items.length * 2 + data.stages.length * 20 + (data.reviewGroups?.length ?? 0) * 3 + 100)
  let n = 0
  const shape = (id: string, page: TLPageId, x: number, y: number, locked = false) => ({ id, typeName: 'shape', parentId: page, index: indices[n++]!, x, y, rotation: 0, opacity: 1, isLocked: locked, meta: { itemValueLayout: true } })
  const text = (id: string, page: TLPageId, x: number, y: number, content: string, w: number, size = 's', color = 'black') => records.push({ ...shape(id, page, x, y, true), type: 'text', props: { richText: toRichText(content), w, autoSize: false, scale: 1, color, size, font: 'sans', textAlign: 'start' } })
  const line = (id: string, x: number, y: number, w: number, h: number) => records.push({ ...shape(id, VALUE_PAGE, x, y, true), type: 'geo', props: { w, h, geo: 'rectangle', dash: 'solid', growY: 0, url: '', scale: 1, color: 'grey', labelColor: 'black', fill: 'none', size: 's', font: 'sans', align: 'start', verticalAlign: 'start', richText: toRichText('') } })
  const node = (i: ValueItem, page: TLPageId, x: number, y: number, owner?: string) => records.push({ ...shape(itemShapeId(i.id), page, x, y), type: 'geo', meta: { itemValueNode: { version: 1, itemId: i.id }, ...(owner ? { itemValueGroupId: owner } : {}) }, props: { w: 164, h: 88, geo: 'rectangle', dash: 'solid', growY: 0, url: '', scale: 1, color: 'grey', labelColor: 'black', fill: 'solid', size: 's', font: 'sans', align: 'start', verticalAlign: 'start', richText: toRichText(`${i.name}\n${itemPriceLabel(data, i)}`) } })
  const families = itemValueGroups(data), familyByItem = new Map(families.flatMap(g => g.items.map(i => [i.id, g] as const)))
  const plotted = data.items.filter(i => i.basePrice !== null)
  const stages = data.stages.filter(s => plotted.some(i => i.stageId === s.id)).sort((a, b) => a.order - b.order)
  const colWidth = 368, left = 230
  text('shape:iv-title', VALUE_PAGE, 0, -114, '道具价值投放总览', 900, 'xl')
  text('shape:iv-subtitle', VALUE_PAGE, 0, -50, `基础价值（${data.priceUnit}/个） × 已核到的投放节点 · ${data.items.some(i => i.approvedPrice) ? '表内定价＋已确认补充' : '直接读取《商业化产出》道具定价'}`, Math.max(1100, left + stages.length * colWidth))
  text('shape:iv-y', VALUE_PAGE, 0, 0, '基础价值 ↑', 210)
  stages.forEach((s, c) => text(`shape:iv-stage-${c}`, VALUE_PAGE, left + c * colWidth, 0, `${s.label}${s.kind !== 'progress' ? '\n条件区 · 不代表先后' : ''}`, colWidth - 20))
  let y = 72
  for (const [b, band] of bands.entries()) {
    const groups = stages.map(s => plotted.filter(i => i.stageId === s.id && valueBand(i.basePrice!) === b).sort((a, b) => b.basePrice! - a.basePrice! || a.id - b.id))
    if (!groups.some(g => g.length)) continue
    const layouts = groups.map(items => {
      let offset = 10, half = false, rowHeight = 100
      const entries: { item: ValueItem; group?: (typeof families)[number]; x: number; y: number }[] = []
      const seen = new Set<string>()
      for (const item of items) {
        const group = familyByItem.get(item.id)
        if (group) {
          if (seen.has(group.key)) continue
          seen.add(group.key)
          if (expanded.has(group.key)) {
            if (half) { offset += rowHeight; half = false; rowHeight = 100 }
            entries.push({ item, group, x: 0, y: offset })
            offset += 126 + Math.ceil(group.items.length / 2) * 100
          } else {
            entries.push({ item, group, x: half ? 178 : 0, y: offset })
            rowHeight = 126
            if (half) { offset += rowHeight; rowHeight = 100 }
            half = !half
          }
        } else {
          entries.push({ item, x: half ? 178 : 0, y: offset })
          if (half) { offset += rowHeight; rowHeight = 100 }
          half = !half
        }
      }
      return { entries, height: offset + (half ? rowHeight : 0) }
    })
    const height = Math.max(108, ...layouts.map(g => g.height))
    text(`shape:iv-band-${b}`, VALUE_PAGE, 0, y + 14, band.label, 210)
    layouts.forEach(({ entries }, c) => {
      line(`shape:iv-cell-${b}-${c}`, left + c * colWidth - 8, y, colWidth, height)
      entries.forEach(({ item, group, x, y: dy }) => {
        const px = left + c * colWidth + x, py = y + dy
        if (!group) { node(item, VALUE_PAGE, px, py); return }
        const id = `shape:iv-family-${group.key}`, isExpanded = expanded.has(group.key)
        records.push({ ...shape(id, VALUE_PAGE, px, py), type: 'geo', meta: { itemValueGroup: { key: group.key, label: group.label, itemIds: group.items.map(i => i.id), expanded: isExpanded } }, props: { w: isExpanded ? 342 : 164, h: 114, geo: 'rectangle', dash: 'solid', growY: 0, url: '', scale: 1, color: 'grey', labelColor: 'black', fill: 'solid', size: 's', font: 'sans', align: 'start', verticalAlign: 'start', richText: toRichText(`${group.label} · ${group.items.length}项\n${itemPriceLabel(data, item)}/个`) } })
        group.items.forEach((i, k) => node(i, VALUE_PAGE, px + (isExpanded ? k % 2 * 178 : 0), py + (isExpanded ? 126 + Math.floor(k / 2) * 100 : 0), id))
      })
    })
    y += height + 16
  }
  if (!plotted.length) {
    text('shape:iv-empty', VALUE_PAGE, left, y, '基础定价尚未核验。全部道具已收录在「基础价待核验」。', 1100, 'm')
    y += 100
  }
  text('shape:iv-x', VALUE_PAGE, left, y + 10, '投放进度 →  ·  全游戏首次仍待核验；活动与待核验条件单列', Math.max(1100, stages.length * colWidth))
  const pending = data.items.filter(i => i.basePrice === null).sort((a, b) => a.category.localeCompare(b.category, 'zh-CN') || a.id - b.id)
  const reviews = data.reviewGroups ?? []
  text('shape:iv-pending-title', PENDING_PAGE, 0, -110, `定价待处理 · ${pending.length} 个道具`, 1200, 'xl')
  text('shape:iv-pending-note', PENDING_PAGE, 0, -40, reviews.length ? `${reviews.filter(g => g.kind === 'price').length} 项定价事项 · ${reviews.filter(g => g.kind === 'name').length} 项名称核对。参考价尚未写成这些道具的定价。` : '基础价缺失时不按零元绘图。点开道具查看缺项、投放条件与来源。', 1600)
  let pendingY = 50
  reviews.forEach((g, k) => {
    const x = (k % 3) * 550, y = 50 + Math.floor(k / 3) * 230
    text(`shape:iv-review-title-${g.id}`, PENDING_PAGE, x, y, `${k + 1}. ${g.title}${g.itemIds.length > 1 ? ` · ${g.itemIds.length}项` : ''}`, 520, 'm')
    text(`shape:iv-review-body-${g.id}`, PENDING_PAGE, x, y + 60, `${g.context}\n${g.question}`, 510)
  })
  if (reviews.length) pendingY += Math.ceil(reviews.length / 3) * 230 + 50
  for (const [index, category] of [...new Set(pending.map(i => i.category))].entries()) {
    const group = pending.filter(i => i.category === category)
    text(`shape:iv-pending-group-${index}`, PENDING_PAGE, 0, pendingY, `${category} · ${group.length}`, 1100, 'm')
    pendingY += 50
    group.forEach((i, k) => node(i, PENDING_PAGE, (k % 6) * 180, pendingY + Math.floor(k / 6) * 100))
    pendingY += Math.ceil(group.length / 6) * 100 + 32
  }
  return records
}
export function createItemValueSnapshot(data: ItemValueDataset) {
  const parsed = itemValueDatasetSchema.parse(data), store = createBoardStore(), base = getStoreSnapshot(store)
  const doc = Object.values(base.store).find(r => r.typeName === 'document')!
  const records = [
    { ...doc, meta: { itemValueOverview: parsed } },
    { id: VALUE_PAGE, typeName: 'page', name: '价值 × 首次投放', index: 'a1', meta: { itemValuePage: 'value' } },
    { id: PENDING_PAGE, typeName: 'page', name: '待核验道具', index: 'a2', meta: { itemValuePage: 'pending' } },
    ...itemValueRecords(parsed),
  ]
  loadSnapshotIntoStore(store, { schema: base.schema, store: Object.fromEntries(records.map(r => [r.id, r])) })
  return getStoreSnapshot(store)
}
export function focusValueItem(editor: Editor, id: number) {
  const shape = editor.store.query.records('shape').get().find(s => readItemValueNode(s)?.itemId === id); if (!shape) return false
  if (typeof shape.meta.itemValueGroupId === 'string' && !readItemValueGroup(editor.store.get(shape.meta.itemValueGroupId as TLShapeId))?.expanded) toggleItemValueGroup(editor, shape.meta.itemValueGroupId as TLShapeId)
  editor.setCurrentPage(shape.parentId as TLPageId); editor.select(shape.id)
  const bounds = editor.getShapePageBounds(shape.id)
  if (bounds) editor.zoomToBounds(new Box(bounds.x - 180, bounds.y - 120, bounds.w + 360, bounds.h + 240), { targetZoom: 1, animation: { duration: 200 } })
  return true
}
/** Reflow generated cells by their size delta; preserve manual offsets and all item identities. */
export function toggleItemValueGroup(editor: Editor, id: TLShapeId) {
  const store = editor.store, group = readItemValueGroup(store.get(id))
  const data = readItemValueMap(store.query.records('document').get()[0]?.meta), pages = valuePages(store)
  if (!group || !data || !pages.value || !pages.pending) return
  const shapes = store.query.records('shape').get()
  const expanded = new Set(shapes.flatMap(s => { const g = readItemValueGroup(s); return g?.expanded ? [g.key] : [] }))
  const before = new Map(itemValueRecords(data, pages as { value: TLPageId; pending: TLPageId }, expanded).map(r => [r.id, r]))
  group.expanded ? expanded.delete(group.key) : expanded.add(group.key)
  const itemIds = new Map(shapes.flatMap(s => { const n = readItemValueNode(s); return n ? [[n.itemId, s.id] as const] : [] }))
  const groupIds = new Map(shapes.flatMap(s => { const g = readItemValueGroup(s); return g ? [[g.key, s.id] as const] : [] }))
  const after = itemValueRecords(data, pages as { value: TLPageId; pending: TLPageId }, expanded)
  const changes = after.map(r => {
    const node = readItemValueNode(r as { meta: unknown }), g = readItemValueGroup(r as { meta: unknown })
    const actualId = node ? itemIds.get(node.itemId) : g ? groupIds.get(g.key) : r.id as TLShapeId
    let old = actualId && store.get(actualId) as TLGeoShape | undefined, base = before.get(r.id)
    const meta = r.meta as Record<string, unknown>
    if (typeof meta.itemValueGroupId === 'string') {
      const groupBase = before.get(meta.itemValueGroupId), ownerKey = meta.itemValueGroupId.slice('shape:iv-family-'.length)
      const owner = store.get(groupIds.get(ownerKey) ?? meta.itemValueGroupId as TLShapeId) as TLGeoShape | undefined
      if (owner && !readItemValueGroup(owner)?.expanded) { old = owner; base = groupBase }
    }
    if (typeof meta.itemValueGroupId === 'string') meta.itemValueGroupId = groupIds.get(meta.itemValueGroupId.slice('shape:iv-family-'.length)) ?? meta.itemValueGroupId
    return { ...r, id: actualId ?? r.id, x: Number(r.x) + (old && base ? old.x - Number(base.x) : 0), y: Number(r.y) + (old && base ? old.y - Number(base.y) : 0) }
  })
  editor.markHistoryStoppingPoint('toggle-item-value-group')
  editor.run(() => store.put(changes as never[]))
}
export function updateItemValueData(store: TLStore, next: ItemValueDataset, editor: Editor) {
  next = itemValueDatasetSchema.parse(next)
  const doc = store.query.records('document').get()[0], before = readItemValueMap(doc?.meta)
  if (!doc || !before || before.sourceBoardId !== next.sourceBoardId) throw new Error('资料不属于当前道具总览')
  next = keepApprovedPrices(before, next)
  const pages = valuePages(store)
  if (!pages.value || !pages.pending) throw new Error('道具总览页面不完整，请从原始项目包恢复')
  editor.markHistoryStoppingPoint('update-item-value-data')
  editor.run(() => {
    store.put([{ ...doc, meta: { ...doc.meta, itemValueOverview: next } }])
    // Only generated content is rebuilt. Freeform notes, annotations and other pages remain.
    const old = store.query.records('shape').get().filter(s => readItemValueNode(s) || readItemValueGroup(s) || s.meta.itemValueLayout)
    const identities = new Map(old.flatMap(s => { const node = readItemValueNode(s); return node ? [[node.itemId, s.id] as const] : [] }))
    const groupIdentities = new Map(old.flatMap(s => { const group = readItemValueGroup(s); return group ? [[group.key, s.id] as const] : [] }))
    const records = itemValueRecords(next, { value: pages.value!, pending: pages.pending! }).map(r => {
      const node = readItemValueNode(r as { meta: unknown })
      const group = readItemValueGroup(r as { meta: unknown }), meta = r.meta as Record<string, unknown>
      if (typeof meta.itemValueGroupId === 'string') meta.itemValueGroupId = groupIdentities.get(meta.itemValueGroupId.slice('shape:iv-family-'.length)) ?? meta.itemValueGroupId
      if (group && groupIdentities.has(group.key)) return { ...r, id: groupIdentities.get(group.key)! }
      return node && identities.has(node.itemId) ? { ...r, id: identities.get(node.itemId)! } : r
    })
    const kept = new Set(records.map(r => r.id)), removed = new Set(old.filter(s => !kept.has(s.id)).map(s => s.id))
    // Existing item identities keep annotations connected, including after package ID remapping.
    store.remove(store.query.records('binding').get().filter(b => removed.has(b.fromId) || removed.has(b.toId)).map(b => b.id))
    store.remove([...removed])
    store.put(records as never[])
  })
}
