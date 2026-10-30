import fs from 'node:fs'
import assert from 'node:assert/strict'
import { commerceDatasetSchema, isCatalogProduct } from '../../apps/web/src/features/commerce/commerce-data'
import { commerceEvidenceBundleSchema, mergeCommerceEvidence, validateEvidenceForDataset } from '../../apps/web/src/features/commerce/commerce-evidence'
import { itemValueDatasetSchema, itemValueRecords, itemValueGroups, keepApprovedPrices, readItemValueNode } from '../../apps/web/src/features/commerce/item-value-map'
import { priceProducts, rechargeBasis } from '../../apps/web/src/features/commerce/item-price-chain'
import { productFacts } from '../../apps/web/src/features/commerce/commerce-facts'

const [catalogPath, beforePath, nextPath, bundlePath, reportPath] = process.argv.slice(2)
if (!catalogPath || !beforePath || !nextPath || !bundlePath || !reportPath) throw new Error('Usage: validate-item-completeness.ts catalog before next icons-bundle report')
const read = (p: string) => JSON.parse(fs.readFileSync(p, 'utf8'))
const before = commerceDatasetSchema.parse(read(catalogPath)), bundle = commerceEvidenceBundleSchema.parse(read(bundlePath))
const evidence = mergeCommerceEvidence(bundle.evidence, before.evidence)
validateEvidenceForDataset(evidence, before)
const data = { ...before, evidence }
for (const key of ['history', 'revenue', 'ledger', 'archives', 'catalogReview'] as const) assert.deepEqual(evidence[key], before.evidence?.[key], `History changed: ${key}`)
const oldMap = itemValueDatasetSchema.parse(read(beforePath)), map = keepApprovedPrices(oldMap, itemValueDatasetSchema.parse(read(nextPath)))
assert.deepEqual(map.items.map(i => [i.id, i.basePrice]), oldMap.items.map(i => [i.id, i.basePrice]))
const records = itemValueRecords(map), rendered = records.flatMap(r => readItemValueNode(r as { meta: unknown })?.itemId ?? [])
assert.equal(new Set(rendered).size, map.items.length)
assert.equal(rendered.length, map.items.length)
const products = data.products.filter(isCatalogProduct), mapped = new Set(map.items.map(i => i.id))
for (const p of products) for (const r of [...p.rewards, ...(p.extraRewards ?? [])]) assert(mapped.has(r.id), `Unmapped reward: ${p.key}/${r.id}`)
let links = 0
for (const i of map.items) {
  const expected = products.filter(p => [...p.rewards, ...(p.extraRewards ?? [])].some(r => r.id === i.id))
  const actual = priceProducts(data, { itemId: i.id, kind: 'all', channel: 'all', offset: 0 })
  for (const p of expected) assert(actual.some(a => a.key === p.key), `Missing link: ${i.id}/${p.key}`)
  assert.equal(actual.length, new Set(actual.map(p => p.key)).size)
  links += actual.length
  for (const key of i.exchangeUses ?? []) assert(products.some(p => p.key === key), `Missing exchange: ${key}`)
}
const findings = products.map(p => ({ key: p.key, ...productFacts(data, p) }))
const result = { items: map.items.length, shapeItems: rendered.length, groups: itemValueGroups(map).length, products: products.length, links,
  sourceListsRestored: map.items.filter(i => i.placementSources.length > 12).map(i => ({ id: i.id, count: i.placementSources.length })),
  icons: map.items.filter(i => evidence.icons[i.id]).length, missingPrices: map.items.filter(i => i.basePrice === null).map(i => ({ id: i.id, name: i.name })),
  candidates: new Set(map.items.flatMap(i => i.contents?.map(c => c.id) ?? [])).size,
  priceDifferences: findings.filter(f => f.difference).map(f => f.key), incompleteRewards: findings.filter(f => f.incomplete || f.varied).map(f => f.key),
  rechargeBasis: rechargeBasis(data), historyPreserved: true }
fs.writeFileSync(reportPath, JSON.stringify(result, null, 2))
console.log(JSON.stringify(result))
process.exit(0)
