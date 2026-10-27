import { z } from 'zod'
import { testRevenueSchema } from './commerce-revenue'
import { commerceLedgerSchema } from './commerce-ledger'
import { archivedRevenueSchema } from './commerce-archive'
import { catalogUpdateSchema, rewardSchema } from './commerce-catalog'

const sha = z.string().regex(/^[a-f0-9]{64}$/)
const count = z.number().int().nonnegative()
const source = z.object({ path: z.string(), sha256: sha })
const media = source.extend({ name: z.string(), mime: z.enum(['image/png', 'image/jpeg', 'image/webp']), width: z.number().positive(), height: z.number().positive() })
const daily = z.object({ date: z.string(), server: z.number().int(), orders: count, buyers: count, yuan: z.number().nonnegative() })
const historyItem = z.object({
  rechargeId: z.number().int(), orders: count, buyers: count, yuan: z.number().nonnegative(),
  prices: z.array(z.number().nonnegative()), failedOrPending: count, voucherOrders: count,
  firstDate: z.string(), lastDate: z.string(), daily: z.array(daily),
}).superRefine((row, ctx) => {
  if (row.buyers > row.orders || row.daily.reduce((sum, d) => sum + d.orders, 0) !== row.orders || Math.abs(row.daily.reduce((sum, d) => sum + d.yuan, 0) - row.yuan) > 0.001) ctx.addIssue({ code: 'custom', message: '历史汇总与逐日明细不一致' })
})
export const commerceEvidenceSchema = z.object({
  updated: z.string(), sourceHashes: z.record(z.string(), z.string()),
  assets: z.record(sha, media),
  icons: z.record(z.string(), z.object({ asset: sha, x: z.number().nonnegative(), y: z.number().nonnegative(), w: z.number().positive(), h: z.number().positive(), rotated: z.boolean() })),
  placements: z.record(z.string(), z.object({ path: z.string(), evidence: z.string(), reference: sha.optional(), referenceLabel: z.string().optional() })),
  history: z.object({
    source, readAt: z.string(), population: z.string(), timeBasis: z.string(), versionNote: z.string(), limitations: z.array(z.string()),
    records: count, successCashOrders: count, successCashYuan: z.number().nonnegative(), failedOrPending: count, voucherOrders: count,
    byProduct: z.record(z.string(), historyItem), unresolved: z.array(z.object({ rechargeId: z.number().int(), reason: z.string(), orders: count })),
  }),
  revenue: testRevenueSchema.optional(),
  ledger: commerceLedgerSchema.optional(),
  archives: z.array(archivedRevenueSchema).optional(),
  catalogReview: z.object({ checkedAt:z.string(), notes:z.array(z.string()), source,
    draft:z.record(z.string(),z.object({ rewards:z.array(rewardSchema), price:z.string(), limit:z.string() })),
    audit:z.object({ source, coverage:z.array(z.object({label:z.string(),count,detail:z.string()})),
      findings:z.record(z.string(),z.object({label:z.string(),detail:z.string(),missing:z.array(z.string()),sources:z.array(z.string())})),
      checks:z.record(z.string(),z.object({price:z.string(),reward:z.string(),missing:z.array(z.string())})),
      gaps:z.array(z.string()),
      claims:z.array(z.object({key:z.string(),server:z.number().int(),date:z.string(),orders:count,rewards:z.array(z.string())})),
    }).optional(),
  }).optional(),
}).superRefine((data, ctx) => {
  if (Object.values(data.icons).some(icon => !data.assets[icon.asset]) || Object.values(data.placements).some(p => p.reference && !data.assets[p.reference])) ctx.addIssue({ code: 'custom', message: '缺少图片来源' })
  if (data.archives && new Set(data.archives.map(r=>r.id)).size !== data.archives.length) ctx.addIssue({ code:'custom', message:'历史测试批次重复' })
})
export type CommerceEvidence = z.infer<typeof commerceEvidenceSchema>
export const commerceEvidenceBundleSchema = z.object({
  format: z.literal('infinite-board-commerce-evidence'), version: z.literal(1),
  evidence: commerceEvidenceSchema, files: z.record(sha, z.string().max(20_000_000)),
  catalog: catalogUpdateSchema.optional(),
})
export type CommerceEvidenceBundle = z.infer<typeof commerceEvidenceBundleSchema>

export function mergeCommerceEvidence(incoming: CommerceEvidence, existing?: CommerceEvidence) {
  // An older image/order bundle has no test-period report; refreshing it must not erase that report.
  const revenue = incoming.revenue ?? existing?.revenue
  const ledger = incoming.ledger ?? existing?.ledger
  const catalogReview = incoming.catalogReview ?? existing?.catalogReview
  const archives = [...new Map([...(existing?.archives ?? []), ...(incoming.archives ?? [])].map(r=>[r.id,r])).values()]
  return { ...incoming, ...(revenue ? { revenue } : {}), ...(ledger ? { ledger } : {}), ...(archives.length ? { archives } : {}), ...(catalogReview ? {catalogReview} : {}) }
}

export function validateEvidenceForDataset(evidence: CommerceEvidence, data: { sources: Record<string, { sha256: string }>; products: Array<{ key: string; rid?: number | null | undefined }> }) {
  if (Object.keys(data.sources).length !== Object.keys(evidence.sourceHashes).length || Object.entries(data.sources).some(([key, value]) => evidence.sourceHashes[key] !== value.sha256)) throw new Error('来源配置已变化，请重新生成资料包。')
  for (const [key, history] of Object.entries(evidence.history.byProduct)) {
    const product = data.products.find(p => p.key === key)
    if (!product || product.rid !== history.rechargeId || data.products.filter(p => p.rid === history.rechargeId).length !== 1) throw new Error(`充值档位对应不唯一：${history.rechargeId}`)
  }
  for (const row of evidence.ledger?.payments ?? []) {
    if (data.products.find(p=>p.key===row.key)?.rid !== row.rechargeId || data.products.filter(p=>p.rid===row.rechargeId).length!==1) throw new Error(`支付明细商品对应不唯一：${row.rechargeId}`)
  }
  for (const row of evidence.ledger?.purchases ?? []) {
    if (row.key !== `gift:${row.giftId}` || !data.products.some(p=>p.key===row.key)) throw new Error(`礼包流水商品对应缺失：${row.giftId}`)
  }
  for (const key of [...Object.keys(evidence.catalogReview?.audit?.findings ?? {}), ...Object.keys(evidence.catalogReview?.audit?.checks ?? {})]) {
    if (!data.products.some(p=>p.key===key)) throw new Error(`核查记录商品对应缺失：${key}`)
  }
  const claims=evidence.catalogReview?.audit?.claims ?? []
  if (new Set(claims.map(r=>`${r.key}:${r.server}:${r.date}`)).size!==claims.length || claims.some(r=>!data.products.some(p=>p.key===r.key) || !evidence.ledger?.giftScope.servers.includes(r.server) || r.date<evidence.ledger.giftScope.from || r.date>evidence.ledger.giftScope.through)) throw new Error('领取核查记录重复或超出范围')
}
