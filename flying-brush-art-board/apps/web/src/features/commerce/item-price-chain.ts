import { z } from 'zod'
import { Box, getIndexAbove, getIndices, toRichText, type Editor, type TLGeoShape, type TLPageId, type TLShapeId, type TLStore } from 'tldraw'
import { isCatalogProduct, type CommerceDataset, type CommerceProduct } from './commerce-data'
import { graphFacts } from './commerce-product-graph'

export const PRICE_CHAIN_PAGE = 'page:item-price-chain' as TLPageId
const selectionSchema = z.object({ itemId: z.number().int(), kind: z.enum(['paid', 'diamond', 'cash', 'other']).default('paid'), channel: z.string().default('all'), offset: z.number().int().nonnegative().default(0), compact: z.boolean().optional() })
export type PriceSelection = z.infer<typeof selectionSchema>
const nodeSchema = z.object({ kind: z.enum(['item', 'product', 'price']), itemId: z.number().int(), productKey: z.string().optional() })
export function readPriceSelection(page: { meta: unknown } | undefined) {
  const r = z.object({ itemPriceSelection: selectionSchema }).safeParse(page?.meta)
  return r.success ? r.data.itemPriceSelection : undefined
}
export function readPriceNode(shape: { meta: unknown } | undefined) {
  const r = z.object({ itemPriceNode: nodeSchema }).safeParse(shape?.meta)
  return r.success ? r.data.itemPriceNode : undefined
}
export const priceNumber = (value: string, unit: 'cash' | 'diamond') => {
  const match = (unit === 'cash' ? /^\s*[¥￥]\s*([\d,]+(?:\.\d+)?)\s*$/ : /^\s*([\d,]+(?:\.\d+)?)\s*钻石\s*$/).exec(value)
  return match ? Number(match[1]!.replaceAll(',', '')) : undefined
}

/** Only ordinary recharge rewards establish face value. Bonuses and bundle value do not. */
export function rechargeBasis(data: CommerceDataset) {
  const tiers = data.products.flatMap(p => {
    if (!isCatalogProduct(p) || p.kind !== 'cash' || p.channel !== '钻石充值') return []
    const yuan = priceNumber(p.price, 'cash'), diamonds = p.rewards.filter(r => r.id === 300003).reduce((n, r) => n + r.n, 0)
    return yuan && diamonds > 0 ? [{ key: p.key, yuan, diamonds, source: p.source }] : []
  }).sort((a, b) => a.yuan - b.yuan)
  const ratios = tiers.map(t => t.diamonds / t.yuan)
  const rate = ratios.length && ratios.every(r => Math.abs(r - ratios[0]!) < 1e-8) ? ratios[0] : undefined
  return { tiers, rate }
}
export function priceLink(data: CommerceDataset, product: CommerceProduct) {
  const facts = graphFacts(data, product), basis = rechargeBasis(data)
  const cash = product.kind === 'cash' ? priceNumber(product.price, 'cash') : undefined
  // Multiple historical prices remain distinct. A price change must never become an average.
  const diamonds = product.kind === 'diamond' ? facts.prices.length ? facts.prices : [priceNumber(product.price, 'diamond')].filter((n): n is number => n !== undefined) : []
  return { facts, cash, basis, diamonds: diamonds.map(amount => ({ amount,
    yuan: basis.rate ? amount / basis.rate : undefined,
    // This is a single listed recharge covering the cost, not a recommendation or actual spend.
    coveringTier: basis.tiers.find(t => t.diamonds >= amount),
  })) }
}
export function priceProducts(data: CommerceDataset, s: PriceSelection) {
  const eligible = data.products.filter(p => isCatalogProduct(p) && [...graphFacts(data, p).rewards, ...(p.extraRewards ?? [])].some(r => r.id === s.itemId))
  const filtered = eligible.filter(p => (s.kind === 'paid' ? ['diamond', 'cash'].includes(p.kind) : s.kind === 'other' ? !['diamond', 'cash'].includes(p.kind) : p.kind === s.kind) && (s.channel === 'all' || p.channel === s.channel))
  const channels = ['日礼包', '周礼包', '月礼包', '首充', '月卡']
  const sort = (a: CommerceProduct, b: CommerceProduct) => {
    const rank = (p: CommerceProduct) => channels.includes(p.channel) ? channels.indexOf(p.channel) : 99
    return rank(a) - rank(b) || (priceNumber(a.price, a.kind === 'cash' ? 'cash' : 'diamond') ?? Infinity) - (priceNumber(b.price, b.kind === 'cash' ? 'cash' : 'diamond') ?? Infinity) || a.key.localeCompare(b.key)
  }
  if (s.kind !== 'paid') return filtered.sort(sort)
  const diamond = filtered.filter(p => p.kind === 'diamond').sort(sort), cash = filtered.filter(p => p.kind === 'cash').sort(sort)
  return Array.from({ length: Math.max(diamond.length, cash.length) }, (_, i) => [diamond[i], cash[i]]).flat().filter((p): p is CommerceProduct => !!p)
}
export function selectedQuantity(data: CommerceDataset, product: CommerceProduct, itemId: number) {
  const f = graphFacts(data, product)
  return { regular: f.rewards.filter(r => r.id === itemId).reduce((n, r) => n + r.n, 0), extra: (product.extraRewards ?? []).filter(r => r.id === itemId).reduce((n, r) => n + r.n, 0) }
}
export const PRICE_PAGE_SIZE = 2
export const pricePageSize = (s: PriceSelection) => s.compact ? 1 : PRICE_PAGE_SIZE
export function priceChainRecords(data: CommerceDataset, selection: PriceSelection, pageId = PRICE_CHAIN_PAGE) {
  const products = priceProducts(data, selection).slice(selection.offset, selection.offset + pricePageSize(selection))
  const indices = getIndices(40), records: Record<string, unknown>[] = []; let n = 0
  const base = (id: string, type: string, x: number, y: number) => ({ id, typeName: 'shape', type, parentId: pageId, index: indices[n++]!, x, y, rotation: 0, opacity: 1, isLocked: false, meta: { itemPriceLayout: true } })
  const geo = (kind: 'item' | 'product' | 'price', key: string, x: number, y: number, w: number, h: number) => {
    const id = `shape:iv-price-${selection.itemId}-${kind}-${encodeURIComponent(key)}`
    records.push({ ...base(id, 'geo', x, y), meta: { itemPriceNode: { kind, itemId: selection.itemId, ...(kind === 'item' ? {} : { productKey: key }) } }, props: { w, h, geo: 'rectangle', dash: 'solid', growY: 0, url: '', scale: 1, color: 'grey', labelColor: 'black', fill: 'solid', size: 's', font: 'sans', align: 'start', verticalAlign: 'start', richText: toRichText('') } })
    return id
  }
  const link = (from: string, to: string, key: string) => {
    const id = `shape:iv-price-link-${key}`
    records.push({ ...base(id, 'arrow', 0, 0), props: { kind: 'arc', elbowMidPoint: 0.5, dash: 'solid', size: 's', fill: 'none', color: 'light-blue', labelColor: 'grey', bend: 0, start: { x: 0, y: 0 }, end: { x: 50, y: 0 }, arrowheadStart: 'none', arrowheadEnd: 'arrow', richText: toRichText(''), labelPosition: 0.5, font: 'sans', scale: 1 } })
    for (const [terminal, target, x] of [['start', from, 1], ['end', to, 0]] as const) records.push({ id: `binding:${id}:${terminal}`, typeName: 'binding', type: 'arrow', fromId: id, toId: target, meta: { itemPriceLayout: true }, props: { terminal, normalizedAnchor: { x, y: 0.5 }, isExact: false, isPrecise: true, snap: 'none' } })
  }
  for (const [x, text] of [[0, '01  道具基础价值'], [310, '02  含该道具的商品'], [750, '03  商品售价 · 人民币档位']] as const) records.push({ ...base(`shape:iv-price-heading-${x}`, 'text', x, -48), isLocked: true, props: { richText: toRichText(text), w: 370, autoSize: false, scale: 1, color: 'black', size: 's', font: 'sans', textAlign: 'start' } })
  const item = geo('item', String(selection.itemId), 0, 0, 240, 300)
  let rowY = 0
  products.forEach(p => {
    const height = 248 + Math.max(0, graphFacts(data, p).prices.length - 1) * 60
    const card = geo('product', p.key, 310, rowY, 390, height), price = geo('price', p.key, 750, rowY, 330, height)
    link(item, card, `${selection.itemId}-${encodeURIComponent(p.key)}-reward`); link(card, price, `${selection.itemId}-${encodeURIComponent(p.key)}-price`)
    rowY += height + 20
  })
  ;[...records.filter(r => r.typeName === 'shape' && r.type === 'arrow'), ...records.filter(r => r.typeName === 'shape' && r.type !== 'arrow')].forEach((r, i) => { r.index = indices[i] })
  return records
}
export function currentPricePage(store: TLStore) { return store.query.records('page').get().find(p => readPriceSelection(p)) }
/** Store selection and identities only. Source refresh preserves dragged positions; navigation reflows owned nodes. */
export function openPriceChain(ed: Editor, data: CommerceDataset, selection: PriceSelection, arrange = false) {
  const s = selectionSchema.parse(selection), products = priceProducts(data, s)
  const size = pricePageSize(s)
  s.offset = Math.min(Math.floor(s.offset / size) * size, Math.max(0, Math.ceil(products.length / size) - 1) * size)
  const page = currentPricePage(ed.store), pageId = page?.id ?? PRICE_CHAIN_PAGE
  if (!page && ed.getPages().length >= ed.options.maxPages) throw new Error('画布页数已达上限，请先整理页面')
  const changed = arrange || JSON.stringify(readPriceSelection(page)) !== JSON.stringify(s)
  ed.run(() => {
    ed.markHistoryStoppingPoint('item-price-chain')
    if (!page) ed.createPage({ id: pageId, name: '道具 → 商品售价', index: getIndexAbove(ed.getPages().at(-1)!.index), meta: { itemPriceSelection: s } })
    else ed.updatePage({ id: pageId, meta: { ...page.meta, itemPriceSelection: s } })
    const records = priceChainRecords(data, s, pageId), ids = new Set(records.map(r => r.id))
    const stale = ed.store.query.records('shape').get().filter(r => r.parentId === pageId && (r.meta.itemPriceLayout || readPriceNode(r)) && !ids.has(r.id))
    if (stale.length) ed.deleteShapes(stale.map(r => r.id))
    const additions = records.filter(r => !ed.store.get(r.id as TLShapeId))
    if (additions.length) ed.store.put(additions as unknown as Parameters<TLStore['put']>[0])
    if (changed) ed.updateShapes(records.filter(r => r.typeName === 'shape').map(r => ({ id: r.id, type: r.type, x: r.x, y: r.y, index: r.index, ...(r.type === 'geo' ? { props: { w: (r.props as { w: number }).w, h: (r.props as { h: number }).h } } : {}) })) as Parameters<Editor['updateShapes']>[0])
    ed.setCurrentPage(pageId); ed.selectNone()
  })
  if (changed) focusPriceChain(ed)
  return s
}
export function focusPriceChain(ed: Editor) {
  const shapes = ed.getCurrentPageShapes().filter(r => readPriceNode(r) || r.meta.itemPriceLayout)
  const bounds = shapes.flatMap(r => ed.getShapePageBounds(r.id) ?? [])
  if (bounds.length) ed.zoomToBounds(Box.Common(bounds), { inset: 136, targetZoom: 1, animation: { duration: 200 } })
}
/** Long names and price variants grow their native shape instead of spilling over the next row. */
export function growPriceCard(ed: Editor, id: TLShapeId, height: number) {
  const card = ed.getShape<TLGeoShape>(id)
  if (!card || card.type !== 'geo' || !readPriceNode(card) || !Number.isFinite(height) || height <= card.props.h + 1) return
  const cards = ed.getCurrentPageShapes().filter((s): s is TLGeoShape => s.type === 'geo' && !!readPriceNode(s))
  const lower = cards.filter(s => s.y >= card.y + card.props.h - 1)
  const shift = Math.max(0, card.y + height + 20 - Math.min(...lower.map(s => s.y)))
  ed.run(() => ed.updateShapes([{ id, type: 'geo', props: { h: Math.ceil(height) } }, ...lower.map(s => ({ id: s.id, type: 'geo' as const, y: s.y + shift }))]), { history: 'ignore' })
}
