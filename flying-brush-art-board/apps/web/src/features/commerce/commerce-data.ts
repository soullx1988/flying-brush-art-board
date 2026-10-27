import { z } from 'zod'
import { commerceEvidenceSchema } from './commerce-evidence'
import { productSchema, catalogSourceSchema } from './commerce-catalog'

export const commerceDatasetSchema = z.object({
  created: z.string(), scope: z.string(), products: z.array(productSchema).max(10000),
  needs: z.array(z.object({ id: z.string(), name: z.string(), question: z.string(), why: z.string(), principle: z.string() })).min(1),
  sources: z.record(z.string(), catalogSourceSchema),
  evidence: commerceEvidenceSchema.optional(),
}).superRefine((data, ctx) => {
  const ids = new Set(data.products.map(p => p.key)), needs = new Set(data.needs.map(n => n.id))
  if (ids.size !== data.products.length || needs.size !== data.needs.length) ctx.addIssue({ code: 'custom', message: 'Duplicate identity' })
  if (data.products.some(p => !data.sources[p.source] || p.needs.some(n => !needs.has(n)))) ctx.addIssue({ code: 'custom', message: 'Missing source or need' })
})
export type CommerceDataset = z.infer<typeof commerceDatasetSchema>
export type CommerceProduct = CommerceDataset['products'][number]
// Orphan references and unmapped recharge tiers are audit material, not merchandise.
export const isCatalogProduct = (product: CommerceProduct) => product.status === 'defined' && !(product.kind === 'cash' && !product.rid && product.rewards.length === 0)
export const paymentNames: Record<CommerceProduct['kind'], string> = { cash: '现金', diamond: '钻石', ad: '广告', free: '免费', mixed: '免费 / 广告', resource: '其他资源兑换', unknown: '方式或商品待核验' }

export function readCommerceDataset(meta: unknown): CommerceDataset | undefined {
  const result = z.object({ commerceOverview: z.object({ version: z.literal(1), dataset: commerceDatasetSchema }) }).safeParse(meta)
  return result.success ? result.data.commerceOverview.dataset : undefined
}
export function filterProducts(data: CommerceDataset, need: string, kind: string, channel: string, query: string) {
  const q = query.trim().toLocaleLowerCase()
  return data.products.filter(p => isCatalogProduct(p) && (need === 'all' || p.needs.includes(need)) && (kind === 'all' || p.kind === kind) && (channel === 'all' || p.channel === channel)
    && (!q || [p.key, p.sku, p.rid, p.title, p.channel, ...p.rewards.map(r => r.name)].join(' ').toLocaleLowerCase().includes(q)))
}
export function relatedProducts(data: CommerceDataset, product: CommerceProduct) {
  const comparable = data.products.filter(p => p.key !== product.key && isCatalogProduct(p))
  const sameReward = comparable.filter(p => p.rewards.some(a => product.rewards.some(b => b.id === a.id && ![300001, 300003].includes(b.id))))
  const sameNeed = comparable.filter(p => p.needs.some(n => n !== 'unknown' && product.needs.includes(n)))
  return [...new Map([...sameReward, ...sameNeed].map(p => [p.key, p])).values()]
}
