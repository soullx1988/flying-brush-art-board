import { Tag } from '@ttqtt/liquid-glass-react'
import type { CommerceDataset, CommerceProduct } from './commerce-data'
import { ledgerRows } from './commerce-ledger'
import { yuan } from './commerce-revenue'
import { CommercePagedTable } from './CommercePagedTable'

export function ProductAudit({ data, product, compact = false }: { data: CommerceDataset; product: CommerceProduct; compact?: boolean }) {
  const audit = data.evidence?.ledger?.audits[product.key]
  if (!audit) return null
  return <div className="commerce-product-audit"><Tag color="warning">{audit.label}</Tag>{!compact ? <><p>{audit.detail}</p><details><summary>工程依据</summary>{audit.sources.map(s => <p key={s} className="commerce-muted">{s}</p>)}</details></> : null}</div>
}

export function ProductLedger({ data, product, group }: { data: CommerceDataset; product: CommerceProduct; group: string }) {
  const ledger = data.evidence?.ledger
  if (!ledger) return null
  const { payments, purchases, giftCovered } = ledgerRows(data, product, group)
  const cash = payments.reduce((n, r) => n + r.cashYuan, 0), vouchers = payments.reduce((n, r) => n + r.voucherOrderYuan, 0)
  return <section className="commerce-product-ledger" aria-label="商品支付明细">
    {product.kind === 'cash' || product.rid ? <>
      <h4>现金 / 代金券 · 已知角色记录</h4><p className="commerce-muted">{ledger.orderScope.label}</p>
      {payments.length ? <><div className="commerce-metrics commerce-metrics--pair"><div><strong>{yuan(cash)}</strong><span>现金订单金额 · {payments.reduce((n,r)=>n+r.cashOrders,0)} 笔</span></div><div><strong>{yuan(vouchers)}</strong><span>代金券订单金额 · {payments.reduce((n,r)=>n+r.voucherOrders,0)} 笔</span></div></div><p className="commerce-muted">代金券按订单金额列示，不计现金；实扣券面额待补。未成功 {payments.reduce((n,r)=>n+r.unsuccessful,0)} 笔已排除。</p></> : <p>所选范围没有可对应的已知角色订单；全期商品现金 / 代金券仍待逐单拆分。</p>}

    </> : product.kind === 'diamond' ? <>
      <h4>钻石购买 · 按礼包编号 {product.sku} 核对</h4><p className="commerce-muted">{ledger.giftScope.label}</p>
      {purchases.length ? <><div className="commerce-metrics commerce-metrics--pair"><div><strong>{purchases.reduce((n,r)=>n+r.orders,0)} 笔</strong><span>样本内已确认购买</span></div><div><strong>{purchases.reduce((n,r)=>n+r.diamonds,0).toLocaleString('zh-CN')} 钻石</strong><span>流水实际扣除</span></div></div><details><summary>逐日扣除与实际奖励</summary><CommercePagedTable scope={`${product.key}:${group}:${ledger.backup.sha256}`} aria-label="钻石商品逐日流水" size="sm" rowKey={r=>`${r.server}:${r.date}`} data={purchases} pageSize={10} columns={[{key:'date',title:'日期 / 服',render:r=>`${r.date.slice(5)} / S${r.server}`},{key:'orders',title:'笔数',dataIndex:'orders'},{key:'cost',title:'实扣钻石',dataIndex:'diamonds'},{key:'rewards',title:'实际奖励',render:r=>r.rewards.join('；')}]} /><p>单笔实扣：{[...new Set(purchases.flatMap(r=>r.prices))].sort((a,b)=>a-b).join('、')} 钻石。奖励按历史日志原文展示，不反套当前配置。</p></details></> : <p>{giftCovered ? '这批角色未见本商品记录，不能据此判定未开放或零销量。' : '所选区服不在本批流水覆盖范围内。'}</p>}

    </> : null}
    {product.kind === 'diamond' || product.rid ? <details><summary>范围、后台与备份</summary>{product.key === 'gift:204' ? <p className="commerce-muted">旧备份有 {ledger.unidentified.dailyRecruitCandidates.toLocaleString('zh-CN')} 笔“480 钻石换 20 招募券”候选流水，旧记录缺礼包 ID，未按候选笔数累加到上方；新旧记录存在重叠。</p> : null}{(product.kind === 'diamond' ? ledger.giftScope.limitations : ledger.orderScope.limitations).map(x=><p key={x}>{x}</p>)}<a href="http://mlbj-web.4399xydj.com/#/layout/gameInfo/getPlayer" target="_blank" rel="noreferrer">打开后台查询角色 ↗</a><p>{product.kind === 'diamond' ? `操作日志 → 购买礼包 → 礼包 ID ${product.sku}` : `充值订单 → 充值档位 ${product.rid}；现金和代金券分别核对`}</p><code>{ledger.backup.path}</code><p className="commerce-muted">备份查询（只读）：</p><code>{product.kind === 'diamond' ? `SELECT payload FROM ledger_evidence WHERE kind='identified_diamond_actions' AND json_extract(payload, '$.giftId')=${Number(product.sku)};` : `SELECT payload FROM ledger_evidence WHERE kind='orders' AND json_extract(payload, '$.rechargeItemId')=${product.rid};`}</code></details> : null}
  </section>
}

export function LedgerCoverage({ data }: { data: CommerceDataset }) {
  const ledger = data.evidence?.ledger
  if (!ledger) return null
  return <details className="commerce-source"><summary>商品级现金 / 代金券 / 钻石：已接入范围与待补项</summary><p>{ledger.orderScope.label}：现金 {yuan(ledger.payments.reduce((n,r)=>n+r.cashYuan,0))}，代金券订单金额 {yuan(ledger.payments.reduce((n,r)=>n+r.voucherOrderYuan,0))}。</p><p>{ledger.giftScope.label}：{ledger.purchases.reduce((n,r)=>n+r.orders,0)} 笔、{ledger.purchases.reduce((n,r)=>n+r.diamonds,0).toLocaleString('zh-CN')} 钻石，覆盖 {new Set(ledger.purchases.map(r=>r.key)).size} 项。仅覆盖已知角色，不与全期汇总相加。</p><p>{ledger.unidentified.label}：{ledger.unidentified.rows.toLocaleString('zh-CN')} 笔 / {ledger.unidentified.diamonds.toLocaleString('zh-CN')} 钻石，尚未确定商品身份。</p><ul>{ledger.gaps.map(x=><li key={x}>{x}</li>)}</ul><p>订单与原始流水已保存在本地备份；画板仅存汇总，不包含角色身份。</p><code>{ledger.backup.path}</code></details>
}
