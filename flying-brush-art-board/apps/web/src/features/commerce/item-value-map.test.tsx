import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createBoardStore, loadSnapshotIntoStore } from '@infinite-board/tldraw-adapter'
import { type TLGeoShape } from 'tldraw'
import { ItemValueCanvas, ItemPriceChainShape } from './ItemValueCanvas'
import { createItemValueSnapshot, focusValueItem, itemPriceLabel, itemProducts, itemValueDatasetSchema, itemValueRecords, itemValueGroups, itemValueVisibility, keepApprovedPrices, readItemValueGroup, toggleItemValueGroup, PENDING_PAGE, readItemValueMap, readItemValueNode, updateItemValueData, valueBand, valuePages, VALUE_PAGE, type ItemValueDataset } from './item-value-map'
import type { CommerceDataset } from './commerce-data'

const data: ItemValueDataset = { version: 1, updated: '2026-10-28', sourceBoardId: 'source-board', priceUnit: '钻石', scope: '配置快照', sources: [],
  stages: [{ id: 'first', label: '第1关', order: 1, kind: 'progress' }, { id: 'unknown', label: '投放待核验', order: 9, kind: 'unknown' }],
  items: [
    { id: 1, name: '测试券', category: '券', description: '用于招募', basePrice: 30, priceSource: '数值表!B2', priceNote: '', stageId: 'first', firstPlacement: '第1关奖励', placementNote: '当前配置中已核到的最早来源', placementSources: ['main.json#1'] },
    { id: 2, name: '未定价资源', category: '材料', description: '', basePrice: null, priceSource: '', priceNote: '', stageId: 'unknown', firstPlacement: '待核验', placementNote: '', placementSources: [] },
    { id: 3, name: '零定价资源', category: '材料', description: '', basePrice: 0, priceSource: '数值表!B4', priceNote: '', stageId: 'unknown', firstPlacement: '待核验', placementNote: '', placementSources: [] },
  ] }
const catalog: CommerceDataset = { created: '2026-10-28', scope: '', sources: { s: { name: 'test', path: 'test', sha256: 'test' } }, needs: [{ id: 'n', name: '培养', question: '', why: '', principle: '' }], products: [
  { key: 'p', sku: '1', title: '关联礼包', channel: '日礼包', kind: 'diamond', price: '999 钻石', rewards: [{ id: 1, name: '测试券', n: 8 }], limit: '', note: '', source: 's', status: 'defined', needs: ['n'] },
  { key: 'hidden', sku: '2', title: '未生效礼包', channel: '触发礼包缺项', kind: 'unknown', price: '', rewards: [{ id: 1, name: '测试券', n: 9 }], limit: '', note: '', source: 's', status: 'missing', needs: ['n'] },
] }
afterEach(cleanup)
describe('item type and price map', () => {
  it('groups matching families and prices across time stages; preserves members through expansion', () => {
    const items = Array.from({ length: 6 }, (_, n) => ({ ...data.items[0]!, id: 20 + n, name: `武器碎片${n}`, family: '武器碎片', quality: 4 }))
    const mixed = { ...data, items: [...items, { ...items[0]!, id: 31, family: '武器' }, { ...items[0]!, id: 32, quality: 5 }, { ...items[0]!, id: 33, basePrice: 40 }, { ...items[0]!, id: 34, stageId: 'unknown' }] }
    expect(itemValueGroups(mixed)).toHaveLength(1)
    expect(itemValueGroups(mixed)[0]?.items).toHaveLength(7)
    const store = createBoardStore(); loadSnapshotIntoStore(store, createItemValueSnapshot(mixed))
    const group = store.query.records('shape').get().find(s => readItemValueGroup(s))! as TLGeoShape
    const member = store.get('shape:item-value-20' as TLGeoShape['id'])! as TLGeoShape
    const editor = { store, getShape: (id: TLGeoShape['id']) => store.get(id), markHistoryStoppingPoint: vi.fn(), run: (fn: () => void) => fn() }
    expect(itemValueVisibility(member, editor as never)).toBe('hidden')
    store.put([{ ...group, x: group.x + 37 }])
    toggleItemValueGroup(editor as never, group.id)
    expect(readItemValueGroup(store.get(group.id))?.expanded).toBe(true)
    expect((store.get(member.id) as TLGeoShape).x).toBe((store.get(group.id) as TLGeoShape).x)
    expect(itemValueVisibility(store.get(member.id) as TLGeoShape, editor as never)).toBe('inherit')
    const visible = store.query.records('shape').get().filter(s => s.type === 'geo' && (readItemValueNode(s) || readItemValueGroup(s)) && itemValueVisibility(s, editor as never) !== 'hidden') as TLGeoShape[]
    for (let a = 0; a < visible.length; a++) for (let b = a + 1; b < visible.length; b++) {
      const x = visible[a]!, y = visible[b]!
      expect(x.x < y.x + y.props.w && x.x + x.props.w > y.x && x.y < y.y + y.props.h && x.y + x.props.h > y.y).toBe(false)
    }
    toggleItemValueGroup(editor as never, group.id)
    expect((store.get(group.id) as TLGeoShape).x).toBe(group.x + 37)
    expect(itemValueVisibility(store.get(member.id) as TLGeoShape, editor as never)).toBe('hidden')
    expect(store.query.records('shape').get().filter(s => readItemValueNode(s))).toHaveLength(mixed.items.length)
  })
  it('retains an approved price on refresh and explicitly reports a conflicting new source price', () => {
    const confirmed = { ...data, items: [{ ...data.items[1]!, basePrice: 40, priceSource: '用户确认', approvedPrice: { value: 40, source: '用户确认' } }] }
    const missing = { ...data, items: [data.items[1]!] }
    expect(keepApprovedPrices(confirmed, missing).items[0]?.basePrice).toBe(40)
    const conflict = keepApprovedPrices(confirmed, { ...missing, items: [{ ...missing.items[0]!, basePrice: 99, priceSource: '源表新值' }] }).items[0]!
    expect(conflict.basePrice).toBe(40)
    expect(conflict.priceNote).toContain('新资料为 99 钻')
    expect(itemValueDatasetSchema.safeParse({ ...confirmed, items: [{ ...confirmed.items[0], basePrice: 20 }] }).success).toBe(false)
  })
  it('retires legacy estimates and displays only the direct base value', () => {
    const item = { ...data.items[0]!, basePrice: 30, priceEstimate: { min: 29, max: 31 } }
    expect(itemPriceLabel(data, item)).toBe('基础价待核验')
    const migrated = itemValueDatasetSchema.parse({ ...data, items: [item] }).items[0]!
    expect(migrated.basePrice).toBeNull()
    expect(migrated.priceEstimate).toBeUndefined()
    expect(itemPriceLabel(data, data.items[0]!)).toBe('30 钻石')
    expect(itemValueDatasetSchema.safeParse({ ...data, items: [{ ...item, basePrice: null }] }).success).toBe(false)
    expect(itemValueDatasetSchema.safeParse({ ...data, items: [{ ...item, priceEstimate: { min: 35, max: 31 } }] }).success).toBe(false)
    expect(itemValueDatasetSchema.safeParse({ ...data, items: [{ ...item, basePrice: 40 }] }).success).toBe(false)
  })
  it('keeps the independent board separate from merchandise definitions and discounts', () => {
    const snapshot = createItemValueSnapshot(data)
    const doc = Object.values(snapshot.store).find(r => r.typeName === 'document')!
    expect(readItemValueMap(doc.meta)).toEqual(data)
    expect(JSON.stringify(snapshot)).not.toContain('commerceOverview')
    expect(JSON.stringify(snapshot)).not.toContain('commerceDesignMap')
    const items = Object.values(snapshot.store).filter(r => r.typeName === 'shape' && readItemValueNode(r)) as TLGeoShape[]
    expect(items).toHaveLength(3)
    expect(items.find(s => readItemValueNode(s)?.itemId === 2)?.parentId).toBe(PENDING_PAGE)
    expect(items.find(s => readItemValueNode(s)?.itemId === 3)?.parentId).toBe(VALUE_PAGE)
    expect(items.every(s => !s.isLocked)).toBe(true)
  })
  it('keeps missing values distinct from zero and rejects prices without provenance', () => {
    expect(itemValueDatasetSchema.safeParse({ ...data, items: [{ ...data.items[0], priceSource: '' }] }).success).toBe(false)
    expect(itemValueDatasetSchema.safeParse({ ...data, items: [{ ...data.items[0], stageId: 'unlisted' }] }).success).toBe(false)
    expect(itemValueDatasetSchema.safeParse({ ...data, items: [data.items[0], data.items[0]] }).success).toBe(false)
    expect([0, 0.99, 1, 9.99, 10, 100, 1000, 10000].map(valueBand)).toEqual([5, 5, 4, 4, 3, 2, 1, 0])
  })
  it('keeps review references out of prices and renders questions on the pending page', () => {
    const reviewGroups = [{ id: 'missing', kind: 'price' as const, title: '材料定价', itemIds: [2], question: '是否按参考价定价？', context: '参考价不代表已确认基础价', sources: ['数值表!D9'] }]
    const parsed = itemValueDatasetSchema.parse({ ...data, reviewGroups })
    expect(parsed.items.find(i => i.id === 2)?.basePrice).toBeNull()
    const records = itemValueRecords(parsed)
    expect(records.find(r => r.id === 'shape:iv-review-body-missing')?.parentId).toBe(PENDING_PAGE)
    expect(itemValueDatasetSchema.safeParse({ ...data, reviewGroups: [{ ...reviewGroups[0], itemIds: [999] }] }).success).toBe(false)
  })
  it('resolves pages and items after project import rewrites record identities', () => {
    const snapshot = createItemValueSnapshot(data)
    const records = Object.values(snapshot.store).map(r => ({ ...r,
      id: r.typeName === 'document' ? r.id : `${r.typeName}:imported-${r.id.split(':').slice(1).join('-')}`,
      ...(r.typeName === 'shape' ? { parentId: `page:imported-${r.parentId.split(':').slice(1).join('-')}` } : {}),
    }))
    const store = createBoardStore()
    loadSnapshotIntoStore(store, { ...snapshot, store: Object.fromEntries(records.map(r => [r.id, r])) } as typeof snapshot)
    expect(valuePages(store)).toEqual({ value: 'page:imported-item-value-map', pending: 'page:imported-item-value-pending' })
    const editor = { store, setCurrentPage: vi.fn(), select: vi.fn(), getShapePageBounds: () => undefined }
    expect(focusValueItem(editor as never, 2)).toBe(true)
    expect(editor.setCurrentPage).toHaveBeenCalledWith('page:imported-item-value-pending')
    expect(editor.select).toHaveBeenCalledWith('shape:imported-item-value-2')
    const updater = { ...editor, markHistoryStoppingPoint: vi.fn(), run: (fn: () => void) => fn() }
    updateItemValueData(store, { ...data, items: data.items.map(i => i.id === 2 ? { ...i, basePrice: 5, priceSource: '数值表!B3' } : i) }, updater as never)
    const repriced = store.query.records('shape').get().find(s => readItemValueNode(s)?.itemId === 2)!
    expect(repriced.id).toBe('shape:imported-item-value-2')
    expect(repriced.parentId).toBe('page:imported-item-value-map')
    expect(() => updateItemValueData(store, { ...data, sourceBoardId: 'another-board' }, updater as never)).toThrow('资料不属于当前道具总览')
  })
  it('never overlaps nodes even when one type/price cell is crowded', () => {
    const crowded = { ...data, items: Array.from({ length: 121 }, (_, n) => ({ ...data.items[0]!, id: n + 10 })) }
    const nodes = itemValueRecords(crowded).filter(r => readItemValueNode(r as { meta: unknown })) as unknown as TLGeoShape[]
    for (let a = 0; a < nodes.length; a++) for (let b = a + 1; b < nodes.length; b++) {
      const x = nodes[a]!, y = nodes[b]!
      expect(x.x < y.x + y.props.w && x.x + x.props.w > y.x && x.y < y.y + y.props.h && x.y + x.props.h > y.y).toBe(false)
    }
  })
  it('includes immediate rewards and excludes unimplemented product references', () => {
    expect(itemProducts(catalog, 1).map(p => p.key)).toEqual(['p'])
    expect(itemProducts({ ...catalog, products: [{ ...catalog.products[0]!, rewards: [], extraRewards: [{ id: 1, name: '测试券', n: 1 }] }] }, 1)).toHaveLength(1)
  })
  it('keeps each type in one column and orders prices across and within descending bands', () => {
    const items = [30, 300, 12, 3000, 100, 0, 0.1, 40].map((price, n) => ({ ...data.items[0]!, id: 10 + n,
      basePrice: price, category: n < 6 ? '武器与碎片' : '货币与积分', stageId: n % 2 ? 'unknown' : 'first' }))
    const records = itemValueRecords({ ...data, items })
    const nodes = records.filter(r => readItemValueNode(r as { meta: unknown })) as unknown as TLGeoShape[]
    const xValues: number[] = []
    for (const category of ['武器与碎片', '货币与积分']) {
      const subset = nodes.filter(s => items.find(i => i.id === readItemValueNode(s)?.itemId)!.category === category).sort((a,b) => a.y-b.y)
      expect(new Set(subset.map(s => s.x)).size).toBe(1)
      xValues.push(subset[0]!.x)
      const prices = subset.map(s => items.find(i => i.id === readItemValueNode(s)?.itemId)!.basePrice)
      expect(prices).toEqual([...prices].sort((a,b) => b-a))
    }
    expect(new Set(xValues).size).toBe(2)
    expect(records.some(r => String(r.id).startsWith('shape:iv-stage-'))).toBe(false)
    expect(records.filter(r => String(r.id).startsWith('shape:iv-band-')).length).toBeGreaterThan(1)
  })
  it('migrates old group identities and leaves source data and free notes intact', () => {
    const grouped = { ...data, items: [0,1].map(n => ({ ...data.items[0]!, id: 20+n, family: '武器碎片', quality: 4 })) }
    const store = createBoardStore(); loadSnapshotIntoStore(store, createItemValueSnapshot(grouped))
    const group = store.query.records('shape').get().find(s => readItemValueGroup(s))! as TLGeoShape
    const first = store.query.records('shape').get().find(s => readItemValueNode(s))! as TLGeoShape
    store.put([{ ...group, meta: { ...group.meta, itemValueGroup: { ...readItemValueGroup(group)!, key: '武器碎片-4-30-first' } } },
      { ...first, id: 'shape:free-note' as TLGeoShape['id'], meta: { note: 'preserve' }, x: -300 }])
    const next = { ...grouped, items: grouped.items.map(i => ({ ...i, category: '武器与碎片' })) }
    const editor = { store, markHistoryStoppingPoint: vi.fn(), run: (fn: () => void) => fn() }
    updateItemValueData(store, next, editor as never)
    const updatedGroup = store.query.records('shape').get().find(s => readItemValueGroup(s))!
    expect(updatedGroup.id).toBe(group.id)
    expect(store.query.records('shape').get().filter(s => readItemValueNode(s)).every(s => s.meta.itemValueGroupId === group.id)).toBe(true)
    expect(readItemValueMap(store.query.records('document').get()[0]!.meta)).toEqual(next)
    expect(store.get('shape:free-note' as TLGeoShape['id'])?.meta).toEqual({ note: 'preserve' })
  })
  it('opens item evidence while retaining the table base price when merchandise changes', async () => {
    const store = createBoardStore(); loadSnapshotIntoStore(store, createItemValueSnapshot(data))
    const loadSource = vi.fn(async () => ({ snapshot: { store: { doc: { typeName: 'document', meta: { commerceOverview: { version: 1, dataset: catalog } } } } }, revision: 1 }))
    const shape = store.get('shape:item-value-1' as TLGeoShape['id']) as TLGeoShape
    render(<ItemValueCanvas store={store} editorRef={{ current: undefined }} loadSource={loadSource} canEdit={() => false}><ItemPriceChainShape shape={{ ...shape, meta: { itemPriceNode: { kind: 'item', itemId: 1 } } }} /></ItemValueCanvas>)
    await waitFor(() => expect(loadSource).toHaveBeenCalledWith('source-board'))
    expect(screen.getByText('30 钻石')).toBeTruthy()
    expect(screen.queryByText('999 钻石')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '基础价与投放依据 ↗' }))
    await waitFor(() => expect(screen.getByText('数值表!B2')).toBeTruthy())
    expect(screen.getAllByText('第1关奖励').length).toBeGreaterThan(0)
    expect(screen.queryByText('未生效礼包')).toBeNull()
  })
})
