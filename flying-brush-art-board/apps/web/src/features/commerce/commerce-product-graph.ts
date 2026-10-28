import { Box, getIndexAbove, getIndexBelow, getIndices, toRichText, type Editor, type TLArrowBinding, type TLGeoShape, type TLPageId, type TLShape, type TLShapeId, type TLStore } from 'tldraw'
import { z } from 'zod'
import { entranceProducts, commerceEntrances } from './commerce-browse'
import { type CommerceDataset, type CommerceProduct } from './commerce-data'
import { ledgerRows } from './commerce-ledger'
import { productFacts } from './commerce-facts'
import { productRevenue, yuan } from './commerce-revenue'

const selectorSchema = z.object({ entrance: z.string(), need: z.string().default('all'), resource: z.number().optional() })
const nodeSchema = z.object({ version: z.literal(1), owner: z.string(), kind: z.enum(['need', 'product']), key: z.string() })
export type ProductGraphSelector = z.infer<typeof selectorSchema>
// The source loader replaces the dataset on refresh. Cache only within that immutable read.
const factCache=new WeakMap<CommerceDataset,Map<string,ReturnType<typeof productFacts>>>()
export function graphFacts(data:CommerceDataset,p:CommerceProduct){
  let cache=factCache.get(data);if(!cache){cache=new Map();factCache.set(data,cache)}
  let facts=cache.get(p.key);if(!facts){facts=productFacts(data,p);cache.set(p.key,facts)}
  return facts
}
const resourceCache=new WeakMap<CommerceDataset,Map<number,number>>()
export function resourceProductCount(data:CommerceDataset,id:number){
  let counts=resourceCache.get(data)
  if(!counts){counts=new Map();for(const p of entranceProducts(data,'all'))for(const id of new Set(graphFacts(data,p).rewards.map(r=>r.id)))counts.set(id,(counts.get(id)??0)+1);resourceCache.set(data,counts)}
  return counts.get(id)??0
}
export function readProductGraphPage(page: { meta: unknown } | undefined) {
  const r = z.object({ commerceProductGraph: selectorSchema }).safeParse(page?.meta)
  return r.success ? r.data.commerceProductGraph : undefined
}
export function readProductGraphNode(shape: { meta: unknown } | undefined) {
  const r = z.object({ commerceProductNode: nodeSchema }).safeParse(shape?.meta)
  return r.success ? r.data.commerceProductNode : undefined
}
const token = (s: string) => encodeURIComponent(s)
export const productGraphPageId = (s: ProductGraphSelector) => `page:commerce-products-${token(s.entrance)}-${token(s.need)}-${s.resource ?? 'all'}` as TLPageId
export function graphProducts(data: CommerceDataset, s: ProductGraphSelector) {
  return entranceProducts(data, s.entrance).filter(p => (s.need === 'all' || p.needs.includes(s.need)) && (s.resource === undefined || graphFacts(data,p).rewards.some(r=>r.id===s.resource)))
}
export function graphPageName(data: CommerceDataset, s: ProductGraphSelector) {
  const entrance = commerceEntrances.find(e=>e.id===s.entrance)?.name ?? '跨入口'
  const resource = s.resource === undefined ? undefined : data.products.flatMap(p=>graphFacts(data,p).rewards).find(r=>r.id===s.resource)?.name
  const need=data.needs.find(n=>n.id===s.need)?.name
  return `${entrance} · ${resource ? [resource,need].filter(Boolean).join(' · ') : need ?? '商品链路'}`
}

/** Store identities, layout and arrow bindings only; all business facts resolve from the source. */
export function productGraphRecords(data: CommerceDataset, s: ProductGraphSelector) {
  const pageId=productGraphPageId(s), products=graphProducts(data,s), groups=new Map<string,CommerceProduct[]>()
  for(const p of products) {
    const need=s.need==='all' ? p.needs.find(n=>n!=='unknown') ?? 'unknown' : s.need
    groups.set(need,[...(groups.get(need) ?? []),p])
  }
  const indices=getIndices(products.length*2+groups.size), records:Record<string,unknown>[]= []; let index=0,y=24
  const shape=(id:string,x:number,top:number) => ({id,typeName:'shape',parentId:pageId,index:indices[index++]!,x,y:top,rotation:0,isLocked:false,opacity:1,meta:{}})
  const geo=(id:string,key:string,kind:'need'|'product',x:number,top:number,w:number,h:number) => ({...shape(id,x,top),type:'geo',meta:{commerceProductNode:{version:1,owner:pageId,kind,key}},props:{w,h,geo:'rectangle',dash:'solid',growY:0,url:'',scale:1,color:'grey',labelColor:'black',fill:'solid',size:'s',font:'sans',align:'start',verticalAlign:'start',richText:toRichText(kind==='need'?data.needs.find(n=>n.id===key)?.name ?? key:products.find(p=>p.key===key)?.title ?? key)}})
  for(const [need,items] of groups) {
    const hub=`shape:${pageId}:need:${token(need)}`
    records.push(geo(hub,need,'need',24,y,260,330))
    items.forEach((p,i)=>{
      const id=`shape:${pageId}:product:${token(p.key)}`,arrow=`shape:${pageId}:link:${token(p.key)}`
      const rewardCount=graphFacts(data,p).rewards.length+(p.extraRewards?.length ?? 0)
      records.push(geo(id,p.key,'product',350+i%2*410,y+Math.floor(i/2)*330,380,310+Math.max(0,rewardCount-1)*30))
      records.push({...shape(arrow,0,0),type:'arrow',meta:{commerceGraphOwner:pageId},props:{kind:'arc',elbowMidPoint:0.5,dash:'dashed',size:'s',fill:'none',color:'light-blue',labelColor:'grey',bend:0,start:{x:0,y:0},end:{x:60,y:0},arrowheadStart:'none',arrowheadEnd:'arrow',richText:toRichText(''),labelPosition:0.5,font:'sans',scale:1}})
      const from=i%2===0?hub:`shape:${pageId}:product:${token(items[i-1]!.key)}`
      if(i%2===1)(records.at(-1)!.props as {arrowheadEnd:string}).arrowheadEnd='none'
      for(const [terminal,target,anchor] of [['start',from,1],['end',id,0]] as const) records.push({id:`binding:${arrow}:${terminal}`,typeName:'binding',type:'arrow',fromId:arrow,toId:target,props:{terminal,normalizedAnchor:{x:anchor,y:0.16},isExact:false,isPrecise:true,snap:'none'},meta:{commerceGraphOwner:pageId}})
    })
    // Leave room for the largest card in each row, including bundles with many rewards.
    let rowY=y
    for(let i=0;i<items.length;i+=2){
      const row=items.slice(i,i+2).map(p=>records.find(r=>r.id===`shape:${pageId}:product:${token(p.key)}`)!)
      for(const r of row)r.y=rowY
      rowY+=Math.max(...row.map(r=>(r.props as {h:number}).h))+28
    }
    y=Math.max(y+370,rowY)+60
  }
  // Connections belong behind the opaque cards so long links never cross their text.
  ;[...records.filter(r=>r.typeName==='shape'&&r.type==='arrow'),...records.filter(r=>r.type==='geo')].forEach((r,i)=>{r.index=indices[i]})
  return records
}
export function graphFirstBounds(editor: Editor) {
  const shapes=editor.getCurrentPageShapes().filter(s=>readProductGraphNode(s)).sort((a,b)=>a.y-b.y||a.x-b.x)
  if(!shapes.length)return undefined
  const firstY=shapes[0]!.y, compact=shapes.filter(s=>readProductGraphNode(s)?.kind==='product').length<=4
  const first=shapes.filter(s=>compact||s.y<firstY+10).flatMap(s=>{const b=editor.getShapePageBounds(s);return b?[b]:[]})
  return first.length?Box.Common(first):undefined
}
export function focusProductGraph(editor: Editor) {
  const bounds=graphFirstBounds(editor)
  if(bounds)editor.zoomToBounds(bounds,{inset:128,animation:{duration:200}})
}
export function arrangeProductGraph(editor:Editor,data:CommerceDataset,s:ProductGraphSelector) {
  editor.markHistoryStoppingPoint('arrange-product-graph')
  editor.run(()=>{syncProductGraph(editor,data,s);for(const r of productGraphRecords(data,s))if(r.typeName==='shape'&&editor.getShape(r.id as TLShapeId))editor.updateShapes([{id:r.id,type:r.type,index:r.index,...(r.type==='geo'?{x:r.x,y:r.y,props:{w:(r.props as {w:number}).w,h:(r.props as {h:number}).h}}:{props:{arrowheadEnd:(r.props as {arrowheadEnd:string}).arrowheadEnd}})}] as Parameters<Editor['updateShapes']>[0])})
  focusProductGraph(editor)
}

export const productAnnotationSchema=z.object({label:z.string(),detail:z.string(),confirmed:z.boolean()})
export type ProductAnnotation=z.infer<typeof productAnnotationSchema>
export function productAnnotation(store:TLStore,key:string){
  const doc=store.allRecords().find(r=>r.typeName==='document')
  const parsed=z.record(z.string(),productAnnotationSchema).safeParse(doc?.meta.commerceProductAnnotations)
  return parsed.success?parsed.data[key]:undefined
}
export function saveProductAnnotation(editor:Editor,key:string,value:ProductAnnotation){
  const doc=editor.store.allRecords().find(r=>r.typeName==='document')!
  const old=z.record(z.string(),productAnnotationSchema).safeParse(doc.meta.commerceProductAnnotations)
  editor.markHistoryStoppingPoint('annotate-product-history')
  editor.store.put([{...doc,meta:{...doc.meta,commerceProductAnnotations:{...(old.success?old.data:{}),[key]:value}}}])
}
export function syncProductGraph(editor: Editor, data: CommerceDataset, s: ProductGraphSelector) {
  const pageId=productGraphPageId(s), generated=productGraphRecords(data,s), expected=new Set(generated.map(r=>r.id as string))
  const stale=editor.store.allRecords().filter(r=>r.typeName==='shape'&&r.id.startsWith(`shape:${pageId}:`)&&(readProductGraphNode(r)?.owner===pageId||r.meta.commerceGraphOwner===pageId)&&!expected.has(r.id))
  if(stale.length)editor.deleteShapes(stale.map(r=>r.id as TLShapeId))
  const existing=editor.store.allRecords().filter(r=>r.typeName==='shape'&&r.parentId===pageId&&r.type==='geo') as TLGeoShape[]
  const added=generated.filter(r=>!editor.store.get(r.id as TLShapeId))
  // Preserve hand-arranged nodes. Place newly imported products below occupied space if necessary.
  let bottom=Math.max(24,...existing.map(r=>r.y+r.props.h))+40
  for(const r of added.filter(r=>r.type==='geo')) {
    const props=r.props as {w:number;h:number}, x=r.x as number, y=r.y as number
    if(existing.some(o=>x<o.x+o.props.w&&x+props.w>o.x&&y<o.y+o.props.h&&y+props.h>o.y)){r.y=bottom;bottom+=props.h+40}
    existing.push(r as unknown as TLGeoShape)
    bottom=Math.max(bottom,Number(r.y)+props.h+40)
  }
  const ordered=editor.store.allRecords().filter((r):r is TLShape=>r.typeName==='shape'&&r.parentId===pageId).sort((a,b)=>a.index<b.index?-1:a.index>b.index?1:0)
  if(ordered.length){let lower=ordered[0]!.index,upper=ordered.at(-1)!.index;for(const r of added.filter(r=>r.typeName==='shape')){if(r.type==='arrow'){lower=getIndexBelow(lower);r.index=lower}else{upper=getIndexAbove(upper);r.index=upper}}}
  if(added.length)editor.store.put(added as unknown as Parameters<TLStore['put']>[0])
  // Refresh source membership without resetting hand-adjusted connection anchors.
  const bindings=generated.filter(r=>{if(r.typeName!=='binding')return false;const old=editor.store.get(r.id as TLArrowBinding['id']) as TLArrowBinding|undefined;return old&&(old.fromId!==r.fromId||old.toId!==r.toId)})
  if(bindings.length)editor.store.put(bindings as unknown as Parameters<TLStore['put']>[0])
}
export function openProductGraph(editor: Editor, data: CommerceDataset, s: ProductGraphSelector, canEdit=true) {
  const id=productGraphPageId(s)
  if(!editor.store.get(id)&&!canEdit)return false
  if(!editor.store.get(id)&&editor.getPages().length>=editor.options.maxPages)return false
  editor.run(()=>{
    if(canEdit){
      editor.markHistoryStoppingPoint('open-product-graph')
      if(!editor.store.get(id))editor.createPage({id,name:graphPageName(data,s),index:getIndexAbove(editor.getPages().at(-1)!.index),meta:{commerceProductGraph:s}})
      syncProductGraph(editor,data,s)
    }
    editor.setCurrentPage(id)
  })
  focusProductGraph(editor);return true
}

export function productHistorySummary(data:CommerceDataset,p:CommerceProduct) {
  const rows=ledgerRows(data,p,'all'), facts=graphFacts(data,p), report=productRevenue(data,p,'all')
  const dateSpan=(from:string,through:string)=>`${from.slice(5)}—${through.slice(5)}`
  if(p.kind==='diamond')return rows.purchases.length ? {
    primary:`${rows.purchases.reduce((n,r)=>n+r.orders,0).toLocaleString('zh-CN')} 笔 · ${rows.purchases.reduce((n,r)=>n+r.diamonds,0).toLocaleString('zh-CN')} 钻石`,
    secondary:`${dateSpan(facts.from!,facts.through!)} · ${facts.servers.length} 服 · 已知角色`,
  }:{primary:'未接入对应消费记录',secondary:'不能记为零，也不能换算成现金收入'}
  if(rows.payments.length){const scope=data.evidence!.ledger!.orderScope;return {
    primary:`现金 ${yuan(rows.payments.reduce((n,r)=>n+r.cashYuan,0))} · ${rows.payments.reduce((n,r)=>n+r.cashOrders,0)} 笔`,
    secondary:`代金券订单 ${yuan(rows.payments.reduce((n,r)=>n+r.voucherOrderYuan,0))} · ${dateSpan(scope.from,scope.through)} · 已知角色`,
  }}
  if(report)return {primary:`${report.orders} 笔 · ${yuan(report.yuan)}（含代金券）`,secondary:'现金金额未拆分 · 测试范围见来源'}
  if(facts.claimOnly)return {primary:`${facts.orders} 笔领取记录`,secondary:'免费与广告尚未区分'}
  return {primary:'暂无对应商品级记录',secondary:'不等于没有销售；缺对应流水'}
}
