import { z } from 'zod'

export const rewardSchema = z.object({ id: z.number(), name: z.string(), n: z.number() })
export const productSchema = z.object({
  key: z.string(), sku: z.string(), title: z.string(), channel: z.string(),
  kind: z.enum(['cash', 'diamond', 'ad', 'free', 'mixed', 'resource', 'unknown']),
  price: z.string(), rid: z.number().nullable().optional(), rewards: z.array(rewardSchema),
  extraRewards: z.array(rewardSchema).optional(), limit: z.string(), note: z.string(),
  source: z.string(), row: z.number().optional(),
  placement: z.object({ name: z.string().min(1), path: z.string().min(1), source: z.string().min(1) }).optional(),
  board: z.object({ id: z.string(), title: z.string() }).nullable().optional(),
  status: z.enum(['defined', 'missing', 'unmapped']), needs: z.array(z.string()).min(1),
})
// Keep broad commerce channels stable; the concrete in-game entrance is source metadata.
export const productPlacement = (p: z.infer<typeof productSchema>) => p.placement?.name ?? p.channel
export const catalogSourceSchema = z.object({ name: z.string(), path: z.string(), sha256: z.string(), checkedAt: z.string().optional(), revision: z.string().optional(), origin: z.string().optional() })
export const catalogUpdateSchema = z.object({
  baseSources: z.record(z.string(), z.string()), baseProducts: z.array(productSchema),
  created: z.string(), scope: z.string(), products: z.array(productSchema).max(10000),
  sources: z.record(z.string(), catalogSourceSchema),
})

const canonical = (v: unknown): string => JSON.stringify(v, (_key, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x)

/** Refresh source definitions, while protecting concurrent edits and design ownership. */
export function applyCatalogUpdate<T extends { products: z.infer<typeof productSchema>[]; sources: Record<string, z.infer<typeof catalogSourceSchema>>; needs: { id: string }[] }>(data: T, update?: z.infer<typeof catalogUpdateSchema>): T {
  if (!update) return data
  if (canonical(Object.fromEntries(Object.entries(data.sources).map(([k,v])=>[k,v.sha256]))) !== canonical(update.baseSources) || canonical(data.products) !== canonical(update.baseProducts)) throw new Error('商品或来源已变化，请重新核对后生成更新包。')
  if (new Set(update.products.map(p=>p.key)).size !== update.products.length || update.products.some(p=>!update.sources[p.source] || p.needs.some(n=>!data.needs.some(x=>x.id===n)))) throw new Error('新商品身份、来源或需求对应无效。')
  for (const p of data.products) {
    const next = update.products.find(n=>n.key===p.key)
    if (!next || p.rid !== next.rid || p.sku !== next.sku || canonical(p.needs) !== canonical(next.needs) || canonical(p.board) !== canonical(next.board)) throw new Error(`商品身份或设计关联发生变化，需单独核对：${p.key}`)
  }
  return { ...data, created:update.created, scope:update.scope, products:update.products, sources:update.sources }
}
