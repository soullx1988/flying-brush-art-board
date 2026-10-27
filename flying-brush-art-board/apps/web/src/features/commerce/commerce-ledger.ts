import { z } from 'zod'
import type { CommerceDataset, CommerceProduct } from './commerce-data'

const count = z.number().int().nonnegative()
const source = z.object({ path: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/) })
const scope = z.object({ label: z.string(), from: z.string(), through: z.string(), readAt: z.string(), roles: count, servers: z.array(z.number().int()), limitations: z.array(z.string()) })
const payment = z.object({ key: z.string(), rechargeId: z.number().int(), server: z.number().int(), cashOrders: count, cashYuan: count, cashBuyers: count, voucherOrders: count, voucherOrderYuan: count, voucherBuyers: count, unsuccessful: count })
const purchase = z.object({ key: z.string(), giftId: z.number().int(), server: z.number().int(), date: z.string(), orders: count, buyers: count, diamonds: count, prices: z.array(count), rewards: z.array(z.string()) })
export const commerceLedgerSchema = z.object({
  orderScope: scope, giftScope: scope, sources: z.array(source), backup: source,
  payments: z.array(payment), purchases: z.array(purchase),
  unidentified: z.object({ label: z.string(), rows: count, diamonds: count, dailyRecruitCandidates: count, limitations: z.array(z.string()) }),
  audits: z.record(z.string(), z.object({ label: z.string(), detail: z.string(), sources: z.array(z.string()) })),
  gaps: z.array(z.string()),
}).superRefine((v, ctx) => {
  const payments = new Set(v.payments.map(r => `${r.key}:${r.server}`)), purchases = new Set(v.purchases.map(r => `${r.key}:${r.server}:${r.date}`))
  if (payments.size !== v.payments.length || purchases.size !== v.purchases.length || v.payments.some(r => r.cashBuyers > r.cashOrders || r.voucherBuyers > r.voucherOrders || !v.orderScope.servers.includes(r.server)) || v.purchases.some(r => r.buyers > r.orders || !v.giftScope.servers.includes(r.server) || r.date < v.giftScope.from || r.date > v.giftScope.through)) ctx.addIssue({ code: 'custom', message: '商品流水重复或范围不一致' })
})
export type CommerceLedger = z.infer<typeof commerceLedgerSchema>

export function ledgerRows(data: CommerceDataset, product: CommerceProduct, group: string) {
  const ledger = data.evidence?.ledger
  const allowed = (id: number) => group === 'all' || data.evidence?.revenue?.servers.some(s => s.id === id && s.group === group)
  return { payments: ledger?.payments.filter(r => r.key === product.key && allowed(r.server)) ?? [], purchases: ledger?.purchases.filter(r => r.key === product.key && allowed(r.server)) ?? [], giftCovered: ledger?.giftScope.servers.some(allowed) ?? false }
}
export function hasLedgerHistory(data: CommerceDataset, product: CommerceProduct, group: string) {
  const r = ledgerRows(data, product, group)
  return r.payments.some(p => p.cashOrders + p.voucherOrders > 0) || r.purchases.length > 0 || (data.evidence?.catalogReview?.audit?.claims ?? []).some(r=>r.key===product.key && (group==='all' || data.evidence?.revenue?.servers.some(s=>s.id===r.server && s.group===group)))
}
