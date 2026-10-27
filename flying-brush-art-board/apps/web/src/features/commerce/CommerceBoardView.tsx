import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Breadcrumb, Button, Card, Checkbox, Empty, Input, Select, Table, Tag, toast } from '@ttqtt/liquid-glass-react'
import { ArrowLeft, ArrowRight, Storefront, Gift, Star, Lightning, Link, CalendarBlank } from '@phosphor-icons/react'
import { filterProducts, paymentNames, relatedProducts, isCatalogProduct, type CommerceDataset, type CommerceProduct } from './commerce-data'
import { commerceEntrances, entranceProducts, entranceFor, relatedReason } from './commerce-browse'
import { GameItemIcon, GamePlacement, HistoryDetails, HistoryMetrics, missingHistoryReason } from './CommerceEvidenceView'
import { CommerceRevenueView, HistoryScopeNotice, RevenueScope, RevenueSummary, TestProductResults } from './CommerceRevenueView'
import { intentFor, productRevenue, revenueGroupNames, yuan } from './commerce-revenue'
import { hasLedgerHistory, ledgerRows } from './commerce-ledger'
import { LedgerCoverage, ProductAudit } from './CommerceLedgerView'
import { CommerceArchiveView } from './CommerceArchiveView'
import { productFacts } from './commerce-facts'
import { CatalogFactsNotice, ProductFacts } from './CommerceFactsView'
import './commerce-board.css'

type ResourceBoard = { id: string; title: string }
const entranceIcons = [Storefront, Gift, Star, Lightning, Link, CalendarBlank]
const productName = (p: CommerceProduct) => p.title.includes(' · ') ? p.title.split(' · ').slice(1).join(' · ') : p.title

export function CommerceBoardView({ data, onOpenBoard, resources = [] }: { data: CommerceDataset; onOpenBoard?: ((id: string) => void) | undefined; resources?: readonly ResourceBoard[] }) {
  const [view, setView] = useState<'home' | 'list' | 'detail' | 'revenue' | 'archive'>('home')
  const [archiveKey, setArchiveKey] = useState('')
  const [revenueGroup, setRevenueGroup] = useState('all'), [detailOrigin, setDetailOrigin] = useState<'list' | 'revenue'>('list')
  const report = data.evidence?.revenue
  const archives = data.evidence?.archives ?? [], archive = archives.find(r=>r.id === archiveKey)
  const [entrance, setEntrance] = useState('all'), [need, setNeed] = useState('all')
  const [kind, setKind] = useState('all'), [channel, setChannel] = useState('all'), [query, setQuery] = useState('')
  const [selectedKey, setSelectedKey] = useState<string>()
  const [limit, setLimit] = useState(18), [historyOnly, setHistoryOnly] = useState(false), [compare, setCompare] = useState(false), [differencesOnly,setDifferencesOnly] = useState(false)
  const root = useRef<HTMLElement>(null), listScroll = useRef(0), restoreList = useRef(false)
  const heading = useRef<HTMLHeadingElement>(null), firstRender = useRef(true)
  const nextProduct = useRef<HTMLButtonElement>(null), nextProductKey = useRef<string | undefined>(undefined)
  const scopeProducts = useMemo(() => entranceProducts(data, entrance), [data, entrance])
  const matchingProducts = useMemo(() => filterProducts({ ...data, products: scopeProducts }, need, kind, channel, query), [data, scopeProducts, need, kind, channel, query])
  const historyProducts = useMemo(() => matchingProducts.filter(p => hasLedgerHistory(data, p, revenueGroup) || (report ? productRevenue(data, p, revenueGroup) : data.evidence?.history.byProduct[p.key])), [data, matchingProducts, report, revenueGroup])
  const products = (historyOnly ? historyProducts : matchingProducts).filter(p=>!differencesOnly || productFacts(data,p,revenueGroup).difference || productFacts(data,p,revenueGroup).incomplete || productFacts(data,p,revenueGroup).varied)
  const visibleHistoryCount = historyProducts.filter(p=>products.some(x=>x.key===p.key)).length
  const hasProductFilters = kind !== 'all' || channel !== 'all' || query !== '' || need !== 'all' || historyOnly || differencesOnly
  useLayoutEffect(() => {
    if (!nextProductKey.current) return
    nextProduct.current?.scrollIntoView?.({ block: 'center' })
    nextProduct.current?.focus({ preventScroll: true })
    nextProductKey.current = undefined
  }, [limit])
  const selected = data.products.find(p => p.key === selectedKey)
  const entry = commerceEntrances.find(e => e.id === entrance), currentNeed = data.needs.find(n => n.id === need)
  const listTitle = compare ? '按玩家需求比较' : historyOnly ? '已接入历史的商品' : entry?.name ?? '全部商品与关联项'
  const channels = [...new Set(scopeProducts.map(p => p.channel))]
  useLayoutEffect(() => {
    const scroll = root.current?.closest('.commerce-overlay')
    if (scroll) scroll.scrollTop = view === 'list' && restoreList.current ? listScroll.current : 0
    restoreList.current = false
    if (firstRender.current) firstRender.current = false
    else heading.current?.focus({ preventScroll: true })
  }, [view, selectedKey])
  const browse = (id = 'all', options: { need?: string; history?: boolean; compare?: boolean; query?: string } = {}) => {
    setEntrance(id); setNeed(options.need ?? 'all'); setKind('all'); setChannel('all'); setQuery(options.query ?? '')
    setHistoryOnly(options.history ?? false); setCompare(options.compare ?? false); setDifferencesOnly(false); setLimit(18); setView('list')
  }
  const select = (p: CommerceProduct) => {
    if (view === 'list') listScroll.current = root.current?.closest('.commerce-overlay')?.scrollTop ?? 0
    if (view !== 'detail') setDetailOrigin(view === 'revenue' ? 'revenue' : 'list')
    setSelectedKey(p.key); setView('detail')
  }
  const back = () => { restoreList.current = true; setView(detailOrigin) }
  const home = () => { setView('home'); setQuery('') }
  const resetLimit = (action: () => void) => { action(); setLimit(18) }
  return <section ref={root} className={`commerce-board commerce-board--${view}`} aria-label="付费点总览" onKeyDown={e => {
    const command = !e.altKey && (e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'k' || (e.shiftKey && e.key.toLowerCase() === 'n'))
    const backShortcut = e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.key === 'ArrowLeft'
    // Protect the hidden canvas from editing shortcuts, while retaining workspace navigation.
    if (!command && !backShortcut) e.stopPropagation()
  }}>
    {view !== 'home' ? <Breadcrumb items={[{ label: '商业模式', onClick: home }, { label: view === 'archive' ? '历史测试备份' : view === 'revenue' || (view === 'detail' && detailOrigin === 'revenue') ? '测试营收' : listTitle, onClick: back }, ...(view === 'detail' && selected ? [{ label: productName(selected) }] : [])]} /> : null}
    <header className="commerce-row commerce-between commerce-heading"><div><div className="commerce-heading-main"><h2 ref={heading} tabIndex={-1}>{view === 'home' ? '商品与投放核对' : view === 'detail' && selected ? productName(selected) : view === 'archive' ? archive?.title ?? '历史测试备份' : view === 'revenue' ? '测试营收与验证' : listTitle}</h2><span className="commerce-muted">{view === 'archive' ? `历史报表 · ${archive?.from ?? ''}—${archive?.through ?? ''}` : `1.15.0 配置核对 · ${data.created}`}</span></div>{view === 'home' ? <p>选投放入口，找商品，再看设计与历史。</p> : view === 'detail' && selected ? <p>{entranceFor(selected).name} / {selected.channel}</p> : null}</div>{view !== 'home' ? <Button size="sm" variant="glass" icon={<ArrowLeft />} onClick={view === 'detail' ? back : home}>{view === 'detail' ? (detailOrigin === 'revenue' ? '返回测试营收' : '返回商品清单') : '返回投放总览'}</Button> : null}</header>
    {archives.length > 0 && (view === 'home' || view === 'revenue' || view === 'archive') ? <div className="commerce-history-navigation"><label>历史测试批次<Select aria-label="历史测试批次" value={view === 'archive' ? archiveKey : 'current'} onChange={key => { if (key === 'current') setView('revenue'); else { setArchiveKey(key); setView('archive') } }} options={[{value:'current',label:report?.title ?? '当前已接入历史'},...archives.map(r=>({value:r.id,label:r.title}))]} /></label><span className="commerce-muted">各测试单独查看；历史数据不会改变当前商品设计。</span></div> : null}
    {view === 'archive' && archive ? <CommerceArchiveView key={archive.id} report={archive} /> : null}
    {view === 'home' ? <>
      {report ? <RevenueSummary report={report} group={revenueGroup} onChange={setRevenueGroup} onOpen={() => setView('revenue')} /> : null}
      <CatalogFactsNotice data={data} />
      <div className="commerce-home-search"><Input aria-label="搜索全部商品" placeholder="直接找商品或资源，例如：招募券、月卡、204" value={query} onChange={e => setQuery(e.currentTarget.value)} onKeyDown={e => { if (e.key === 'Enter') browse('all', { query }) }} /><Button variant="accent" onClick={() => browse('all', { query })}>搜索商品</Button></div>
      <div className="commerce-row commerce-between"><h3>游戏中的投放入口</h3><span className="commerce-muted">配置存在不代表当前线上开放；免费、广告与兑换项保留用于比较。</span></div>
      <div className="commerce-entrances">{commerceEntrances.slice(0, 6).map((e, index) => {
        const all = entranceProducts(data, e.id), defined = all.filter(p => p.status === 'defined')
        const rewards = [...new Map(defined.flatMap(p => p.rewards).map(r => [r.id, r])).values()].slice(0, 3), Icon = entranceIcons[index]!
        return <Card padding="sm" key={e.id} className="commerce-entrance"><div className="commerce-row commerce-between"><Button variant="ghost" size="sm" className="commerce-entrance-title" icon={<Icon size={20} weight="duotone" />} aria-label={`查看${e.name}${e.name.endsWith('商品') ? '' : '商品'}`} onClick={() => browse(e.id)}>{e.name}<ArrowRight size={14} /></Button><span className="commerce-muted">{defined.length} 项{all.length > defined.length ? ` · ${all.length - defined.length} 待核验` : ''}</span></div><div className="commerce-entrance-summary"><p>{e.description}</p><div className="commerce-entrance-resources" title="商品资源示例">{rewards.map(r => <GameItemIcon key={r.id} evidence={data.evidence} id={r.id} name={r.name} />)}</div></div></Card>
      })}</div>
      <div className="commerce-secondary" aria-label="其他查看方式"><Button variant="glass" onClick={() => browse('all', { compare: true })}>按玩家需求比较</Button><Button variant="glass" onClick={() => browse('all', { history: true })}>{report ? '看本次测试有记录的商品' : '看历史记录 · ' + Object.keys(data.evidence?.history.byProduct ?? {}).length + ' 项'}</Button><Button variant="glass" onClick={() => browse('exchange')}>资源兑换 · {entranceProducts(data, 'exchange').length} 项</Button><Button variant="ghost" onClick={() => browse('unverified')}>入口待核验 · {entranceProducts(data, 'unverified').length} 项</Button><Button variant="ghost" onClick={() => browse()}>查看完整清单</Button></div>
      {resources.length && onOpenBoard ? <details className="commerce-documents"><summary>设计讨论与资料 · {resources.length} 份</summary><div className="commerce-row">{resources.map(b => <Button key={b.id} variant="glass" size="sm" onClick={() => onOpenBoard(b.id)}>{b.title.replace(/^\d+(?:\.\d+)*\s+/, '')}</Button>)}</div></details> : null}
      <LedgerCoverage data={data} />
      <details className="commerce-source"><summary>数据覆盖与维护说明</summary><p>{data.products.filter(isCatalogProduct).length} 项商品与兑换定义；{data.products.filter(p => !isCatalogProduct(p)).length} 条旧引用、待对应充值档位或空壳礼包已移出商品浏览，证据仍保留。没有购买记录的有效商品不会因此隐藏。</p><p>{data.scope}</p><p>随机商店条目是候选；玩法内次数购买等尚未整理成商品的消耗点不在本轮清单。</p><p>{report ? report.coverage : data.evidence?.history.population ?? '历史数据尚未接入。'} 历史为保存后的快照，并非实时后台。</p><p>投放入口与需求比较使用同一批记录。配置、图片与历史从原资料更新；本页为快照，暂未自动同步。</p></details>
    </> : null}
    {view === 'list' ? <>
      <div className="commerce-filters"><label>找商品或资源<Input aria-label="找商品、资源或编号" value={query} placeholder="招募券、204、月卡…" onChange={e => resetLimit(() => setQuery(e.currentTarget.value))} /></label><label>支付方式<Select aria-label="支付方式" value={kind} onChange={value => resetLimit(() => setKind(value))} options={[{ value: 'all', label: '全部支付方式' }, ...Object.entries(paymentNames).map(([value, label]) => ({ value, label }))]} /></label><label>具体投放形式<Select aria-label="投放形式" value={channel} onChange={value => resetLimit(() => setChannel(value))} options={[{ value: 'all', label: '全部投放形式' }, ...channels.map(value => ({ value, label: value }))]} /></label><Button variant="ghost" disabled={!hasProductFilters} title={hasProductFilters ? '清除商品条件，保留历史区服' : '当前没有商品筛选'} onClick={() => { toast.success('已清除商品筛选，历史区服保持不变'); setKind('all'); setChannel('all'); setQuery(''); setNeed('all'); setHistoryOnly(false); setDifferencesOnly(false); setLimit(18) }}>清除商品筛选</Button></div>
      {compare ? <section className="commerce-comparison"><label>选择玩家需求<Select aria-label="玩家需求" value={need} onChange={value => resetLimit(() => setNeed(value))} options={[{ value: 'all', label: '全部需求分组' }, ...data.needs.map(n => ({ value: n.id, label: n.name }))]} /></label><div><Tag color="warning">按资源用途归类 · 需求待确认</Tag><p>{currentNeed?.question ?? '选择一个需求，比较不同入口、不同支付方式的商品。'}</p><p className="commerce-muted">{currentNeed?.why ?? '分组根据资源与投放形式整理，不代表已确认的购买动机。'}</p></div></section> : null}
      <div className="commerce-list-toolbar">
        <div><p aria-live="polite">找到 {products.length} 项 · 已展示 {Math.min(limit, products.length)} 项{report ? ` · 所选区服有记录 ${visibleHistoryCount} 项` : ''}</p>{report ? <p className="commerce-muted">{historyOnly ? '已筛选：只显示所选区服有历史记录的商品。' : '切换区服会更新实得奖励与历史验证；勾选右侧选项可同时筛商品。'}</p> : null}</div>
        {report ? <div className="commerce-list-scope"><RevenueScope report={report} group={revenueGroup} onChange={value => resetLimit(() => setRevenueGroup(value))} /><Checkbox checked={historyOnly} onCheckedChange={value => resetLimit(() => setHistoryOnly(value))}>只看有记录的商品</Checkbox></div> : <p className="commerce-muted">商品级设计意图仍待确认；待核验项保留在清单。</p>}
      </div>
      {report ? <HistoryScopeNotice data={data} group={revenueGroup} /> : null}
      {data.evidence?.ledger ? <div className="commerce-row"><Checkbox checked={differencesOnly} onCheckedChange={value=>resetLimit(()=>setDifferencesOnly(value))}>只看配置与流水差异 / 待核全</Checkbox></div> : null}
      <div className="commerce-product-table"><Table<CommerceProduct> aria-label="商品清单" size="sm" rowKey="key" data={products.slice(0, limit)} columns={[
        { key: 'product', title: '商品 / 投放', width: '19%', render: p => <div className="commerce-product-name"><strong>{productName(p)}</strong><span className="commerce-muted">{p.channel === '通关礼包' ? '关卡礼包（配置名：通关礼包）' : p.channel} · {p.sku}</span><ProductAudit data={data} product={p} compact /></div> },
        { key: 'rewards', title: '奖励 / 实际核对', width: '32%', render: p => <ProductFacts data={data} product={p} group={revenueGroup} compact /> },
        { key: 'price', title: '价格', width: '13%', render: p => <div className="commerce-table-status"><strong className="commerce-table-price">{productFacts(data,p,revenueGroup).price}</strong><span className="commerce-muted">{productFacts(data,p,revenueGroup).prices.length>0 ? '流水实扣' : '配置价格'}</span></div> },
        { key: 'limit', title: '限购 / 周期（配置）', width: '15%', dataIndex: 'limit' },
        { key: 'evidence', title: report ? `历史验证 · ${revenueGroupNames[revenueGroup] ?? revenueGroup}` : '历史验证', width: '13%', render: p => { const result = productRevenue(data, p, revenueGroup), logs = ledgerRows(data, p, revenueGroup).purchases, facts=productFacts(data,p,revenueGroup); return <div className="commerce-table-status">{p.status !== 'defined' ? <Tag color="warning">明细待核验</Tag> : null}{result ? <><strong>{yuan(result.yuan)} 商品订单金额</strong><span className="commerce-muted">{result.orders} 笔 · 含代金券订单 · 拆分见详情</span></> : logs.length ? <><strong>{logs.reduce((n,r)=>n+r.orders,0)} 笔钻石购买</strong><span className="commerce-muted">已知角色范围 · 见详情</span></> : facts.claimOnly ? <><strong>{facts.orders} 笔领取记录</strong><span className="commerce-muted">免费 / 广告类型待核</span></> : report ? <span className="commerce-muted">{p.rid ? '本范围未见记录' : p.kind === 'cash' || p.status !== 'defined' ? '商品对应待核验' : data.evidence?.ledger && p.kind === 'diamond' ? ledgerRows(data, p, revenueGroup).giftCovered ? '本批未见购买（非全量）' : '所选区服尚未接入流水' : '业务流水待接入'}</span> : data.evidence?.history.byProduct[p.key] ? <Tag color="success">有历史记录</Tag> : <span className="commerce-muted" title={missingHistoryReason(p, data.evidence)}>历史未关联</span>}</div> } },
        { key: 'open', title: '详情', width: '8%', render: p => <Button ref={p.key === nextProductKey.current ? nextProduct : undefined} variant="ghost" size="sm" onClick={() => select(p)} aria-label={`查看 ${p.title} ${p.sku}`}>查看 <ArrowRight size={14} /></Button> },
      ]} /></div>
      {!products.length ? <Empty title="当前条件没有匹配商品" description={historyOnly ? '可取消“只看有记录的商品”，查看配置中的商品；未见记录不等于没有购买。' : '可以清除商品筛选，或返回总览搜索全部商品。'} /> : null}
      {products.length > limit ? <Button variant="glass" onClick={() => { nextProductKey.current = products[limit]?.key; setLimit(limit + 24); toast.success(`已追加 ${Math.min(24, products.length - limit)} 项，已定位到第一项新增商品`) }}>继续展示（剩余 {products.length - limit} 项）</Button> : null}
    </> : null}
    {view === 'revenue' ? <CommerceRevenueView data={data} group={revenueGroup} onChange={setRevenueGroup} onSelect={select} /> : null}
    {view === 'detail' && selected ? <CommerceProductDetail key={selected.key} data={data} product={selected} group={revenueGroup} onGroup={setRevenueGroup} onSelect={select} onCompare={id => browse('all', { compare: true, need: id })} onOpenBoard={onOpenBoard} /> : null}
  </section>
}

function CommerceProductDetail({ data, product, group, onGroup, onSelect, onCompare, onOpenBoard }: { data: CommerceDataset; product: CommerceProduct; group: string; onGroup(value: string): void; onSelect(p: CommerceProduct): void; onCompare(id: string): void; onOpenBoard?: ((id: string) => void) | undefined }) {
  const primaryNeed = data.needs.find(n => n.id === product.needs[0]), similar = relatedProducts(data, product)
  const intent = intentFor(product, data), report = data.evidence?.revenue
  return <section className="commerce-detail" aria-label="所选商品详情">
    <div className="commerce-chain">
      <Card padding="md"><h3>01 设计预期 →</h3><Tag color="warning">商品级设计意图待确认</Tag><strong>{intent.need}</strong><p>{primaryNeed?.question ?? '对应的玩家需求待补充'}</p><p className="commerce-label">预期行为 · 候选</p><p>{intent.behavior}</p><p className="commerce-label">建议验证</p><p>{intent.verification}</p><div className="commerce-validation-status"><strong>还需确定</strong><span>玩家阶段、免费来源与付费分工；成功指标和目标值。</span></div><div className="commerce-row">{product.needs.filter(id => id !== 'unknown').map(id => <Button key={id} size="sm" variant="glass" onClick={() => onCompare(id)}>比较{data.needs.find(n => n.id === id)?.name}</Button>)}</div></Card>
      <Card padding="md"><h3>02 配置与实际 →</h3><div className="commerce-row"><Tag>{paymentNames[product.kind]}</Tag>{product.status !== 'defined' ? <Tag color="warning">商品信息待核验</Tag> : null}</div><ProductAudit data={data} product={product} /><p className="commerce-price">{productFacts(data,product,group).price}</p><ProductFacts data={data} product={product} group={group}/>{product.extraRewards?.length ? <p>{product.channel === '月卡' ? '即时奖励' : '额外 / 首充奖励'}：{product.extraRewards.map(a => a.name + ' × ' + a.n).join('、')}</p> : null}<p>配置限购：{product.limit}</p><GamePlacement evidence={data.evidence} product={product} /><details><summary>配置说明</summary><p>{product.note || '无额外配置说明。'}</p></details></Card>
      <Card padding="md"><h3>03 数据验证</h3>{report ? <><RevenueScope report={report} group={group} onChange={onGroup} /><TestProductResults data={data} product={product} group={group} /></> : <HistoryMetrics evidence={data.evidence} product={product} />}</Card>
    </div>
    <section className="commerce-related"><h3>相同资源 / 需求下的其他商品</h3><div className="commerce-related-grid">{similar.slice(0, 6).map(p => <Card padding="sm" key={p.key}><p className="commerce-label">{relatedReason(product, p, data)}</p><h3>{p.title}</h3><ProductFacts data={data} product={p} group={group} compact/><p>{productFacts(data,p,group).price} · 配置限购：{p.limit}</p><Button variant="ghost" size="sm" onClick={() => onSelect(p)} aria-label={`查看同类商品 ${p.title} ${p.sku}`}>查看这项商品</Button></Card>)}</div>{primaryNeed && primaryNeed.id !== 'unknown' ? <Button variant="ghost" size="sm" onClick={() => onCompare(primaryNeed.id)}>查看该需求分组下的全部商品</Button> : null}{!similar.length ? <p className="commerce-muted">暂无可核对的同类商品。</p> : null}</section>
    {!data.evidence?.ledger && data.evidence?.history.byProduct[product.key] ? <details className="commerce-source"><summary>补充证据：S102 / S103 角色样本订单（不计入上方全期汇总）</summary><HistoryMetrics evidence={data.evidence} product={product} /><HistoryDetails evidence={data.evidence} product={product} /></details> : null}
    <details className="commerce-source"><summary>配置来源与原设计资料</summary><p>商品身份：{product.key} · 商品编号：{product.sku} · 充值档位：{product.rid ?? '无'}</p><p>{data.sources[product.source]?.name}{product.row ? ` · Sheet1 第 ${product.row} 行` : ''}</p><code>{data.sources[product.source]?.path}</code><p>配置版本 {data.sources[product.source]?.revision ?? '待核验'} · 核对于 {data.sources[product.source]?.checkedAt ?? data.created} · 源文件摘要 {data.sources[product.source]?.sha256.slice(0, 12)}…</p><p>配置在原文件中维护；当前页面使用导入快照，未自动同步。</p>{product.board && onOpenBoard ? <Button variant="glass" size="sm" onClick={() => onOpenBoard(product.board!.id)}>打开原商品画板</Button> : null}</details>
  </section>
}
