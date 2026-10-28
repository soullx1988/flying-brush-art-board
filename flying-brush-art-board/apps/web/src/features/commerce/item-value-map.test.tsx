import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createBoardStore, loadSnapshotIntoStore } from '@infinite-board/tldraw-adapter'
import { type TLGeoShape } from 'tldraw'
import { ItemValueCanvas, ItemValueShape } from './ItemValueCanvas'
import { createItemValueSnapshot, focusValueItem, itemProducts, itemValueDatasetSchema, itemValueRecords, PENDING_PAGE, readItemValueMap, readItemValueNode, updateItemValueData, valueBand, valuePages, VALUE_PAGE, type ItemValueDataset } from './item-value-map'
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
describe('item value and first placement map', () => {
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
  it('never overlaps nodes even when one time/price cell is crowded', () => {
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
  it('opens item evidence while retaining the table base price when merchandise changes', async () => {
    const store = createBoardStore(); loadSnapshotIntoStore(store, createItemValueSnapshot(data))
    const loadSource = vi.fn(async () => ({ snapshot: { store: { doc: { typeName: 'document', meta: { commerceOverview: { version: 1, dataset: catalog } } } } }, revision: 1 }))
    const shape = store.get('shape:item-value-1' as TLGeoShape['id']) as TLGeoShape
    render(<ItemValueCanvas store={store} editorRef={{ current: undefined }} loadSource={loadSource} canEdit={() => false}><ItemValueShape shape={shape} /></ItemValueCanvas>)
    await waitFor(() => expect(loadSource).toHaveBeenCalledWith('source-board'))
    expect(screen.getByText('30 钻石')).toBeTruthy()
    expect(screen.queryByText('999 钻石')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '展开测试券' }))
    await waitFor(() => expect(screen.getByText('数值表!B2')).toBeTruthy())
    expect(screen.getByText('第1关奖励')).toBeTruthy()
    expect(screen.queryByText('未生效礼包')).toBeNull()
  })
})
