import { getIndices, toRichText, type Editor, type TLGeoShape, type TLPageId, type TLShapeId, type TLStore } from 'tldraw'
import { z } from 'zod'
import type { CommerceDataset } from './commerce-data'
import { commerceEntrances, entranceProducts } from './commerce-browse'
import { readDesignCard } from './commerce-design-map'
import type { getStoreSnapshot } from '@infinite-board/tldraw-adapter'

export const overviewPageId = 'page:commerce-overview' as TLPageId
export const overviewEntries = commerceEntrances.slice(0, 6)
export const designFieldsSchema = z.object({ title: z.string(), goal: z.string(), measure: z.string(), decision: z.enum(['draft', 'confirmed']) })
export type DesignFields = z.infer<typeof designFieldsSchema>
const position = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() })
const entranceSchema = z.object({
  version: z.literal(1), entrance: z.enum(['shop', 'benefits', 'first', 'trigger', 'chain', 'events']),
  expanded: z.boolean().default(false), home: position.optional(), designRef: z.string().optional(), design: designFieldsSchema.optional(),
})
export type EntranceCard = z.infer<typeof entranceSchema>
export function readEntranceCard(shape: { meta: unknown } | undefined) {
  const r = z.object({ commerceEntrance: entranceSchema }).safeParse(shape?.meta)
  return r.success ? r.data.commerceEntrance : undefined
}
export function entranceDesign(store: TLStore, card: EntranceCard): DesignFields | undefined {
  return card.designRef ? readDesignCard(store.get(card.designRef as TLShapeId) as TLGeoShape ?? { meta: {} }) : card.design
}
const drafts: Record<string, [string, string, string]> = {
  shop: ['按需补充养成资源', '资源不足时有可选择的补充方式。', '资源缺口 → 购买 → 使用 → 养成推进'],
  benefits: ['让持续投入获得稳定回报', '每日领取、阶段奖励与权益形成持续价值。', '购买 → 领取与使用 → 持续游玩 / 续购'],
  trigger: ['在需求出现时提供补充', '触发条件与玩家当时的资源需求相匹配。', '触发 → 曝光 → 购买 → 需求是否缓解'],
  chain: ['让连续购买有清晰的阶段回报', '每一档都有用途，玩家能判断是否继续购买。', '各档曝光 → 购买 → 使用 → 下一档 / 停止'],
  events: ['围绕活动目标提供可选补充', '商品帮助玩家参与活动、完成阶段目标。', '参与 → 商品曝光 → 购买 → 活动目标完成'],
}

/** Only design text, source selectors and layout are saved. Catalog values stay at the source. */
export function overviewRecords() {
  const indices = getIndices(6)
  return [
    { id: overviewPageId, typeName: 'page', name: '商业模式总览', index: 'a0', meta: {} },
    ...overviewEntries.map((entry, i) => {
      const draft = drafts[entry.id]
      const card: EntranceCard = { version: 1, entrance: entry.id as EntranceCard['entrance'], expanded: false,
        ...(entry.id === 'first' ? { designRef: 'shape:rhythm-first-design' } : { design: { title: draft![0], goal: draft![1], measure: draft![2], decision: 'draft' as const } }) }
      return { id: `shape:commerce-entrance-${entry.id}`, typeName: 'shape', type: 'geo', parentId: overviewPageId, index: indices[i], x: 22 + i % 3 * 392, y: 24 + Math.floor(i / 3) * 270,
        rotation: 0, isLocked: false, opacity: 1, meta: { commerceEntrance: card }, props: { w: 360, h: 240, geo: 'rectangle', dash: 'solid', growY: 0, url: '', scale: 1, color: 'grey', labelColor: 'black', fill: 'solid', size: 's', font: 'sans', align: 'start', verticalAlign: 'start', richText: toRichText(entry.name) } }
    }),
  ]
}
export function withCommerceOverview(snapshot: ReturnType<typeof getStoreSnapshot>) {
  if (snapshot.store[overviewPageId]) return snapshot
  const records = overviewRecords()
  return { ...snapshot, store: { ...snapshot.store, ...Object.fromEntries(records.map(r => [r.id, r])) } } as ReturnType<typeof getStoreSnapshot>
}
export function ensureCommerceOverview(editor: Editor) {
  if (!editor.store.get(overviewPageId)) {
    editor.markHistoryStoppingPoint('create-commerce-overview')
    editor.store.put(overviewRecords() as Parameters<TLStore['put']>[0])
  }
  editor.setCurrentPage(overviewPageId)
  editor.zoomToFit({ animation: { duration: 200 } })
}
export function collapsePatch(shape: TLGeoShape) {
  const card = readEntranceCard(shape)
  if (!card?.expanded || !card.home) return undefined
  return { id: shape.id, type: 'geo' as const, x: card.home.x, y: card.home.y, props: { w: card.home.w, h: card.home.h }, meta: { ...shape.meta, commerceEntrance: { ...card, expanded: false } } }
}
export function showCommerceOverview(editor: Editor, canEdit = true) {
  editor.setCurrentPage(overviewPageId)
  if (canEdit) editor.run(() => {
    const patches = editor.getCurrentPageShapes().flatMap(s => { const p = s.type === 'geo' && collapsePatch(s as TLGeoShape); return p ? [p] : [] })
    if (patches.length) { editor.markHistoryStoppingPoint('collapse-commerce-overview'); editor.updateShapes(patches) }
  })
  editor.zoomToFit({ animation: { duration: 200 } })
}
export function toggleEntrance(editor: Editor, id: TLShapeId) {
  const shape = editor.getShape<TLGeoShape>(id), card = readEntranceCard(shape)
  if (!shape || !card) return
  editor.markHistoryStoppingPoint('toggle-commerce-entrance')
  if (card.expanded) {
    const patch = collapsePatch(shape)
    if (patch) editor.updateShapes([patch])
    editor.zoomToFit({ animation: { duration: 200 } }); return
  }
  editor.run(() => {
    for (const s of editor.getCurrentPageShapes()) {
      const patch = s.type === 'geo' && collapsePatch(s as TLGeoShape)
      if (patch) editor.updateShapes([patch])
    }
    const otherBounds = editor.getCurrentPageShapes().filter(s => s.id !== id).flatMap(s => { const b = editor.getShapePageBounds(s); return b ? [b] : [] })
    const y = Math.max(shape.y + shape.props.h, ...otherBounds.map(b => b.maxY)) + 64
    editor.updateShapes([{ id, type: 'geo', x: Math.min(shape.x, ...otherBounds.map(b => b.x)), y, props: { w: 1120, h: 380 }, meta: { ...shape.meta, commerceEntrance: { ...card, expanded: true, home: { x: shape.x, y: shape.y, w: shape.props.w, h: shape.props.h } } } }])
  })
  const bounds = editor.getShapePageBounds(id)
  if (bounds) editor.zoomToBounds(bounds, { inset: 64, animation: { duration: 250 } })
}
export function arrangeOverview(editor: Editor) {
  editor.markHistoryStoppingPoint('arrange-commerce-overview')
  editor.run(() => {
    for (const [i, entry] of overviewEntries.entries()) {
      const shape = editor.getShape<TLGeoShape>(`shape:commerce-entrance-${entry.id}` as TLShapeId), card = readEntranceCard(shape)
      if (shape && card) editor.updateShapes([{ id: shape.id, type: 'geo', x: 22 + i % 3 * 392, y: 24 + Math.floor(i / 3) * 270, props: { w: 360, h: 240 }, meta: { ...shape.meta, commerceEntrance: { ...card, expanded: false } } }])
    }
  })
  editor.zoomToFit({ animation: { duration: 200 } })
}
export function entranceHistory(data: CommerceDataset, entrance: string) {
  const products = entranceProducts(data, entrance), keys = new Set(products.map(p => p.key)), ledger = data.evidence?.ledger
  const payments = ledger?.payments.filter(r => keys.has(r.key)) ?? [], purchases = ledger?.purchases.filter(r => keys.has(r.key)) ?? []
  return { products, cash: payments.length ? payments.reduce((n,r) => n + r.cashYuan, 0) : undefined,
    cashOrders: payments.reduce((n,r) => n + r.cashOrders, 0), voucher: payments.reduce((n,r) => n + r.voucherOrderYuan, 0),
    diamonds: purchases.length ? purchases.reduce((n,r) => n + r.diamonds, 0) : undefined, diamondOrders: purchases.reduce((n,r) => n + r.orders, 0),
    recordedProducts: new Set([...payments.filter(r => r.cashOrders + r.voucherOrders > 0).map(r => r.key), ...purchases.map(r => r.key)]).size }
}
