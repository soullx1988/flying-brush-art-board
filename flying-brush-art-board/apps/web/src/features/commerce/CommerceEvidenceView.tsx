import { Table, Tag } from '@ttqtt/liquid-glass-react'
import type { CommerceEvidence } from './commerce-evidence'
import type { CommerceProduct } from './commerce-data'

export function GameItemIcon({ evidence, id, name }: { evidence?: CommerceEvidence | undefined; id: number; name: string }) {
  const icon = evidence?.icons[String(id)]
  const asset = icon && evidence?.assets[icon.asset]
  if (!icon || !asset) return null
  return <svg className="commerce-item-icon" role="img" aria-label={`${name}游戏图标`} viewBox={`0 0 ${icon.w} ${icon.h}`}>
    <image href={`/api/assets/${icon.asset}`} width={asset.width} height={asset.height} x={-icon.x} y={-icon.y} transform={icon.rotated ? `matrix(0 -1 1 0 0 ${icon.h})` : undefined} />
  </svg>
}

export function GamePlacement({ evidence, product }: { evidence?: CommerceEvidence | undefined; product: CommerceProduct }) {
  const placement = evidence?.placements[product.channel]
  return <div className="commerce-placement"><p className="commerce-label">在哪里看到它</p><p>{placement?.path ?? `${product.channel} · 具体入口路径待核验`}</p>
    {placement ? <p className="commerce-muted">{placement.evidence}</p> : null}
    {placement?.reference ? <details><summary>查看游戏界面参考图</summary><figure><img className="commerce-screen-reference" src={`/api/assets/${placement.reference}`} alt={`${product.channel}工程界面参考`} loading="lazy" /><figcaption>{placement.referenceLabel}</figcaption></figure></details> : <p className="commerce-muted">当前实机入口截图待补。</p>}
  </div>
}

export function missingHistoryReason(product: CommerceProduct, evidence?: CommerceEvidence) {
  if (product.kind === 'diamond') return '未接入钻石购买流水'
  if (product.kind === 'free' || product.kind === 'ad' || product.kind === 'mixed') return '领取 / 广告流水待接入'
  if (product.kind === 'resource') return '资源兑换流水待接入'
  return evidence ? '本批备份未见可关联成功订单' : '尚未关联历史数据'
}

export function HistoryMetrics({ evidence, product }: { evidence?: CommerceEvidence | undefined; product: CommerceProduct }) {
  const row = evidence?.history.byProduct[product.key]
  const countLabel = row || product.kind === 'cash' ? '成功现金订单' : product.kind === 'free' ? '领取次数' : product.kind === 'ad' || product.kind === 'mixed' ? '广告 / 领取次数' : '购买次数'
  const amountLabel = row || product.kind === 'cash' ? '订单金额' : product.kind === 'diamond' ? '钻石消耗' : product.kind === 'resource' ? '资源消耗' : '到账数量'
  return <><Tag color={row ? 'success' : 'warning'}>{row ? '已关联订单备份' : missingHistoryReason(product, evidence)}</Tag>
    <div className="commerce-metrics"><div><strong>{row?.buyers ?? '—'}</strong><span>{row || product.kind === 'cash' || product.kind === 'diamond' ? '购买角色' : '参与角色'}</span></div><div><strong>{row?.orders ?? '—'}</strong><span>{countLabel}</span></div><div><strong>{row ? `¥${row.yuan.toLocaleString('zh-CN')}` : '—'}</strong><span>{amountLabel}</span></div></div>
    {row && evidence ? <><p>{row.firstDate} 至 {row.lastDate} · 充值档位 {row.rechargeId}</p><p className="commerce-muted">{evidence.history.population}</p><p className="commerce-muted">成功现金订单金额，未扣退款；按当前档位 ID 对应，历史奖励版本待复核。</p></> : <p className="commerce-muted">{product.kind === 'diamond' ? '这个商品消耗钻石，充值订单不能代表它的购买情况。' : '未见记录或未接入，不等于销量为零。'}</p>}
  </>
}

export function HistoryDetails({ evidence, product }: { evidence?: CommerceEvidence | undefined; product: CommerceProduct }) {
  const row = evidence?.history.byProduct[product.key]
  if (!evidence) return <div className="commerce-history"><h3>历史资料待关联</h3><p>商品编号：{product.sku} · 充值档位：{product.rid ?? '无'}</p><p>按区服、时段与当时版本核对；没有曝光记录时不计算购买转化率。</p></div>
  return <div className="commerce-history"><h3>订单备份明细与核对依据</h3><p>商品编号：{product.sku} · 充值档位：{product.rid ?? '无'}</p><p>{evidence.history.population}</p><p>备份读取时间：{evidence.history.readAt} · {evidence.history.timeBasis}</p>
    {row ? <><p>本商品排除待支付 / 非成功订单 {row.failedOrPending} 笔；另有成功代金券订单 {row.voucherOrders} 笔。记录中的单笔金额：{row.prices.join(' / ')} 元。</p><Table aria-label="商品历史逐日明细" size="sm" rowKey={r => `${r.date}-${r.server}`} data={row.daily} columns={[{ key:'date', title:'日期（北京时间）', dataIndex:'date' },{ key:'server',title:'区服',render:r=>`S${r.server}` },{ key:'buyers',title:'购买角色',dataIndex:'buyers' },{ key:'orders',title:'成功现金订单',dataIndex:'orders' },{ key:'yuan',title:'订单金额（元）',dataIndex:'yuan' }]} /></> : <p>{missingHistoryReason(product, evidence)}。本批资料只包含现金及代金券订单，不包含钻石等业务流水。</p>}
    <p>{evidence.history.versionNote}</p><ul>{evidence.history.limitations.map(value => <li key={value}>{value}</li>)}</ul>
    <details><summary>查看备份来源与核对结果</summary><code>{evidence.history.source.path}</code><p>源文件 SHA-256：{evidence.history.source.sha256}</p><p>共 {evidence.history.records} 条记录；成功现金订单 {evidence.history.successCashOrders} 笔、金额 {evidence.history.successCashYuan} 元；排除非成功订单 {evidence.history.failedOrPending} 笔，成功代金券订单另列 {evidence.history.voucherOrders} 笔。</p><p>导入画板的是汇总与逐日明细。订单级证据保存在本地备份；重新读取后可用“更新配图与历史”更新本画板。</p></details>
  </div>
}
