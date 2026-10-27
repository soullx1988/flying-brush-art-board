import { useLayoutEffect, useRef, useState } from 'react'
import { Button, Select, Table, Tag } from '@ttqtt/liquid-glass-react'
import { archiveRows, isPartialDay, type ArchivedRevenue, type ArchivedRevenueRow } from './commerce-archive'
import { revenueGroupNames, yuan } from './commerce-revenue'
import { CommercePagedTable } from './CommercePagedTable'

const time = (value: string) => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
export function CommerceArchiveView({ report }: { report: ArchivedRevenue }) {
  const [group, setGroup] = useState('all'), [server, setServer] = useState('all')
  const dailyHeading = useRef<HTMLHeadingElement>(null), revealDaily = useRef(false)
  const focusDaily = () => {
    dailyHeading.current?.scrollIntoView?.({block:'start'})
    dailyHeading.current?.focus({preventScroll:true})
  }
  const chooseServer = (value: string) => {
    if (value === server) { focusDaily(); return }
    revealDaily.current = true
    setServer(value)
  }
  useLayoutEffect(() => {
    if (!revealDaily.current) return
    revealDaily.current = false
    focusDaily()
  }, [server])
  const servers = report.servers.filter(s => group === 'all' || s.group === group)
  const rows = archiveRows(report, group, server)
  const totals = servers.map(s => {
    const daily = archiveRows(report, group, String(s.id))
    return { ...s, daily, yuan: daily.reduce((n, r) => n + r.yuan, 0), partial: daily.filter(isPartialDay).length, last: daily.map(r => r.date).sort().at(-1) }
  })
  const selected = report.servers.find(s => String(s.id) === server)
  return <section className="commerce-archive" aria-label="历史测试备份">
    <div className="commerce-row commerce-between"><div className="commerce-row"><Tag color="warning">区服日报备份 · 非逐笔流水</Tag><span className="commerce-muted">{report.from}—{report.through} · 各服覆盖不同</span></div><label className="commerce-revenue-picker"><span>历史数据区服</span><Select aria-label="备份区服分组" value={group} onChange={v => { setGroup(v); setServer('all') }} options={[{value:'all',label:'王者与魔灵'}, ...[...new Set(report.servers.map(s => s.group))].map(value => ({value,label:revenueGroupNames[value] ?? value}))]} /></label></div>
    <div className="commerce-archive-metrics">
      <div><strong>{yuan(rows.reduce((n, r) => n + r.yuan, 0))}</strong><span>备份报表充值金额</span></div>
      <div><strong>{new Set(rows.map(r => r.server)).size} 服 · {rows.length} 条</strong><span>每服每天仅取最新一份</span></div>
      <div><strong>{rows.filter(isPartialDay).length} 条</strong><span>当天快照，尚非完整日</span></div>
    </div>
    <p className="commerce-scope-notice">{selected ? `当前仅看 S${selected.id} ${selected.name}。` : ''}{report.basis}</p>
    <div className="commerce-row commerce-between"><h3>各服备份覆盖</h3><span className="commerce-muted">缺失日期保留缺失；金额不与 10 月相加。</span></div>
    <div className="commerce-product-table"><Table aria-label="历史各服充值备份" size="sm" rowKey="id" data={totals} columns={[
      {key:'server',title:'区服',render:s=><strong>S{s.id} · {s.name}</strong>},
      {key:'amount',title:'报表充值金额',render:s=>yuan(s.yuan)},
      {key:'days',title:'已存日记录',render:s=>`${s.daily.length} 天`},
      {key:'last',title:'最后记录日期',dataIndex:'last'},
      {key:'partial',title:'其中当天快照',render:s=>`${s.partial} 天`},
      {key:'open',title:'查看',render:s=><Button size="sm" variant="ghost" onClick={()=>chooseServer(String(s.id))} aria-label={`查看 S${s.id} 逐日备份`}>逐日明细 →</Button>},
    ]} /></div>
    <div className="commerce-row commerce-between"><h3 ref={dailyHeading} tabIndex={-1}>{selected ? `S${selected.id} ${selected.name}` : revenueGroupNames[group] ?? '所选区服'} · 逐日充值记录</h3>{server !== 'all' ? <Button size="sm" variant="glass" onClick={()=>chooseServer('all')}>返回本组全部区服</Button> : null}</div>
    <div className="commerce-product-table"><CommercePagedTable<ArchivedRevenueRow> scope={`${report.id}:${group}:${server}`} aria-label="历史逐日充值备份" size="sm" rowKey={r=>`${r.server}:${r.date}`} data={rows} pageSize={12} columns={[
      {key:'date',title:'日期 / 区服',render:r=><div className="commerce-product-name"><strong>{r.date}</strong><span>S{r.server}</span></div>},
      {key:'amount',title:'报表充值金额',render:r=><strong>{yuan(r.yuan)}</strong>},
      {key:'orders',title:'订单数',render:r=>r.orders === undefined ? <span className="commerce-muted">原表未保留</span> : r.orders},
      {key:'capture',title:'快照抓取时间（北京）',render:r=>time(r.capturedAt)},
      {key:'coverage',title:'记录范围',render:r=><Tag color={isPartialDay(r)?'warning':'default'}>{isPartialDay(r)?'当天快照':'次日或以后回读'}</Tag>},
      {key:'source',title:'来源',render:r=><details><summary>原始文件</summary><code className="commerce-archive-path">{r.source}</code></details>},
    ]} /></div>
    <section className="commerce-validation-status"><strong>商品级验证仍缺什么</strong>{report.gaps.map(g=><span key={g}>{g}</span>)}</section>
    <details className="commerce-source"><summary>备份数据库、去重规则与来源 · {report.inputFiles} 份输入</summary><p>{report.coverage}</p>{report.limitations.map(x=><p key={x}>{x}</p>)}<p>{report.emptyFiles} 份快照没有留存数据，未作为零充值写入。</p><p>本地备份数据库：</p><code>{report.backup.path}</code><p>daily_selected：最终逐日记录；observations：原始观测与旧值；source_files：来源及摘要。</p><code>SELECT * FROM daily_selected ORDER BY server, date;</code><p>校验摘要：{report.backup.sha256}</p><p>整理于 {time(report.importedAt)}。本页为历史备份，不会实时查询后台。</p></details>
  </section>
}
