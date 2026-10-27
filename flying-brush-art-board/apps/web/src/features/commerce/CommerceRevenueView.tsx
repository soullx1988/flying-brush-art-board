import { Button, Select, Table, Tag } from '@ttqtt/liquid-glass-react'
import { LedgerCoverage, ProductLedger } from './CommerceLedgerView'
import type { CommerceDataset, CommerceProduct } from './commerce-data'
import { productFacts } from './commerce-facts'
import { CommercePagedTable } from './CommercePagedTable'
import { productReportUrl, productRevenue, revenueGroupNames, summarizeRevenue, yuan, type TestRevenue } from './commerce-revenue'

export function RevenueScope({ report, group, onChange }: { report: TestRevenue; group: string; onChange(value: string): void }) {
  return <label className="commerce-revenue-picker"><span>历史数据区服</span><Select aria-label="历史数据区服" value={group} onChange={onChange} options={[{ value: 'all', label: '全部测试服' }, ...[...new Set(report.servers.map(s=>s.group))].map(value=>({ value, label: revenueGroupNames[value] ?? value }))]} /></label>
}

export function HistoryScopeNotice({ data, group }: { data: CommerceDataset; group: string }) {
  const report = data.evidence?.revenue
  if (!report) return null
  const selected = report.servers.filter(s => group === 'all' || s.group === group)
  const giftServers = [...new Set(data.evidence?.ledger?.giftScope.servers ?? [])]
  const covered = giftServers.filter(id => group === 'all' || selected.some(s => s.id === id))
  // Derive this explanation from the imported coverage, so a later data refresh cannot leave a stale claim.
  const groups = [...new Set(giftServers.map(id => report.servers.find(s => s.id === id)?.group))]
  const onlyGroup = groups.length === 1 ? groups[0] : undefined
  const sameDiamondScope = onlyGroup && (group === 'all' || group === onlyGroup)
  return <p className="commerce-scope-notice" role="status">
    <span>{revenueGroupNames[group] ?? group} · {selected.length} 服 · {report.from.slice(5)}—{report.through.slice(5)} 商品统计含代金券订单；{covered.length ? `钻石流水覆盖其中 ${covered.length} 服的已知角色。` : '该范围钻石流水尚未接入，不代表没有购买。'}</span>
    {sameDiamondScope ? <span>当前钻石流水仅来自{revenueGroupNames[onlyGroup] ?? onlyGroup}，选“全部测试服”或“{revenueGroupNames[onlyGroup] ?? onlyGroup}”笔数相同。</span> : null}
  </p>
}

export function RevenueSummary({ report, group, onChange, onOpen }: { report: TestRevenue; group: string; onChange(value: string): void; onOpen?: (()=>void) | undefined }) {
  const totals = summarizeRevenue(report, group)
  return <section className="commerce-revenue-strip" aria-label="本次测试营收"><div><strong>{report.title} · {report.from.slice(5)}—{report.through.slice(5)}</strong><div className="commerce-revenue-scope"><RevenueScope report={report} group={group} onChange={onChange} /><span>{totals.servers.length} 服</span></div></div><div><strong>{yuan(totals.cashYuan)}</strong><span>现金充值 · 经营日报</span></div><div><strong>{totals.cashOrders.toLocaleString('zh-CN')}</strong><span>现金订单</span></div><div><strong>{yuan(totals.productYuan)}</strong><span>商品订单金额 · 含代金券订单</span></div>{onOpen ? <Button variant="glass" size="sm" onClick={onOpen}>查看测试营收</Button> : null}</section>
}

export function TestProductResults({ data, product, group }: { data: CommerceDataset; product: CommerceProduct; group: string }) {
  const report = data.evidence?.revenue, result = productRevenue(data, product, group)
  if (!report) return null
  const facts=productFacts(data,product,group)
  if (facts.claimOnly) return <><div className="commerce-metrics"><div><strong>{facts.orders.toLocaleString('zh-CN')}</strong><span>带商品 ID 的领取记录</span></div></div><p>S{facts.servers.join('、S')} · {facts.from}—{facts.through}</p><p>仅已知角色范围；未记录扣除道具不代表已区分免费与广告，不计为现金收入或钻石消耗。</p><div className="commerce-validation-status"><strong>设计预期是否达成</strong><span>仍缺广告完成、曝光与购买后行为，以及已确认的成功目标。</span></div></>
  const fullResult = <>{product.kind === 'diamond' && data.evidence?.ledger ? null : <p className="commerce-muted">{report.from.slice(5)}—{report.through.slice(5)} · {revenueGroupNames[group] ?? group}</p>}{result ? <>
    <div className="commerce-metrics commerce-metrics--pair"><div><strong>{result.orders.toLocaleString('zh-CN')}</strong><span>订单 · 含代金券订单</span></div><div><strong>{yuan(result.yuan)}</strong><span>商品订单金额 · 含代金券订单</span></div></div>
    <p><Tag color={result.orders > 0 ? 'success' : 'warning'}>{result.orders > 0 ? '已有购买记录' : '统计记录中订单为零'}</Tag></p><p className="commerce-muted">全期商品现金金额待拆分；另列可逐单核对的已知角色记录。</p>
    <details><summary>查看逐服记录与后台来源</summary><Table aria-label="商品测试逐服记录" size="sm" rowKey={r=>`${r.server}:${r.type}`} data={result.rows} columns={[{key:'server',title:'后台区服',render:r=><a href={productReportUrl(report,r.server)} target="_blank" rel="noreferrer">S{r.server} ↗</a>},{key:'orders',title:'订单（含代金券）',dataIndex:'orders'},{key:'amount',title:'订单金额（含代金券）',render:r=>yuan(r.yuan)},{key:'buyers',title:'购买人次',dataIndex:'buyerDays'}]} /><p className="commerce-muted">购买人次为每日去重人数累加，不能当区间去重人数。点击区服可打开同期后台表，查充值档位 {product.rid}。</p><p className="commerce-muted">按充值档位关联当前商品；测试时奖励版本待核验。</p></details>
  </> : product.kind === 'diamond' && data.evidence?.ledger ? null : <><Tag color="warning">{product.kind === 'cash' || product.rid ? '本范围未见对应记录' : '需接入业务流水'}</Tag><p>{product.kind === 'diamond' ? '钻石消费不能用现金充值订单验证。' : product.kind === 'ad' || product.kind === 'free' || product.kind === 'mixed' ? '需要领取与广告流水。' : product.kind === 'resource' ? '需要资源兑换流水。' : '未见记录不等于没有销售。'}</p></>}
  </>
  const hasLedger = Boolean(data.evidence?.ledger && (product.kind === 'cash' || product.kind === 'diamond' || product.rid))
  return <>{hasLedger ? <ProductLedger data={data} product={product} group={group} /> : null}{hasLedger ? product.kind !== 'diamond' ? <details><summary>全期商品统计（含代金券订单）</summary>{fullResult}</details> : null : fullResult}
    <div className="commerce-validation-status"><strong>设计预期是否达成</strong><span>目标未设定，暂不能判定。</span><span>曝光与购买后行为仍待接入。</span></div>
  </>
}

export function CommerceRevenueView({ data, group, onChange, onSelect }: { data: CommerceDataset; group: string; onChange(value:string): void; onSelect(product:CommerceProduct):void }) {
  const report = data.evidence?.revenue
  if (!report) return null
  const totals = summarizeRevenue(report, group)
  const ids = [...new Set(totals.products.map(p=>p.rechargeId))]
  const items = ids.map(id=> {
    const rows=totals.products.filter(p=>p.rechargeId===id), matches=data.products.filter(p=>p.rid===id)
    return { id, name: rows[0]!.name, product: matches.length===1 ? matches[0] : undefined, orders: rows.reduce((n,r)=>n+r.orders,0), amount: rows.reduce((n,r)=>n+r.yuan,0), servers: new Set(rows.map(r=>r.server)).size }
  }).sort((a,b)=>b.amount-a.amount)
  const dates=[...new Set(totals.daily.map(d=>d.date))].sort()
  const days=dates.map(date=>{const rows=totals.daily.filter(d=>d.date===date);return {date,servers:rows.length,amount:rows.reduce((n,d)=>n+d.yuan,0),orders:rows.reduce((n,d)=>n+d.orders,0)}})
  return <section className="commerce-revenue-report" aria-label="测试营收与核验">
    <RevenueSummary report={report} group={group} onChange={onChange} />
    <LedgerCoverage data={data} />
    <p className="commerce-revenue-basis">现金充值与商品订单金额（含代金券订单）分列；两表相差 {yuan(totals.productYuan-totals.cashYuan)}，不能分摊为某个商品的现金营收。<a href={report.dailyUrl} target="_blank" rel="noreferrer">后台经营日报</a></p>
    <div className="commerce-row commerce-between"><h3>商品贡献 · {items.length} 个充值项</h3><span className="commerce-muted">按商品订单金额排序（含代金券订单）；设计达标需另设目标。</span></div>
    <div className="commerce-product-table"><CommercePagedTable scope={`${report.id}:${group}`} aria-label="测试商品贡献" size="sm" rowKey="id" data={items} pageSize={12} columns={[
      {key:'name',title:'测试商品',width:'25%',render:r=><div className="commerce-product-name"><strong>{r.name}</strong><span className="commerce-muted">充值档位 {r.id}</span></div>},
      {key:'current',title:'当前对应',width:'25%',render:r=>r.product ? <div className="commerce-product-name"><span>{r.product.title}</span>{r.product.status!=='defined'?<Tag color="warning">内容待核验</Tag>:null}</div> : <Tag color="warning">对应待核验</Tag>},
      {key:'orders',title:'订单（含代金券）',dataIndex:'orders'},
      {key:'amount',title:'订单金额（含代金券）',render:r=><strong>{yuan(r.amount)}</strong>},
      {key:'servers',title:'有记录区服',dataIndex:'servers'},
      {key:'open',title:'设计 → 实现 → 结果',render:r=><Button size="sm" variant="ghost" disabled={!r.product} onClick={()=>r.product&&onSelect(r.product)} aria-label={`查看测试商品 ${r.name} ${r.id}`}>查看链路 →</Button>},
    ]} /></div>
    <details><summary>每日现金充值 · {days.length} 个有记录日期</summary><Table aria-label="测试每日现金充值" size="sm" rowKey="date" data={days} columns={[{key:'date',title:'日期',dataIndex:'date'},{key:'servers',title:'有日表的区服',dataIndex:'servers'},{key:'orders',title:'现金订单',dataIndex:'orders'},{key:'amount',title:'现金充值',render:r=>yuan(r.amount)}]} /><p className="commerce-muted">缺少的区服日行不填零。{report.cashBasis}</p></details>
    <details><summary>逐服核对 · {totals.servers.length} 服日报与日明细已对上</summary><Table aria-label="测试逐服核对" size="sm" rowKey="id" data={totals.servers} columns={[{key:'name',title:'区服',render:r=>`S${r.id} ${r.name}`},{key:'cash',title:'日报现金充值',render:r=>yuan(r.cashYuan)},{key:'products',title:'商品订单金额（含代金券）',render:r=>yuan(r.productYuan)},{key:'delta',title:'两表口径差额',render:r=>yuan(r.productYuan-r.cashYuan)},{key:'buyers',title:'现金付费角色（服内去重）',dataIndex:'cashBuyers'}]} /><p className="commerce-muted">{report.productBasis}</p></details>
    <details className="commerce-source"><summary>统计范围、来源与未完成验证</summary><p>{report.coverage}</p><p>读取时间：{new Date(report.readAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}（北京时间）。本页为保存后的后台快照。</p><p>{report.cashBasis}</p><p>{report.productBasis}</p><ul>{report.limitations.map(x=><li key={x}>{x}</li>)}</ul>{report.unresolved.map(x=><p key={x.rechargeId}>档位 {x.rechargeId}：{x.reason}</p>)}<code>{report.backup.path}</code><p className="commerce-muted">快照 {report.id.slice(0,12)} · {report.sources.length} 份来源与范围文件 · 备份校验 {report.backup.sha256.slice(0,12)}</p><a href={report.productUrl} target="_blank" rel="noreferrer">打开后台商品查询</a></details>
  </section>
}
