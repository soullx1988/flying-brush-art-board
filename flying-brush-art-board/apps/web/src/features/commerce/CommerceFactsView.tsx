import { Tag } from '@ttqtt/liquid-glass-react'
import type { CommerceDataset, CommerceProduct } from './commerce-data'
import { productFacts } from './commerce-facts'
import { GameItemIcon } from './CommerceEvidenceView'

const describe = (p: CommerceProduct['rewards']) => p.map(r=>`${r.name} × ${r.n}`).join('、')

export function ProductFacts({ data, product, group='all', compact=false }: {data:CommerceDataset;product:CommerceProduct;group?:string;compact?:boolean}) {
  const f = productFacts(data,product,group), rewards = compact ? f.rewards.slice(0,3) : f.rewards
  return <div className="commerce-facts">
    <span className="commerce-muted">{f.actual ? `流水实得 · ${f.from?.slice(5)}—${f.through?.slice(5)}` : '配置快照 · 到账未完整核验'}</span>
    <div className="commerce-rewards">{rewards.map(a=><div className="commerce-reward" key={a.id}><GameItemIcon evidence={data.evidence} id={a.id} name={a.name}/><span>{a.name} × {a.n}</span></div>)}{!rewards.length ? <span className="commerce-muted">奖励明细待核验</span> : null}{compact && f.rewards.length>3 ? <span className="commerce-muted">另 {f.rewards.length-3} 类，见详情</span> : null}</div>
    {f.difference ? <div className="commerce-fact-conflict"><Tag color="warning">源表与测试流水不同</Tag><span>源表：{[describe(f.configuredDifferences),...(f.price!==product.price||f.prices.length>1 ? [product.price] : [])].filter(Boolean).join('；')}</span></div> : null}
    {f.incomplete || f.varied ? <div className="commerce-fact-conflict"><Tag color="warning">{f.incomplete ? '到账明细待核全' : '流水有多种奖励'}</Tag><span>{compact ? '未用部分日志替代完整商品，见详情' : `日志记载：${f.raw.filter(Boolean).join('；') || '普通道具字段为空'}。需核对随机奖励、独立发放记录或版本变化，不能据此认定少发。`}</span></div> : null}
    {!compact && f.hasRecords ? <p className="commerce-muted">{f.orders} 笔{f.claimOnly ? '领取记录' : '购买'}；S{f.servers.join('、S')}，{f.from}—{f.through}。证明该范围内实际记录，不代表所有区服今天的投放。{f.prices.length>1 ? `实扣存在多个价格：${f.prices.join('、')} 钻石。` : ''}</p> : null}
    {!compact ? <ProductVerification data={data} product={product} /> : null}
    {!compact && data.evidence?.catalogReview?.draft[product.key] ? <details><summary>后台草稿对照（非发布证明）</summary><p>{describe(data.evidence.catalogReview.draft[product.key]!.rewards)}</p><p>{data.evidence.catalogReview.draft[product.key]!.price}；{data.evidence.catalogReview.draft[product.key]!.limit}</p><p>读取于 {data.evidence.catalogReview.checkedAt}；1_15_0_0 编辑页标为 SQL 草稿，不能视为全部服务器已生效。</p></details> : null}
  </div>
}

function ProductVerification({ data, product }: {data:CommerceDataset;product:CommerceProduct}) {
  const audit=data.evidence?.catalogReview?.audit, check=audit?.checks[product.key], finding=audit?.findings[product.key]
  if (!check && !finding) return null
  return <details className="commerce-source" open={!!finding}><summary>{finding?.label ?? '本轮价格与奖励核验'}</summary>
    {finding ? <p>{finding.detail}</p> : null}
    {check ? <><p>价格：{check.price}</p><p>奖励：{check.reward}</p></> : null}
    <p className="commerce-label">还缺什么</p><ul>{(finding?.missing ?? check?.missing ?? []).map(s=><li key={s}>{s}</li>)}</ul>
    {finding ? <p className="commerce-muted">依据：{finding.sources.join('；')}</p> : null}
    <p className="commerce-muted">本轮核验覆盖的历史范围固定；切换区服不改变该核查结论的范围。</p>
  </details>
}

export function CatalogFactsNotice({ data }: {data:CommerceDataset}) {
  const facts=data.products.map(p=>productFacts(data,p)), differences=facts.filter(f=>f.difference).length, incomplete=facts.filter(f=>f.incomplete||f.varied).length
  const audit=data.evidence?.catalogReview?.audit
  return <details className="commerce-source commerce-catalog-notice"><summary>本轮核查：{data.products.filter(p=>p.status==='defined').length} 项商品定义 · {differences} 项源表与测试流水差异 · {incomplete} 项到账明细待补</summary><p>商品数量优先显示所选区服已记录的完整实得奖励；无完整证据时展示配置，并保留标记。源表版本、导入日期和历史区间分别记录；尚未自动同步游戏。</p>
    {audit ? <><h3>已经核到哪里</h3>{audit.coverage.map(r=><p key={r.label}><strong>{r.count} 项 · {r.label}</strong>：{r.detail}</p>)}<h3>剩余差异与具体缺口</h3>{Object.entries(audit.findings).map(([key,r])=><details key={key}><summary>{data.products.find(p=>p.key===key)?.title} · {key} · {r.label}</summary><p>{r.detail}</p><ul>{r.missing.map(s=><li key={s}>{s}</li>)}</ul></details>)}<ul>{audit.gaps.map(s=><li key={s}>{s}</li>)}</ul><p className="commerce-muted">逐项核查备份：{audit.source.path}</p></> : null}
    {data.evidence?.catalogReview?.notes.map(n=><p key={n}>{n}</p>)}<p>配置核对日期：{data.created}。以下版本不等于各服生效版本：</p>{Object.values(data.sources).map(s=><p key={s.path} className="commerce-muted">{s.name} · {s.revision ?? '版本待核验'} · {s.checkedAt ?? '未核对远端'}</p>)}</details>
}
