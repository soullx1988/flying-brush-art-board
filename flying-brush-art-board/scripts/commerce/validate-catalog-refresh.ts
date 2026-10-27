import fs from 'node:fs'
import assert from 'node:assert/strict'
import { commerceEvidenceBundleSchema, mergeCommerceEvidence, validateEvidenceForDataset } from '../../apps/web/src/features/commerce/commerce-evidence'
import { commerceDatasetSchema } from '../../apps/web/src/features/commerce/commerce-data'
import { applyCatalogUpdate } from '../../apps/web/src/features/commerce/commerce-catalog'
import { productFacts } from '../../apps/web/src/features/commerce/commerce-facts'

const [datasetPath,bundlePath,outputPath,mode]=process.argv.slice(2)
if (!datasetPath || !bundlePath || !outputPath) throw new Error('Usage: validate-catalog-refresh.ts before.json bundle.json audit.json')
const before=commerceDatasetSchema.parse(JSON.parse(fs.readFileSync(datasetPath,'utf8')))
const bundle=commerceEvidenceBundleSchema.parse(JSON.parse(fs.readFileSync(bundlePath,'utf8')))
const updated=applyCatalogUpdate(before,bundle.catalog)
const evidence=mergeCommerceEvidence(bundle.evidence,before.evidence)
validateEvidenceForDataset(evidence,updated)
const next=commerceDatasetSchema.parse({...updated,evidence})
assert.deepEqual(next.needs,before.needs)
if (mode==='--complete-missing-rewards') {
  const old=before.evidence!.ledger!, current=next.evidence!.ledger!
  for (const key of ['payments','orderScope','giftScope','unidentified','audits'] as const) assert.deepEqual(current[key],old[key])
  const oldKeys=new Set(old.purchases.map(r=>r.key))
  assert.deepEqual(current.purchases.filter(r=>oldKeys.has(r.key)),old.purchases)
  const added=current.purchases.filter(r=>!oldKeys.has(r.key))
  assert(added.length>0 && added.every(r=>r.rewards.length===1 && r.rewards[0]===''))
  assert.equal(added.reduce((n,r)=>n+r.orders,0),980)
  assert.equal(added.reduce((n,r)=>n+r.diamonds,0),336870)
} else assert.deepEqual(next.evidence?.ledger,before.evidence?.ledger)
assert.deepEqual(next.evidence?.revenue,before.evidence?.revenue)
assert.deepEqual(next.evidence?.archives,before.evidence?.archives)
const facts=next.products.map(p=>({key:p.key,title:p.title,configured:p.rewards,...productFacts(next,p)}))
const audit={products:next.products.length,withRecords:facts.filter(f=>f.hasRecords).length,differences:facts.filter(f=>f.difference),incomplete:facts.filter(f=>f.incomplete||f.varied)}
fs.writeFileSync(outputPath,JSON.stringify(audit,null,2))
console.log(JSON.stringify({products:audit.products,withRecords:audit.withRecords,differences:audit.differences.map(p=>({key:p.key,rewards:p.rewards,configured:p.configured,orders:p.orders})),incomplete:audit.incomplete.map(p=>p.key)}))
