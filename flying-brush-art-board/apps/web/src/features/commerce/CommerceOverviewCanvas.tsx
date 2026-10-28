import { createContext, useContext, useState, type ReactNode } from 'react'
import { HTMLContainer, useValue, type Editor, type TLGeoShape, type TLShapeId, type TLStore } from 'tldraw'
import { Button, Drawer, Input, Select, Tag, toast } from '@ttqtt/liquid-glass-react'
import { commerceEntrances, entranceFor, entranceProducts } from './commerce-browse'
import { filterProducts, type CommerceDataset, type CommerceProduct } from './commerce-data'
import { GameItemIcon, GamePlacement } from './CommerceEvidenceView'
import { ProductFacts } from './CommerceFactsView'
import { TestProductResults } from './CommerceRevenueView'
import { productFacts } from './commerce-facts'
import { yuan } from './commerce-revenue'
import { CommercePagedTable } from './CommercePagedTable'
import { readDesignCard, updateDesignCard } from './commerce-design-map'
import { entranceDesign, entranceHistory, readEntranceCard, toggleEntrance, type DesignFields } from './commerce-overview-model'
import { CommerceDesignEditor } from './CommerceDesignEditor'

type Panel = { kind: 'design'; shapeId: TLShapeId } | { kind: 'products'; entrance: string; need?: string; query?: string } | { kind: 'product'; key: string; entrance: string; need?: string; query?: string }
type OverviewContextValue = { data?: CommerceDataset | undefined; error: string; store: TLStore; editor(): Editor | undefined; canEdit(): boolean; open(panel: Panel): void }
const OverviewContext = createContext<OverviewContextValue | undefined>(undefined)

export function CommerceOverviewProvider({ data, error, store, editor, canEdit, onOpenSource, children }: Omit<OverviewContextValue, 'open'> & { onOpenSource?: ((id: string) => void) | undefined; children: ReactNode }) {
  const [panel, setPanel] = useState<Panel>()
  const shape = useValue('overview design selection', () => panel?.kind === 'design' ? store.get(panel.shapeId) as TLGeoShape | undefined : undefined, [store, panel])
  const card = readEntranceCard(shape), design = useValue('overview linked design', () => card ? entranceDesign(store, card) : undefined, [store, card])
  const entry = commerceEntrances.find(e => e.id === (panel?.kind === 'design' ? card?.entrance : panel?.entrance))
  const product = panel?.kind === 'product' ? data?.products.find(p => p.key === panel.key) : undefined
  const save = (change: DesignFields, expected: DesignFields) => {
    const current = editor(), latest = shape && current?.getShape<TLGeoShape>(shape.id), latestCard = readEntranceCard(latest)
    if (!current || !latest || !latestCard || !canEdit()) { toast.error('当前画板不可编辑'); return }
    const now = entranceDesign(store, latestCard)
    if (!now || JSON.stringify(pickDesign(now)) !== JSON.stringify(expected)) { toast.error('设计已被更新，请重新展开后编辑'); return }
    current.markHistoryStoppingPoint('edit-overview-design')
    if (latestCard.designRef) {
      const target = current.getShape<TLGeoShape>(latestCard.designRef as TLShapeId)
      if (!target || !readDesignCard(target)) { toast.error('关联设计已移除'); return }
      current.updateShapes([updateDesignCard(target, change)])
    } else current.updateShapes([{ id: latest.id, type: 'geo', meta: { ...latest.meta, commerceEntrance: { ...latestCard, design: change } } }])
    toast.success('设计已保存'); setPanel(undefined)
  }
  return <OverviewContext.Provider value={{ data, error, store, editor, canEdit, open: setPanel }}>
    {children}
    <Drawer open={!!panel} onOpenChange={open => { if (!open) setPanel(undefined) }} placement="right" size={panel?.kind === 'products' ? 780 : 600} title={panel?.kind === 'design' ? `设计 · ${entry?.name ?? ''}` : panel?.kind === 'product' ? product?.title ?? '商品引用失效' : panel?.need ? '共同需求 · 跨入口比较' : `${entry?.name ?? '全部'} · 商品与验证`}>
      <div className="design-map-details">
        {error ? <Tag color="warning">引用未更新，当前为上次读取值</Tag> : null}
        {panel?.kind === 'design' ? design ? <CommerceDesignEditor key={panel.shapeId} value={pickDesign(design)} onSave={save} /> : <p>原设计已移除，需恢复关联。</p> : !data ? <p>{error || '正在读取商品与历史…'}</p> : panel?.kind === 'products' ? <OverviewProducts key={`${panel.entrance}:${panel.need ?? ''}`} data={data} entrance={panel.entrance} initialNeed={panel.need} initialQuery={panel.query} onSelect={(p, need, query) => setPanel({ kind: 'product', key: p.key, entrance: panel.entrance, query, ...(need !== 'all' ? { need } : {}) })} /> : product ? <>
          <Button size="sm" variant="ghost" onClick={() => setPanel({kind:'products',entrance:panel!.kind === 'product' ? panel!.entrance : 'all',...(panel?.kind === 'product' && panel.need ? {need:panel.need} : {}), ...(panel?.kind === 'product' && panel.query ? {query:panel.query} : {})})}>← 返回商品清单</Button>
          <div><Tag>{entranceFor(product).name}</Tag><h3>{product.title} <span>{productFacts(data, product).price}</span></h3><small>{product.channel} · {product.sku} · 配置核对 {data.created}</small></div>
          {product.channel === '首充' || product.channel === '月卡' ? <strong>{product.channel === '首充' ? '分日奖励合计' : '每日奖励'}</strong> : null}
          <ProductFacts data={data} product={product} />
          {product.extraRewards?.length ? <p>购买即时：{product.extraRewards.map(r => `${r.name} × ${r.n}`).join('、')}</p> : null}
          <p>{product.limit}</p>{product.note ? <details><summary>商品说明</summary><p>{product.note}</p></details> : null}
          <GamePlacement evidence={data.evidence} product={product} />
          <section><h3>历史验证</h3><TestProductResults data={data} product={product} group="all" />{!data.evidence?.revenue ? <p>历史统计尚未接入。</p> : null}</section>
          <div><h3>共同需求</h3><p className="commerce-muted">按资源用途关联，购买动机待确认。</p>{data.needs.filter(n => n.id !== 'unknown' && product.needs.includes(n.id)).map(n => <Button key={n.id} size="sm" variant="ghost" onClick={() => setPanel({kind:'products',entrance:'all',need:n.id})}>{n.name} ↗</Button>)}</div>
          {product.board && onOpenSource ? <Button variant="ghost" onClick={() => onOpenSource(product.board!.id)}>原设计资料 ↗</Button> : null}
        </> : <p>商品已移除或引用已失效，请核对商品总览。</p>}
      </div>
    </Drawer>
  </OverviewContext.Provider>
}

const pickDesign = (d: DesignFields): DesignFields => ({title:d.title,goal:d.goal,measure:d.measure,decision:d.decision})
const shortScope = (s: {from:string;through:string;servers:number[]} | undefined) => s ? `${s.from.slice(5)}—${s.through.slice(5)} · ${s.servers.length}服 · 已知角色` : '范围待补'

export function CommerceEntranceShape({ shape }: { shape: TLGeoShape }) {
  const context = useContext(OverviewContext), card = readEntranceCard(shape)!
  const design = useValue('entrance design', () => context ? entranceDesign(context.store, card) : undefined, [context?.store, card])
  if (!context) return <HTMLContainer><div>请在商业设计画板中打开此分组。</div></HTMLContainer>
  const { data, error, editor, canEdit, open } = context, entry = commerceEntrances.find(e => e.id === card.entrance)!
  const history = data ? entranceHistory(data, card.entrance) : undefined, products = history?.products ?? []
  const needs = data?.needs.filter(n => n.id !== 'unknown' && products.some(p => p.needs.includes(n.id))) ?? []
  const seenChannels = new Set<string>()
  const examples = [...products.filter(p=>p.kind==='cash'||p.kind==='diamond'),...products].filter(p=>{if(seenChannels.has(p.channel))return false;seenChannels.add(p.channel);return true}).slice(0,3)
  const rewards = [...new Map(products.flatMap(p => p.rewards).map(r => [r.id,r])).values()].slice(0,3)
  const act = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn() }
  const browse = () => open({kind:'products',entrance:card.entrance})
  return <HTMLContainer><article className={`commerce-entrance-shape${card.expanded ? ' is-expanded' : ''}`} aria-label={`${entry.name}分组`} style={{width:shape.props.w,height:shape.props.h}}>
    <header><h2>{entry.name}</h2><span>{data ? `${products.length} 项` : '读取中…'}</span><div>{rewards.map(r => <GameItemIcon key={r.id} evidence={data?.evidence} id={r.id} name={r.name} />)}</div></header>
    {card.expanded ? <div className="commerce-chain-columns">
      <section className="commerce-chain-design"><h3>设计 <small>{design?.decision === 'confirmed' ? '已确认' : '待确认'}</small></h3><h4>{design?.title ?? '设计引用待恢复'}</h4><p>{design?.goal}</p><p className="commerce-chain-muted">{design?.measure}</p><Button size="sm" variant="ghost" onPointerDown={e=>e.stopPropagation()} onClick={act(()=>open({kind:'design',shapeId:shape.id}))}>编辑设计</Button>
        <div className="commerce-chain-needs"><small>共同需求 · 候选关联</small>{needs.slice(0,3).map(n=><Button size="sm" variant="ghost" key={n.id} onPointerDown={e=>e.stopPropagation()} onClick={act(()=>open({kind:'products',entrance:'all',need:n.id}))}>{n.name} ↗</Button>)}</div>
      </section>
      <span className="commerce-chain-arrow">→</span>
      <section className="commerce-chain-implementation"><h3>实现 <small>引用现有商品</small></h3><p>{entry.description}</p>{data ? examples.map(p=><div className="commerce-chain-product" key={p.key}><span>{p.rewards[0] ? <GameItemIcon evidence={data.evidence} id={p.rewards[0].id} name={p.rewards[0].name} /> : null}{p.title}</span><strong>{productFacts(data,p).price}</strong></div>) : <p>正在读取…</p>}<Button size="sm" variant="ghost" onPointerDown={e=>e.stopPropagation()} onClick={act(browse)}>查看全部 {products.length} 项 →</Button>
        {card.entrance === 'benefits' || card.entrance === 'first' ? <Button size="sm" variant="ghost" onPointerDown={e=>e.stopPropagation()} onClick={act(()=>{const ed=editor(); if(!ed)return; const id=`shape:rhythm-${card.entrance==='first'?'first':'monthly'}-design` as TLShapeId, target=ed.getShape(id); if(!target){toast.error('原专题已移除');return} ed.setCurrentPage(target.parentId as Parameters<Editor['setCurrentPage']>[0]); ed.zoomToFit({animation:{duration:200}})})}>{card.entrance==='first'?'首充':'月卡'}专题 ↗</Button> : null}
      </section>
      <span className="commerce-chain-arrow">→</span>
      <section className="commerce-chain-validation"><h3>验证 <small>效果待验证</small></h3><p><strong>{history?.cash === undefined ? '—' : yuan(history.cash)}</strong> 现金 · {history?.cash === undefined ? '—' : history.cashOrders} 笔</p><p className="commerce-chain-muted">代金券订单 {history?.cash === undefined ? '—' : yuan(history.voucher)}<br/>{shortScope(data?.evidence?.ledger?.orderScope)}</p><p><strong>{history?.diamonds === undefined ? '—' : history.diamonds.toLocaleString('zh-CN')}</strong> 钻石 · {history?.diamonds === undefined ? '—' : history.diamondOrders} 笔</p><p className="commerce-chain-muted">{shortScope(data?.evidence?.ledger?.giftScope)}</p><p className="commerce-chain-gap">缺曝光与购后行为；成功标准待确认。</p><Button size="sm" variant="ghost" onPointerDown={e=>e.stopPropagation()} onClick={act(browse)}>逐商品核对 →</Button></section>
    </div> : <div className="commerce-entrance-preview">
      <div><b>设计</b><span>{design?.title ?? '设计引用待恢复'}<small>{design?.decision==='confirmed'?'已确认':'待确认'}</small></span></div>
      <div><b>实现</b><span>{entry.description}</span></div>
      <div><b>验证</b><span>{data?.evidence?.ledger && history ? `${history.recordedProducts} 项有逐单记录` : '逐单记录待接入'}<small>{history?.cash !== undefined ? `现金 ${yuan(history.cash)}` : products.some(p=>p.kind==='cash'||p.rid) ? '现金待核对' : '钻石商品'}{history?.diamonds !== undefined ? ` · 钻石 ${history.diamondOrders} 笔` : ''}</small></span></div>
    </div>}
    <footer><small className={error?'design-map-error':''}>{error?'引用未更新 · 上次读取值':card.expanded?'历史为已接入范围；不据订单认定设计达成':'已知角色记录 · 范围见展开'}</small><Button size="sm" variant="ghost" aria-label={`${card.expanded?'收起':'展开'}${entry.name}链路`} onPointerDown={e=>e.stopPropagation()} onClick={act(()=>{const ed=editor(); if(ed&&canEdit())toggleEntrance(ed,shape.id);else toast.error('当前画板不可编辑')})}>{card.expanded?'收起 ↖':'展开链路 ↗'}</Button></footer>
  </article></HTMLContainer>
}

export function OverviewOtherEntries() {
  const context = useContext(OverviewContext)
  if (!context?.data) return null
  return <><Button size="sm" variant="ghost" onClick={()=>context.open({kind:'products',entrance:'all',need:'all'})}>共同需求</Button>{['exchange','unverified'].map(id=><Button size="sm" variant="ghost" key={id} onClick={()=>context.open({kind:'products',entrance:id})}>{id==='exchange'?'资源兑换':'入口待核验'} · {entranceProducts(context.data!,id).length}</Button>)}</>
}

function OverviewProducts({ data, entrance, initialNeed, initialQuery, onSelect }: {data:CommerceDataset;entrance:string;initialNeed?:string|undefined;initialQuery?:string|undefined;onSelect(p:CommerceProduct,need:string,query:string):void}) {
  const [query,setQuery]=useState(initialQuery ?? ''),[need,setNeed]=useState(initialNeed ?? 'all')
  const products=filterProducts({...data,products:entranceProducts(data,entrance)},need,'all','all',query), currentNeed=data.needs.find(n=>n.id===need)
  return <><div className="commerce-overview-filters"><Input aria-label="搜索分组商品" placeholder="找商品、资源或编号" value={query} onChange={e=>setQuery(e.currentTarget.value)}/><Select aria-label="共同需求" value={need} onChange={setNeed} options={[{value:'all',label:'全部需求'},...data.needs.map(n=>({value:n.id,label:n.name}))]}/></div>{currentNeed ? <p>{currentNeed.question}<br/><small>按资源用途关联，购买动机待确认。</small></p> : null}
    <CommercePagedTable scope={`${entrance}:${need}:${query}`} aria-label="分组商品清单" size="sm" rowKey="key" pageSize={8} data={products} columns={[
      {key:'name',title:'商品 / 入口',width:'29%',render:p=><div><strong>{p.title}</strong><br/><small>{entranceFor(p).name} · {p.channel} · {p.sku}</small></div>},
      {key:'reward',title:'奖励',width:'34%',render:p=><div className="commerce-overview-list-rewards">{productFacts(data,p).rewards.slice(0,3).map(r=><span key={r.id}><GameItemIcon evidence={data.evidence} id={r.id} name={r.name}/>{r.name} × {r.n}</span>)}{productFacts(data,p).rewards.length>3?<small>更多见详情</small>:null}</div>},
      {key:'price',title:'价格',render:p=>productFacts(data,p).price},
      {key:'open',title:'',render:p=><Button size="sm" variant="ghost" aria-label={`查看商品 ${p.key}`} onClick={()=>onSelect(p,need,query)}>查看 →</Button>},
    ]}/></>
}
