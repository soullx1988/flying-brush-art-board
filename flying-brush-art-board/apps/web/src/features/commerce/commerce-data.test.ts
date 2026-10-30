import { describe, expect, it } from 'vitest'
import { filterProducts, readCommerceDataset, relatedProducts, type CommerceDataset, type CommerceProduct } from './commerce-data'

const product = (key: string, kind: CommerceProduct['kind'], needs = ['recruit']): CommerceProduct => ({ key, sku: key, title: key, kind, needs, status: 'defined', channel: '日礼包', price: '待核验', rid: kind==='cash' ? 1 : null, rewards: [], limit: '每日', note: '', source: 'config' })
const data: CommerceDataset = { created: '2026-10-26', scope: 'test', needs: [{ id: 'recruit', name: '招募', question: '', why: '', principle: '' }, { id: 'unknown', name: '待归属', question: '', why: '', principle: '' }], sources: { config: { name: 'test', path: 'test', sha256: 'test' } }, products: [product('cash:1', 'cash'), product('diamond:1', 'diamond'), { ...product('recharge:1', 'unknown', ['unknown']), status: 'unmapped' }, product('missing:2', 'unknown', ['unknown'])] }

describe('commerce overview data', () => {
  it('reads only a versioned, complete dataset and rejects duplicate identities or broken references', () => {
    expect(readCommerceDataset({ commerceOverview: { version: 1, dataset: data } })?.products).toHaveLength(4)
    for (const dataset of [{ ...data, products: [...data.products, data.products[0]] }, { ...data, sources: {} }, { ...data, needs: [] }]) {
      expect(readCommerceDataset({ commerceOverview: { version: 1, dataset } })).toBeUndefined()
    }
    expect(readCommerceDataset({ commerceOverview: { version: 2, dataset: data } })).toBeUndefined()
    expect(readCommerceDataset({})).toBeUndefined()
  })
  it('keeps unmapped recharge tiers out of cash products and combines filters', () => {
    expect(filterProducts(data, 'all', 'cash', 'all', '').map(p => p.key)).toEqual(['cash:1'])
    expect(filterProducts(data, 'recruit', 'diamond', '日礼包', 'diamond:1').map(p => p.key)).toEqual(['diamond:1'])
    expect(filterProducts(data, 'unknown', 'cash', 'all', '')).toEqual([])
  })
  it('preserves and searches concrete shop names while keeping the original commerce channel', () => {
    const p = { ...product('exchange:6:603', 'resource'), channel: '资源兑换商店', placement: { name: '星辰商店', path: '商店集合 → 星辰商店', source: 'client' } }
    const next = readCommerceDataset({ commerceOverview: { version: 1, dataset: { ...data, products: [p] } } })!
    expect(filterProducts(next, 'all', 'all', 'all', '星辰商店')).toEqual([p])
    expect(filterProducts(next, 'all', 'resource', '资源兑换商店', '')).toEqual([p])
  })
  it('does not treat unclassified products or general currency as a common player need', () => {
    expect(relatedProducts(data, data.products[2]!)).toEqual([])
    const genericReward = { id: 300003, name: '钻石', n: 10 }
    const withCurrency = { ...data, products: data.products.map(p => ({ ...p, rewards: [genericReward] })) }
    expect(relatedProducts(withCurrency, withCurrency.products[2]!)).toEqual([])
    expect(relatedProducts(data, data.products[0]!).map(p => p.key)).toEqual(['diamond:1'])
  })
})
