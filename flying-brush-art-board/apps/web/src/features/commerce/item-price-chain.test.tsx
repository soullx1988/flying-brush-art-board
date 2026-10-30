import { describe, expect, it, vi } from 'vitest'
import { createBoardStore, loadSnapshotIntoStore } from '@infinite-board/tldraw-adapter'
import type { TLGeoShape, TLPageId } from 'tldraw'
import type { CommerceDataset, CommerceProduct } from './commerce-data'
import { growPriceCard, openPriceChain, PRICE_CHAIN_PAGE, priceChainRecords, priceLink, priceNumber, priceProducts, readPriceSelection, rechargeBasis, selectedQuantity, type PriceSelection } from './item-price-chain'

const reward = (id = 1, n = 20) => ({ id, n, name: id === 1 ? '测试券' : '钻石' })
const product: CommerceProduct = { key: 'daily', sku: '1', title: '日礼包', channel: '日礼包', kind: 'diamond', price: '480 钻石', rewards: [reward()], limit: '2次 / 日', note: '', source: 's', status: 'defined', needs: ['hero'] }
const data: CommerceDataset = { created: 'test', scope: '', needs: [{ id: 'hero', name: '英雄', question: '', why: '', principle: '' }], sources: { s: { name: 'test', path: 'test', sha256: '' } }, products: [product,
  { ...product, key: 'cash', channel: '首充', kind: 'cash', price: '¥6' },
  ...[6, 30, 68].map(yuan => ({ ...product, key: `recharge${yuan}`, channel: '钻石充值', kind: 'cash' as const, price: `¥${yuan}`, rewards: [reward(300003, yuan * 10)], extraRewards: [reward(300003, yuan * 10)] })),
  { ...product, key: 'hidden', status: 'missing' }, { ...product, key: 'free', kind: 'free', price: '免费' },
] }
const selection: PriceSelection = { itemId: 1, kind: 'paid', channel: 'all', offset: 0 }

describe('item → merchandise → price chain', () => {
  it('distinguishes actual cash tiers, diamond face value and a covering recharge tier; excludes bonus diamonds', () => {
    expect(rechargeBasis(data).rate).toBe(10)
    const link = priceLink(data, product)
    expect(link.cash).toBeUndefined()
    expect(link.diamonds[0]).toMatchObject({ amount: 480, yuan: 48, coveringTier: { yuan: 68, diamonds: 680 } })
    const cash = priceLink(data, data.products[1]!)
    expect(cash.cash).toBe(6); expect(cash.diamonds).toEqual([])
    expect(priceNumber('起价 200 钻石，每购5次加320', 'diamond')).toBeUndefined()
    expect(priceNumber('现金价格待核验', 'cash')).toBeUndefined()
  })
  it('does not invent a rate or tier from bundles or inconsistent recharge prices', () => {
    const none = { ...data, products: [product] }
    expect(priceLink(none, product).diamonds[0]?.yuan).toBeUndefined()
    const changed = { ...data, products: data.products.map(p => p.key === 'recharge6' ? { ...p, rewards: [reward(300003, 120)] } : p) }
    expect(rechargeBasis(changed).rate).toBeUndefined()
    expect(priceLink(data, { ...product, price: '10000 钻石' }).diamonds[0]?.coveringTier).toBeUndefined()
  })
  it('keeps historical hotfix price variants separate and resolves complete observed quantities', () => {
    const observed = { ...data, evidence: { ledger: { giftScope: { servers: [1] }, payments: [], purchases: [{ key: product.key, giftId: 1, server: 1, date: '2026-10-20', prices: [150, 350], rewards: ['测试券x8'], orders: 2, diamonds: 500, buyers: 1 }] } } } as unknown as CommerceDataset
    expect(priceLink(observed, product).diamonds.map(p => [p.amount, p.yuan])).toEqual([[150, 15], [350, 35]])
    expect(selectedQuantity(observed, product, 1).regular).toBe(8)
    expect(priceProducts(observed, selection)).toHaveLength(2)
  })
  it('links extra rewards without combining recurring and immediate grants', () => {
    const month = { ...product, key: 'month', channel: '月卡', rewards: [reward(1, 2)], extraRewards: [reward(1, 10)] }
    expect(selectedQuantity(data, month, 1)).toEqual({ regular: 2, extra: 10 })
    expect(priceProducts({ ...data, products: [{ ...month, rewards: [] }] }, selection)).toHaveLength(1)
  })
  it('filters by payment and entry, excludes missing definitions, and keeps free items out of paid tiers', () => {
    expect(priceProducts(data, selection).map(p => p.key)).toEqual(['daily', 'cash'])
    expect(priceProducts(data, { ...selection, kind: 'cash' }).map(p => p.key)).toEqual(['cash'])
    expect(priceProducts(data, { ...selection, channel: '日礼包', kind: 'other' }).map(p => p.key)).toEqual(['free'])
    expect(priceProducts(data, { ...selection, itemId: 999 })).toEqual([])
  })
  it('includes every acquisition route by default and can select a concrete exchange shop without changing its commerce channel', () => {
    const exchange = { ...product, key: 'exchange:6:603', channel: '资源兑换商店', kind: 'resource' as const, price: '1000 星辰', placement: { name: '星辰商店', path: '商店集合 → 星辰商店', source: 'client' } }
    const sources = { ...data, products: [...data.products, exchange, { ...exchange, key: 'exchange:5:502', placement: { ...exchange.placement, name: '星火秘宝商店' }, price: '6 永恒琥珀' }] }
    const s = readPriceSelection({ meta: { itemPriceSelection: { itemId: 1 } } })!
    expect(s.kind).toBe('all')
    expect(new Set(priceProducts(sources, s).map(p => p.key))).toEqual(new Set(['daily', 'cash', 'free', 'exchange:6:603', 'exchange:5:502']))
    expect(priceProducts(sources, { ...s, channel: '星辰商店' }).map(p => p.key)).toEqual(['exchange:6:603'])
    expect(priceProducts(sources, { ...s, channel: '资源兑换商店' })).toHaveLength(2)
    expect(priceProducts(sources, { ...s, kind: 'resource' })).toHaveLength(2)
    expect(priceLink(sources, exchange)).toMatchObject({ cash: undefined, diamonds: [] })
    expect(readPriceSelection({ meta: { itemPriceSelection: { ...s, kind: 'paid' } } })?.kind).toBe('paid')
  })
  it('stores only identities and bindings, with all visible cards separated', () => {
    const records = priceChainRecords(data, selection), cards = records.filter(r => r.type === 'geo') as unknown as TLGeoShape[]
    expect(cards).toHaveLength(5)
    expect(JSON.stringify(records)).not.toContain('480 钻石')
    expect(records.filter(r => r.typeName === 'binding')).toHaveLength(8)
    for (const a of cards) for (const b of cards) if (a !== b) expect(a.x < b.x + b.props.w && a.x + a.props.w > b.x && a.y < b.y + b.props.h && a.y + a.props.h > b.y).toBe(false)
  })
  it('refreshes without moving hand-arranged cards and only removes owned stale nodes', () => {
    const store = createBoardStore(), initial = store.getStoreSnapshot()
    loadSnapshotIntoStore(store, initial)
    const ed = { store, options: { maxPages: 100 }, getPages: () => store.query.records('page').get(), markHistoryStoppingPoint: vi.fn(), run: (f: () => void) => f(),
      createPage: (p: Record<string, unknown>) => store.put([{ typeName: 'page', ...p }] as never), updatePage: (p: { id: string }) => store.put([{ ...store.get(p.id as TLPageId), ...p }] as never),
      deleteShapes: (ids: string[]) => { const bindings = store.query.records('binding').get().filter(b => ids.includes(b.fromId) || ids.includes((b as { toId?: string }).toId ?? '')).map(b => b.id); store.remove([...bindings, ...ids] as never) },
      updateShapes: (rs: { id: string; props?: unknown }[]) => store.put(rs.map(r => { const old = store.get(r.id as never) as unknown as TLGeoShape; return { ...old, ...r, props: { ...old.props, ...r.props as object } } }) as never), setCurrentPage: vi.fn(), selectNone: vi.fn(), zoomToBounds: vi.fn(), getShape: (id: TLGeoShape['id']) => store.get(id), getCurrentPageShapes: () => store.query.records('shape').get().filter(s => s.parentId === PRICE_CHAIN_PAGE), getShapePageBounds: () => undefined,
    }
    openPriceChain(ed as never, data, selection)
    const card = store.get('shape:iv-price-1-product-daily' as TLGeoShape['id']) as TLGeoShape
    store.put([{ ...card, x: 333 }])
    openPriceChain(ed as never, data, selection)
    expect((store.get(card.id) as TLGeoShape).x).toBe(333)
    growPriceCard(ed as never, card.id, 330)
    expect((store.get('shape:iv-price-1-product-cash' as TLGeoShape['id']) as TLGeoShape).y).toBe(350)
    expect((store.get('shape:iv-price-1-price-cash' as TLGeoShape['id']) as TLGeoShape).y).toBe(350)
    const note = { ...card, id: 'shape:handwritten' as TLGeoShape['id'], meta: {}, x: -400 }
    store.put([note])
    openPriceChain(ed as never, data, { ...selection, kind: 'cash', offset: 99 })
    expect(store.get(card.id)).toBeUndefined(); expect(store.get(note.id)).toEqual(note)
    expect(store.get(PRICE_CHAIN_PAGE)?.meta.itemPriceSelection).toMatchObject({ offset: 0, kind: 'cash' })
    expect(store.query.records('page').get().filter(p => p.id === PRICE_CHAIN_PAGE)).toHaveLength(1)
  })
})
