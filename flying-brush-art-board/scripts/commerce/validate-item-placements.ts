import fs from 'node:fs'
import assert from 'node:assert/strict'
import { commerceDatasetSchema, isCatalogProduct } from '../../apps/web/src/features/commerce/commerce-data'
import { productPlacement } from '../../apps/web/src/features/commerce/commerce-catalog'
import { priceProducts } from '../../apps/web/src/features/commerce/item-price-chain'

const [dataPath, mapPath] = process.argv.slice(2)
if (!dataPath || !mapPath) throw new Error('Usage: validate-item-placements.ts dataset.json item-map.json')
const data = commerceDatasetSchema.parse(JSON.parse(fs.readFileSync(dataPath, 'utf8')))
const map = JSON.parse(fs.readFileSync(mapPath, 'utf8')) as { items: { id: number }[] }
let links = 0
for (const item of map.items) {
  const s = { itemId: item.id, kind: 'all' as const, channel: 'all', offset: 0 }
  const expected = data.products.filter(p => isCatalogProduct(p) && [...p.rewards, ...(p.extraRewards ?? [])].some(r => r.id === item.id))
  const actual = priceProducts(data, s)
  assert.deepEqual(new Set(actual.map(p => p.key)), new Set(expected.map(p => p.key)), `Missing item links: ${item.id}`)
  assert.equal(actual.length, new Set(actual.map(p => p.key)).size, `Duplicate links: ${item.id}`)
  for (const channel of new Set(expected.map(productPlacement))) {
    assert.deepEqual(new Set(priceProducts(data, { ...s, channel }).map(p => p.key)), new Set(expected.filter(p => productPlacement(p) === channel).map(p => p.key)), `Entrance filter: ${item.id}/${channel}`)
  }
  links += actual.length
}
console.log(JSON.stringify({ items: map.items.length, links, result: 'All item and entrance filters match source identities; regular and extra rewards included.' }))

// tldraw starts a scheduler on import; this read-only CLI has finished.
process.exit(0)
