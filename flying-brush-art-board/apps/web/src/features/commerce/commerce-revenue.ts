import { z } from 'zod'
import type { CommerceDataset, CommerceProduct } from './commerce-data'

const count = z.number().int().nonnegative()
const source = z.object({ path: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/) })
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
export const testRevenueSchema = z.object({
  id: z.string(), title: z.string(), from: date, through: date, readAt: z.string(),
  cashBasis: z.string(), productBasis: z.string(), coverage: z.string(), limitations: z.array(z.string()),
  dailyUrl: z.string().url(), productUrl: z.string().url(), backup: source, sources: z.array(source).min(1),
  servers: z.array(z.object({ id: count, name: z.string(), group: z.string(), cashBuyers: count, cashOrders: count, cashYuan: count, productOrders: count, productYuan: count })).min(1),
  daily: z.array(z.object({ server: count, date, orders: count, yuan: count, buyers: count })),
  products: z.array(z.object({ server: count, rechargeId: count, name: z.string(), type: count, configuredYuan: count, orders: count, yuan: count, buyerDays: count, voucherBuyerDays: count })),
  unresolved: z.array(z.object({ rechargeId: count, reason: z.string() })),
}).superRefine((r, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: 'custom', message })
  const ids = new Set(r.servers.map(s => s.id))
  if (r.from > r.through || ids.size !== r.servers.length) fail('测试范围不合法')
  if (r.daily.some(d => !ids.has(d.server) || d.date < r.from || d.date > r.through || d.buyers > d.orders) || r.products.some(p => !ids.has(p.server))) fail('测试数据超出范围')
  if (new Set(r.daily.map(d => `${d.server}:${d.date}`)).size !== r.daily.length || new Set(r.products.map(p => `${p.server}:${p.type}:${p.rechargeId}`)).size !== r.products.length) fail('测试数据存在重复行')
  for (const s of r.servers) {
    const days = r.daily.filter(d => d.server === s.id), products = r.products.filter(p => p.server === s.id)
    if (!days.length || !products.length || days.reduce((n,d)=>n+d.yuan,0) !== s.cashYuan || days.reduce((n,d)=>n+d.orders,0) !== s.cashOrders || products.reduce((n,p)=>n+p.yuan,0) !== s.productYuan || products.reduce((n,p)=>n+p.orders,0) !== s.productOrders || s.cashBuyers > s.cashOrders) fail(`S${s.id} 汇总与明细不一致`)
  }
})
export type TestRevenue = z.infer<typeof testRevenueSchema>
export const revenueGroupNames: Record<string, string> = { all: '全部测试服', king: '王者', moling: '魔灵', expedition: '远征', pioneer: '开拓', cold: '冷启动' }
export const yuan = (n: number) => `¥${n.toLocaleString('zh-CN')}`
export function productReportUrl(report: TestRevenue, server: number) {
  const url = new URL(report.productUrl)
  const beginDate = Date.parse(`${report.from}T00:00:00+08:00`) / 1000
  const endDate = Date.parse(`${report.through}T00:00:00+08:00`) / 1000 + 86400
  url.hash = `/layout/gameData/rechargeData/rechargeDataList?${new URLSearchParams({ serverId: String(server), beginDate: String(beginDate), endDate: String(endDate), pid: '' })}`
  return url.href
}
export function revenueServers(report: TestRevenue, group: string) { return report.servers.filter(s => group === 'all' || s.group === group) }
export function summarizeRevenue(report: TestRevenue, group: string) {
  const servers = revenueServers(report, group), ids = new Set(servers.map(s => s.id))
  const products = report.products.filter(p => ids.has(p.server)), daily = report.daily.filter(d => ids.has(d.server))
  return { servers, products, daily, cashYuan: servers.reduce((n,s)=>n+s.cashYuan,0), cashOrders: servers.reduce((n,s)=>n+s.cashOrders,0), cashBuyers: servers.reduce((n,s)=>n+s.cashBuyers,0), productYuan: servers.reduce((n,s)=>n+s.productYuan,0), productOrders: servers.reduce((n,s)=>n+s.productOrders,0) }
}
export function productRevenue(data: CommerceDataset, product: CommerceProduct, group: string) {
  const report = data.evidence?.revenue
  if (!report || !product.rid || data.products.filter(p => p.rid === product.rid).length !== 1) return undefined
  const rows = summarizeRevenue(report, group).products.filter(p => p.rechargeId === product.rid)
  if (!rows.length) return undefined
  return { rows, orders: rows.reduce((n,p)=>n+p.orders,0), yuan: rows.reduce((n,p)=>n+p.yuan,0), buyerDays: rows.reduce((n,p)=>n+p.buyerDays,0), voucherBuyerDays: rows.reduce((n,p)=>n+p.voucherBuyerDays,0) }
}
export function intentFor(product: CommerceProduct, data: CommerceDataset) {
  const need = data.needs.find(n => n.id === product.needs.find(id => id !== 'unknown'))
  const resource = product.rewards.slice(0,2).map(r=>r.name).join('、') || '奖励内容'
  const behavior = /首充/.test(product.channel) ? '首次付费后获得补强，继续推进游戏。'
    : /月卡|战令|基金|签到/.test(product.channel) ? '随游玩或领取进度持续获得资源。'
    : /链/.test(product.channel) ? `按购买步骤继续补充${resource}。`
    : /条件|触发|通关/.test(product.channel) ? `条件达成时补充${resource}。`
    : product.needs.every(n=>n==='unknown') ? '对应的玩家需求和购买理由待补。'
    : `在当前投放周期内补充${resource}。`
  const verification = /首充/.test(product.channel) ? '首次付费转化、付费后的推进与次日回访。'
    : /月卡|战令|基金|签到/.test(product.channel) ? '购买后的领取完成度与持续游玩。'
    : /链/.test(product.channel) ? '各档购买率、流失档位与资源消耗。'
    : /触发|通关/.test(product.channel) ? '触发后的购买率与后续通关情况。'
    : '购买率、重复购买与所获资源的使用情况。'
  return { need: need?.name ?? '设计归属待补', behavior, verification }
}
