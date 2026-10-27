import type { CommerceDataset, CommerceProduct } from './commerce-data'
import { ledgerRows } from './commerce-ledger'

type Reward = CommerceProduct['rewards'][number]
const signature = (rewards: Reward[]) => JSON.stringify([...rewards].sort((a,b)=>a.id-b.id).map(r=>[r.id,r.n]))

/** GM concatenates reward labels without separators. Accept only unambiguous known names. */
export function parseRecordedRewards(text: string, configured: Reward[]): Reward[] | undefined {
  const names = [...new Map(configured.map(r=>[r.name,r])).values()].sort((a,b)=>b.name.length-a.name.length)
  if (new Set(configured.map(r=>r.name)).size !== new Set(configured.map(r=>r.id)).size) return undefined
  let rest = text.trim()
  const result = new Map<number,Reward>()
  while (rest) {
    const candidates = names.flatMap(r=> {
      if (!rest.startsWith(r.name)) return []
      const match = /^[x×]\s*(\d+)(?=\D|$)/.exec(rest.slice(r.name.length))
      return match ? [{r,match}] : []
    })
    if (candidates.length !== 1) return undefined
    const {r,match} = candidates[0]!, n = Number(match[1])
    if (!Number.isSafeInteger(n) || n < 0) return undefined
    result.set(r.id,{...r,n:(result.get(r.id)?.n ?? 0)+n})
    rest = rest.slice(r.name.length+match[0].length).replace(/^[\s,，;；、|]+/,'')
  }
  return [...result.values()]
}

export function productFacts(data: CommerceDataset, product: CommerceProduct, group = 'all') {
  const logs = ledgerRows(data,product,group).purchases
  const claims=(data.evidence?.catalogReview?.audit?.claims ?? []).filter(r=>r.key===product.key && (group==='all' || data.evidence?.revenue?.servers.some(s=>s.id===r.server && s.group===group)))
  const records=[...logs,...claims]
  const raw = [...new Set(records.flatMap(r=>r.rewards))]
  const parsed = raw.map(r=>parseRecordedRewards(r,product.rewards))
  // A bundle/random reward absent from this log is not proof that it wasn't delivered.
  const complete = parsed.length > 0 && parsed.every(r=>r && r.length===product.rewards.length && product.rewards.every(p=>r.some(a=>a.id===p.id)))
  const variants = [...new Map(parsed.filter((r): r is Reward[]=>!!r).map(r=>[signature(r),r])).values()]
  const actual = complete && variants.length===1 ? variants[0] : undefined
  const prices = [...new Set(logs.flatMap(r=>r.prices))].sort((a,b)=>a-b)
  const price = prices.length ? `${prices.join(' / ')} 钻石` : product.price
  const dates = records.map(r=>r.date).sort()
  const difference = !!actual && signature(actual)!==signature(product.rewards) || prices.length>0 && (prices.length!==1 || price!==product.price)
  const configuredDifferences = actual ? product.rewards.filter(r=>actual.find(a=>a.id===r.id)?.n!==r.n) : []
  const incomplete = records.length>0 && !complete
  const varied = complete && variants.length>1
  return { rewards:actual ?? product.rewards, price, actual, prices, raw, difference, configuredDifferences, incomplete, varied,
    hasRecords:records.length>0, orders:records.reduce((n,r)=>n+r.orders,0), claimOnly:logs.length===0 && claims.length>0,
    from:dates[0], through:dates.at(-1), servers:[...new Set(records.map(r=>r.server))].sort((a,b)=>a-b),
  }
}
