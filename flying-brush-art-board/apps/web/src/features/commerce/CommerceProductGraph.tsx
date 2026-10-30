import { productPlacement } from './commerce-catalog'
import { useEffect, useRef, useState, type ComponentProps } from 'react'
import { HTMLContainer, useValue, type TLGeoShape, type TLPage, type TLShapeId } from 'tldraw'
import { Button, Drawer, Input, Select, toast } from '@ttqtt/liquid-glass-react'
import { commerceEntrances, entranceFor } from './commerce-browse'
import { GameItemIcon } from './CommerceEvidenceView'
import { browseProductGraph, useCommerceOverview } from './CommerceOverviewCanvas'
import { arrangeProductGraph, focusProductGraph, graphFacts, graphProducts, growProductGraphCard, resourceProductCount, productHistorySummary, readProductGraphNode, readProductGraphPage, productAnnotation, saveProductAnnotation, type ProductAnnotation } from './commerce-product-graph'
import { readEntranceCard, showCommerceOverview } from './commerce-overview-model'
import { CommerceDesignEditor } from './CommerceDesignEditor'

// Portal events still bubble through the shape's React tree. Keep the drawer
// header and backdrop out of tldraw's pointer capture as well as its form body.
function CanvasDrawer(props:ComponentProps<typeof Drawer>){
  return <div onPointerDown={e=>e.stopPropagation()} onPointerUp={e=>e.stopPropagation()} onClick={e=>e.stopPropagation()}><Drawer {...props}/></div>
}

function useCardContentSize(shape:TLGeoShape){
  const c=useCommerceOverview(),ref=useRef<HTMLElement>(null)
  useEffect(()=>{
    const element=ref.current
    if(!element||!c?.data||typeof ResizeObserver==='undefined')return
    let frame=0
    const observer=new ResizeObserver(()=>{
      cancelAnimationFrame(frame)
      frame=requestAnimationFrame(()=>{
        const ed=c.editor()
        if(ed&&c.canEdit())growProductGraphCard(ed,shape.id,element.offsetHeight)
      })
    })
    observer.observe(element)
    return()=>{observer.disconnect();cancelAnimationFrame(frame)}
  },[c?.store,c?.data,shape.id])
  return ref
}

export function CommerceProductGraphToolbar({onRefresh,busy}:{onRefresh():void;busy:boolean}) {
  const c=useCommerceOverview()
  const page=useValue('product graph toolbar',()=>{const id=c?.store.query.records('instance').get()[0]?.currentPageId;return id?c?.store.get(id) as TLPage:undefined},[c?.store])
  const s=readProductGraphPage(page)
  if(!c?.data||!s)return null
  const data=c.data, products=graphProducts(data,s), all=graphProducts(data,{...s,need:'all'})
  const resource=s.resource===undefined?undefined:data.products.flatMap(p=>graphFacts(data,p).rewards).find(r=>r.id===s.resource)?.name??String(s.resource)
  return <div className="commerce-graph-toolbar" role="region" aria-label="商品链路导航">
    <Button size="sm" variant="ghost" onClick={()=>{const ed=c.editor();if(ed)showCommerceOverview(ed,c.canEdit())}}>商业总览</Button>
    <Select aria-label="商品画板入口" value={s.entrance} options={[{value:'all',label:'跨入口比较'},...commerceEntrances.map(e=>({value:e.id,label:e.name}))]} onChange={entrance=>browseProductGraph(c,{...s,entrance,need:'all'})}/>
    <Select aria-label="商品画板玩家需求" value={s.need} options={[{value:'all',label:'全部玩家需求'},...data.needs.filter(n=>all.some(p=>p.needs.includes(n.id))).map(n=>({value:n.id,label:`${n.name} · ${all.filter(p=>p.needs.includes(n.id)).length}`}))]} onChange={need=>browseProductGraph(c,{...s,need})}/>
    <Select searchable aria-label="定位商品卡" value="" options={[{value:'',label:`定位商品 · ${products.length} 项`},...products.map(p=>({value:p.key,label:`${p.title} · ${p.sku}`}))]} onChange={key=>{const ed=c.editor(),shape=ed?.getCurrentPageShapes().find(v=>readProductGraphNode(v)?.kind==='product'&&readProductGraphNode(v)?.key===key),bounds=shape&&ed?.getShapePageBounds(shape);if(bounds)ed?.zoomToBounds(bounds,{inset:128,animation:{duration:200}})}}/>
    <Button size="sm" variant="ghost" onClick={()=>{const ed=c.editor();if(ed)focusProductGraph(ed)}}>回到链路开头</Button>
    <Button size="sm" variant="ghost" onClick={()=>{const ed=c.editor();if(ed&&c.canEdit())arrangeProductGraph(ed,data,s)}}>整理商品布局</Button>
    <Button size="sm" variant="ghost" disabled={busy} onClick={onRefresh}>{busy?'读取中…':'刷新引用'}</Button>
    {s.resource!==undefined?<Button size="sm" variant="ghost" onClick={()=>browseProductGraph(c,{entrance:s.entrance,need:s.need})}>同资源：{resource} · 取消筛选 ×</Button>:null}
    <small>{c.error?'引用未更新 · 显示上次值':'连线表示同需求'}</small>
    {!products.length?<span role="status">此范围没有符合条件的商品</span>:null}
  </div>
}

export function CommerceProductGraphShape({shape}:{shape:TLGeoShape}) {
  const c=useCommerceOverview(),node=readProductGraphNode(shape)!
  const contentRef=useCardContentSize(shape)
  const page=useValue('product graph selector',()=>{const parent=c?.store.get(shape.parentId) as TLPage|undefined;return readProductGraphPage(parent)?parent:c?.store.get(node.owner as TLPage['id']) as TLPage|undefined},[c?.store,shape.parentId,node.owner])
  const annotation=useValue('product history annotation',()=>c&&productAnnotation(c.store,node.key),[c?.store,node.key])
  const [annotating,setAnnotating]=useState(false)
  if(!c?.data)return <HTMLContainer><div className="commerce-product-node">正在读取商品与历史…</div></HTMLContainer>
  const data=c.data,s=readProductGraphPage(page)??{entrance:'all',need:'all'}
  const act=(fn:()=>void)=>(e:React.MouseEvent)=>{e.stopPropagation();fn()}
  const pointer=(e:React.PointerEvent)=>e.stopPropagation()
  const style={width:shape.props.w,minHeight:shape.props.h}
  if(node.kind==='need')return <CommerceNeedNode shape={shape}/>
  const p=data.products.find(p=>p.key===node.key)
  if(!p)return <HTMLContainer><article className="commerce-product-node" style={style}><h3>商品引用已移除</h3><p>{node.key}</p></article></HTMLContainer>
  const facts=graphFacts(data,p),history=productHistorySummary(data,p), needs=data.needs.filter(n=>p.needs.includes(n.id))
  const [price,...priceRules]=facts.price.split(/[；;]/)
  const title=p.title.replace(`${p.channel} · `,'').replace(/^资源兑换 · /,'')
  const sameResource=facts.rewards.filter(r=>![300001,300003].includes(r.id)).map(r=>({r,count:resourceProductCount(data,r.id)})).filter(r=>r.count>1)
  const source=()=>c.open({kind:'product',key:p.key,entrance:s.entrance,canvas:true})
  return <HTMLContainer><article ref={contentRef} className="commerce-product-node" aria-label={`商品卡 ${p.key}`} style={style}>
    <header><small>{entranceFor(p).name} · {productPlacement(p)} · {p.sku}</small><h2>{title}</h2><div className="commerce-product-price"><strong>{price}</strong>{priceRules.length?<small>{priceRules.join('；')}</small>:null}</div></header>
    <div className="commerce-product-need"><b>需求</b><span>{needs.map(n=>n.name).join('、')||'待补'}<small>候选关联</small></span></div>
    <div className="commerce-product-rewards"><b>{p.channel==='月卡'?'每日获得':p.channel==='首充'?'分日奖励合计':'获得'}</b><div>{facts.rewards.map((r,i)=><span key={`${r.id}:${i}`}><GameItemIcon evidence={data.evidence} id={r.id} name={r.name}/>{r.name} × {r.n}</span>)}{p.extraRewards?.length?<small>购买即时：{p.extraRewards.map(r=>`${r.name} × ${r.n}`).join('、')}</small>:null}</div></div>
    <p className="commerce-product-limit">{p.limit}</p>
    {annotation?<span className="commerce-node-status" title={annotation.detail}>{annotation.label} · {annotation.confirmed?'原因已确认':'待核验'}</span>:facts.prices.length>1?<span className="commerce-node-status">历史存在多个价格 · 原因待核验</span>:facts.difference?<span className="commerce-node-status">源表与流水不同 · 按记录展示</span>:null}
    {facts.incomplete||facts.varied||!facts.hasRecords?<span className="commerce-node-status">{facts.incomplete?'到账明细不完整 · 奖励暂按配置':facts.varied?'到账奖励有多个版本':'价格与奖励为配置快照'}</span>:null}
    <section className="commerce-product-history"><small>历史表现</small><strong>{history.primary}</strong><span>{history.secondary}</span>{c.error?<em>引用未更新，显示上次读取值</em>:null}</section>
    <footer><div>{sameResource.map(({r,count})=><Button key={r.id} size="sm" variant="ghost" onPointerDown={pointer} onClick={act(()=>browseProductGraph(c,{entrance:'all',need:'all',resource:r.id}))}>同资源 · {r.name} · {count}项 ↗</Button>)}</div><div><Button size="sm" variant="ghost" onPointerDown={pointer} onClick={act(source)}>查来源 ↗</Button><Button size="sm" variant="ghost" onPointerDown={pointer} onClick={act(()=>setAnnotating(true))}>{annotation?'查看异常标记':'标记异常'}</Button></div></footer>
    <CanvasDrawer open={annotating} onOpenChange={setAnnotating} title={`异常标记 · ${p.title}`} placement="right" size={560}><ProductAnnotationForm key={String(annotating)} value={annotation} onSave={(value,expected)=>{const ed=c.editor();if(!ed||!c.canEdit()){toast.error('当前画板不可编辑');return}if(JSON.stringify(productAnnotation(c.store,p.key))!==JSON.stringify(expected)){toast.error('标记已更新，请重新打开');return}saveProductAnnotation(ed,p.key,value);setAnnotating(false);toast.success('异常标记已保存，同商品各处共用')}}/></CanvasDrawer>
  </article></HTMLContainer>
}

function ProductAnnotationForm({value,onSave}:{value:ProductAnnotation|undefined;onSave(value:ProductAnnotation,expected:ProductAnnotation|undefined):void}){
  const expected=useRef(value)
  const [label,setLabel]=useState(value?.label??''),[detail,setDetail]=useState(value?.detail??''),[confirmed,setConfirmed]=useState(value?.confirmed??false)
  return <div className="design-map-form" onPointerDown={e=>e.stopPropagation()} onPointerUp={e=>e.stopPropagation()} onClick={e=>e.stopPropagation()} onKeyDown={e=>e.stopPropagation()}><label>异常类型<Input value={label} onChange={e=>setLabel(e.currentTarget.value)}/></label><label>原因与范围<Input value={detail} onChange={e=>setDetail(e.currentTarget.value)}/></label><label>确认状态<Select value={confirmed?'confirmed':'pending'} onChange={v=>setConfirmed(v==='confirmed')} options={[{value:'pending',label:'待核验'},{value:'confirmed',label:'原因已确认'}]}/></label><Button disabled={!label.trim()||!detail.trim()} onClick={()=>onSave({label:label.trim(),detail:detail.trim(),confirmed},expected.current)}>保存异常标记</Button></div>
}

function CommerceNeedNode({shape}:{shape:TLGeoShape}) {
  const c=useCommerceOverview()!,node=readProductGraphNode(shape)!,data=c.data!,[editing,setEditing]=useState(false)
  const contentRef=useCardContentSize(shape)
  const page=c.store.get(shape.parentId) as TLPage,s=readProductGraphPage(page)??readProductGraphPage(c.store.get(node.owner as TLPage['id']))??{entrance:'all',need:'all'},need=data.needs.find(n=>n.id===node.key)
  const canonicalId=`shape:commerce-entrance-${s.entrance}` as TLShapeId
  const canonical=useValue('shared category need intent',()=>c.store.get(canonicalId) as TLGeoShape|undefined,[c.store,canonicalId])
  const entry=readEntranceCard(canonical),saved=entry?.needDesigns?.[node.key]
  const design=saved??{title:need?.name??'设计归属待补',goal:need?.question??'具体需求待确认',measure:'曝光 → 购买 → 使用 → 是否缓解需求',decision:'draft' as const}
  const products=graphProducts(data,{...s,need:node.key})
  return <HTMLContainer><article ref={contentRef} className="commerce-need-node" aria-label={`需求节点 ${need?.name??node.key}`} style={{width:shape.props.w,minHeight:shape.props.h}}>
    <small>{commerceEntrances.find(e=>e.id===s.entrance)?.name??'跨入口'} → 玩家需求</small><h2>{design.title}</h2><p>{design.goal}</p><span className="commerce-node-status">{design.decision==='confirmed'?'已确认设计意图':'候选关联 · 购买动机待确认'}</span><p><strong>{products.length} 项商品</strong><br/><small>{design.measure}</small></p>
    {entry?<Button size="sm" variant="ghost" onPointerDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();setEditing(true)}}>编辑需求目标</Button>:null}
    <Button size="sm" variant="ghost" onPointerDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();browseProductGraph(c,{entrance:'all',need:node.key})}}>比较其他入口同需求 →</Button>
    <CanvasDrawer open={editing} onOpenChange={setEditing} title="需求目标" placement="right" size={560}><CommerceDesignEditor key={String(editing)} value={design} onSave={(change,expected)=>{
      const ed=c.editor(),latest=ed?.getShape<TLGeoShape>(canonicalId),card=readEntranceCard(latest)
      if(!ed||!latest||!card||!c.canEdit()){toast.error('当前画板不可编辑');return}
      if(JSON.stringify(card.needDesigns?.[node.key]??design)!==JSON.stringify(expected)){toast.error('需求目标已被更新，请重新打开');return}
      ed.markHistoryStoppingPoint('edit-commerce-need-goal');ed.updateShapes([{id:canonicalId,type:'geo',meta:{...latest.meta,commerceEntrance:{...card,needDesigns:{...card.needDesigns,[node.key]:change}}}}]);setEditing(false);toast.success('需求目标已保存，各商品链路共用此目标')
    }}/></CanvasDrawer>
  </article></HTMLContainer>
}
