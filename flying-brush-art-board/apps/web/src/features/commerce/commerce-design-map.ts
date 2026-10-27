import { getIndices, toRichText, type Editor, type TLGeoShape, type TLShapeId } from 'tldraw'
import { createBoardStore, getStoreSnapshot, loadSnapshotIntoStore } from '@infinite-board/tldraw-adapter'
import { z } from 'zod'
import { isCatalogProduct, readCommerceDataset, type CommerceDataset } from './commerce-data'
import { ledgerRows } from './commerce-ledger'

const mapSchema = z.object({ version: z.literal(1), template: z.literal('pay-rhythm'), sourceBoardId: z.string().min(1) })
export const designCardSchema = z.object({
  version: z.literal(1), kind: z.enum(['design', 'implementation', 'validation']),
  theme: z.enum(['first', 'monthly']), productKeys: z.array(z.string()).min(1),
  designId: z.string(), title: z.string(), goal: z.string().default(''),
  measure: z.string().default(''), decision: z.enum(['draft', 'confirmed']).default('draft'),
})
export type DesignCard = z.infer<typeof designCardSchema>
export const designKindNames = { design: '设计', implementation: '实现', validation: '验证' }
export function readDesignCard(shape: { meta: unknown }): DesignCard | undefined {
  const result = z.object({ commerceDesignCard: designCardSchema }).safeParse(shape.meta)
  return result.success ? result.data.commerceDesignCard : undefined
}
export function readDesignMap(meta: unknown) {
  const result = z.object({ commerceDesignMap: mapSchema }).safeParse(meta)
  return result.success ? result.data.commerceDesignMap : undefined
}
export function datasetFromSnapshot(snapshot: unknown) {
  const v = snapshot as { store?: Record<string, { typeName?: string; meta?: unknown }>; document?: { store?: Record<string, { typeName?: string; meta?: unknown }> } } | undefined
  return readCommerceDataset(Object.values(v?.document?.store ?? v?.store ?? {}).find(r => r.typeName === 'document')?.meta)
}
export function designMapFromSnapshot(snapshot: unknown) {
  const v = snapshot as { store?: Record<string, { typeName?: string; meta?: unknown }> } | undefined
  return readDesignMap(Object.values(v?.store ?? {}).find(r => r.typeName === 'document')?.meta)
}
export function linkedProducts(data: CommerceDataset, card: DesignCard) {
  return card.productKeys.flatMap(key => { const p = data.products.find(p => p.key === key && isCatalogProduct(p)); return p ? [p] : [] })
}
export function designPayments(data: CommerceDataset, card: DesignCard) {
  const rows = linkedProducts(data, card).flatMap(p => ledgerRows(data, p, 'all').payments)
  return rows.length ? { cash: rows.reduce((n, r) => n + r.cashYuan, 0), orders: rows.reduce((n, r) => n + r.cashOrders, 0), voucher: rows.reduce((n, r) => n + r.voucherOrderYuan, 0), voucherOrders: rows.reduce((n, r) => n + r.voucherOrders, 0) } : undefined
}

/** Persist layout and references only. Prices, rewards and observations stay in the source board. */
export function createPayRhythmSnapshot(sourceBoardId: string, data: CommerceDataset) {
  const boardStore = createBoardStore(), base = getStoreSnapshot(boardStore)
  const records: Record<string, unknown> = {}
  const document = Object.values(base.store).find(r => r.typeName === 'document')!
  records[document.id] = { ...document, meta: { ...document.meta, commerceDesignMap: { version: 1, template: 'pay-rhythm', sourceBoardId } } }
  records['page:pay-rhythm'] = { id: 'page:pay-rhythm', typeName: 'page', name: '调优付费节奏', index: 'a1', meta: {} }
  const indices = getIndices(24); let index = 0
  const common = (id: string, x: number, y: number) => ({ id, typeName: 'shape', parentId: 'page:pay-rhythm', index: indices[index++]!, x, y, rotation: 0, isLocked: false, opacity: 1, meta: {} })
  const text = (id: string, x: number, y: number, content: string, w: number, size = 'm', color = 'black') => {
    records[id] = { ...common(id, x, y), type: 'text', props: { richText: toRichText(content), w, autoSize: false, scale: 1, color, size, font: 'sans', textAlign: 'start' } }
  }
  for (const [row, theme] of (['first', 'monthly'] as const).entries()) {
    const products = data.products.filter(p => isCatalogProduct(p) && p.channel === (theme === 'first' ? '首充' : '月卡'))
    if (!products.length) throw new Error(`缺少${theme === 'first' ? '首充' : '月卡'}商品，未创建空链路。`)
    const y = 44 + row * 280, designId = `shape:rhythm-${theme}-design`
    text(`shape:rhythm-${theme}-label`, 22, y - 44, theme === 'first' ? '01  首充' : '02  月卡', 600)
    for (const [column, kind] of (['design', 'implementation', 'validation'] as const).entries()) {
      const id = `shape:rhythm-${theme}-${kind}`
      const card: DesignCard = { version: 1, kind, theme, productKeys: products.map(p => p.key), designId,
        title: kind === 'design' ? (theme === 'first' ? '首次付费后获得补强' : '持续供给值得每天领取') : kind === 'implementation' ? (theme === 'first' ? '首充商品' : '两种月卡') : '购买已记录，效果待验证',
        goal: kind === 'design' ? (theme === 'first' ? '获得补强后，继续推进关卡。' : '每日供给有用，玩家持续领取并使用。') : '',
        measure: kind === 'design' ? (theme === 'first' ? '曝光 → 首购 → 领奖与使用 → 后续推进' : '购买 → 每日领取 → 资源使用 → 持续游玩') : '', decision: 'draft' }
      records[id] = { ...common(id, 22 + column * 390, y), type: 'geo',
        meta: { commerceDesignCard: card }, props: { w: 340, h: 220, geo: 'rectangle', dash: 'solid', growY: 0, url: '', scale: 1, color: 'grey', labelColor: 'black', fill: 'solid', size: 's', font: 'sans', align: 'start', verticalAlign: 'start', richText: toRichText(card.title) } }
      if (column === 0) continue
      const fromId = `shape:rhythm-${theme}-${column === 1 ? 'design' : 'implementation'}`, arrow = `shape:rhythm-${theme}-arrow-${column}`
      records[arrow] = { ...common(arrow, 0, 0), type: 'arrow', props: { kind: 'arc', elbowMidPoint: 0.5, dash: 'solid', size: 's', fill: 'none', color: 'grey', labelColor: 'grey', bend: 0, start: { x: 0, y: 0 }, end: { x: 50, y: 0 }, arrowheadStart: 'none', arrowheadEnd: 'arrow', richText: toRichText(''), labelPosition: 0.5, font: 'sans', scale: 1 } }
      for (const [terminal, target, anchor] of [['start', fromId, 1], ['end', id, 0]] as const) {
        const binding = `binding:rhythm-${theme}-${column}-${terminal}`
        records[binding] = { id: binding, typeName: 'binding', type: 'arrow', fromId: arrow, toId: target, props: { terminal, normalizedAnchor: { x: anchor, y: 0.5 }, isExact: false, isPrecise: true, snap: 'none' }, meta: {} }
      }
    }
  }
  loadSnapshotIntoStore(boardStore, { store: records, schema: base.schema })
  return getStoreSnapshot(boardStore)
}
export function updateDesignCard(shape: TLGeoShape, change: Pick<DesignCard, 'title' | 'goal' | 'measure' | 'decision'>) {
  const card = readDesignCard(shape)
  if (!card || card.kind !== 'design') throw new Error('只有设计卡片可修改设计目标。')
  return { id: shape.id, type: 'geo' as const, meta: { ...shape.meta, commerceDesignCard: { ...card, ...change } }, props: { richText: toRichText(change.title) } }
}

/** Explicit user action only: never reset a hand-arranged layout on load or source refresh. */
export function arrangePayRhythm(editor: Editor) {
  editor.markHistoryStoppingPoint('arrange-pay-rhythm')
  editor.run(() => {
    for (const shape of editor.getCurrentPageShapes()) {
      const card = readDesignCard(shape)
      if (shape.type !== 'geo' || !card) continue
      const row = card.theme === 'first' ? 0 : 1, column = ['design', 'implementation', 'validation'].indexOf(card.kind)
      editor.updateShapes([{ id: shape.id, type: 'geo', x: 22 + column * 390, y: 44 + row * 280, props: { w: 340, h: 220, growY: 0 } }])
    }
    for (const [row, theme] of ['first', 'monthly'].entries()) {
      const id = `shape:rhythm-${theme}-label` as TLShapeId, shape = editor.getShape(id)
      if (shape?.type === 'text') editor.updateShapes([{id,type:'text',x:22,y:row*280}])
    }
    editor.deleteShapes(['shape:rhythm-title', 'shape:rhythm-subtitle'].filter(id => editor.getShape(id as TLShapeId)) as TLShapeId[])
  })
  editor.zoomToFit({ animation: { duration: 200 } })
}
