import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createBoardStore, getStoreSnapshot, loadSnapshotIntoStore } from '@infinite-board/tldraw-adapter'
import type { Editor, TLArrowBinding, TLGeoShape, TLShape, TLShapeId } from 'tldraw'
import { getIndexAbove } from 'tldraw'
import { createPayRhythmSnapshot } from './commerce-design-map'
import { withCommerceOverview } from './commerce-overview-model'
import { graphProducts, growProductGraphCard, productAnnotation, productGraphPageId, productGraphRecords, productHistorySummary, readProductGraphNode, saveProductAnnotation, syncProductGraph } from './commerce-product-graph'
import { CommerceProductGraphShape } from './CommerceProductGraph'
import { CommerceOverviewProvider, CommerceEntranceShape } from './CommerceOverviewCanvas'
import { readEntranceCard } from './commerce-overview-model'
import type { CommerceDataset, CommerceProduct } from './commerce-data'

const product=(key:string,channel:string,needs=['spirit']):CommerceProduct=>({key,sku:key,title:`${channel} · 魔灵`,channel,kind:'diamond',price:'150 钻石',rewards:[{id:221001,name:'随机魔灵',n:15}],limit:'3次 / 周',note:'',source:'s',status:'defined',needs})
const data:CommerceDataset={created:'test',scope:'test',sources:{s:{name:'test',path:'test',sha256:'test'}},needs:['hero','gem','weapon','spirit','daily'].map(id=>({id,name:id,question:`${id}需求`,why:'候选',principle:''})),products:[product('first','首充'),product('monthly','月卡'),product('week','周礼包'),product('month','月礼包'),product('hero','日礼包',['hero']),product('gem','日礼包',['gem']),product('weapon','日礼包',['weapon']),product('daily','日礼包',['daily'])]}
function setup(){const store=createBoardStore();loadSnapshotIntoStore(store,withCommerceOverview(createPayRhythmSnapshot('source',data)));const s={entrance:'shop',need:'spirit'},id=productGraphPageId(s);store.put([{id,typeName:'page',name:'Spirit',index:'a3',meta:{commerceProductGraph:s}},...productGraphRecords(data,s)] as never[]);return {store,s}}
afterEach(cleanup)

describe('native product relationship graph',()=>{
  it('shows every need including spirit after the first three and selects the matching enabled products',()=>{
    const {store}=setup(),shape=store.get('shape:commerce-entrance-shop' as TLShapeId) as TLGeoShape
    render(<CommerceOverviewProvider data={data} error="" store={store} editor={()=>undefined} canEdit={()=>false}><CommerceEntranceShape shape={{...shape,meta:{commerceEntrance:{...readEntranceCard(shape),expanded:true}}}}/></CommerceOverviewProvider>)
    expect(screen.getByRole('button',{name:'spirit · 2 ↗'})).toBeInTheDocument()
    expect(screen.getByRole('button',{name:'daily · 1 ↗'})).toBeInTheDocument()
    expect(graphProducts({...data,products:[...data.products,{...product('disabled','周礼包'),status:'missing'}]}, {entrance:'shop',need:'spirit'}).map(p=>p.key)).toEqual(['week','month'])
    expect(graphProducts(data,{entrance:'all',need:'spirit',resource:221001})).toHaveLength(4)
  })
  it('round-trips native cards and bound arrows without storing rewards, prices, or history',()=>{
    const {store,s}=setup(),records=productGraphRecords(data,s),snapshot=getStoreSnapshot(store),restored=createBoardStore()
    loadSnapshotIntoStore(restored,snapshot)
    expect(records.filter(r=>r.type==='geo')).toHaveLength(3)
    expect(records.filter(r=>r.typeName==='binding')).toHaveLength(4)
    expect(new Set(records.map(r=>r.id)).size).toBe(records.length)
    expect(JSON.stringify(records)).not.toContain('150 钻石')
    expect(JSON.stringify(records)).not.toContain('221001')
    const arrows=records.filter(r=>r.typeName==='shape'&&r.type==='arrow'),cards=records.filter(r=>r.type==='geo')
    expect(arrows.every(a=>cards.every(c=>String(a.index)<String(c.index)))).toBe(true)
    expect(restored.allRecords().filter(r=>readProductGraphNode(r))).toHaveLength(3)
  })
  it('refreshes membership without resetting moved cards or unrelated notes',()=>{
    const {store,s}=setup(),old=store.allRecords().find(r=>readProductGraphNode(r)?.key==='week') as TLGeoShape
    store.put([{...old,x:900,y:700},{...old,id:'shape:manual' as TLShapeId,meta:{},x:0,y:0},{...old,id:'shape:user-copied-card' as TLShapeId,x:1300,y:700}])
    const editor={store,deleteShapes:vi.fn((ids:TLShapeId[])=>store.remove(ids))} as unknown as Editor
    syncProductGraph(editor,{...data,products:[...data.products,product('new','周礼包')]},s)
    expect((store.get(old.id) as TLGeoShape).x).toBe(900)
    expect(store.get('shape:manual' as TLShapeId)).toBeDefined()
    expect(store.get('shape:user-copied-card' as TLShapeId)).toBeDefined()
    expect(store.allRecords().filter(r=>readProductGraphNode(r)?.key==='new')).toHaveLength(1)
    syncProductGraph(editor,{...data,products:data.products.filter(p=>p.key!=='month')},s)
    expect(store.allRecords().filter(r=>readProductGraphNode(r)?.key==='month')).toHaveLength(0)
    expect(store.get('shape:manual' as TLShapeId)).toBeDefined()
  })
  it('separates diamond consumption from cash and does not treat missing evidence as zero',()=>{
    const p=data.products.find(p=>p.key==='week')!
    const ledger={purchases:[{key:'week',date:'2026-10-17',server:102,orders:2,buyers:1,diamonds:500,prices:[150,350],rewards:['']}],payments:[],giftScope:{servers:[102]},orderScope:{from:'2026-10-15',through:'2026-10-26'}}
    const d={...data,evidence:{ledger,icons:{},assets:{}} as unknown as CommerceDataset['evidence']}
    expect(productHistorySummary(d,p).primary).toBe('2 笔 · 500 钻石')
    expect(productHistorySummary(data,p).primary).toBe('未接入对应消费记录')
    expect(productHistorySummary(data,{...p,kind:'resource'})).toEqual({primary:'尚未接入对应兑换流水',secondary:'兑换次数与资源消耗待核验'})
  })
  it('grows long-content cards without clipping and only pushes newly obstructed linked cards',()=>{
    const {store}=setup(),first=store.allRecords().find(r=>readProductGraphNode(r)?.key==='week') as TLGeoShape
    const below={...first,id:'shape:below' as TLShapeId,x:first.x+15,y:first.y+first.props.h+28}
    const last={...below,id:'shape:last' as TLShapeId,y:below.y+below.props.h+28}
    const note={...last,id:'shape:note' as TLShapeId,x:2000,meta:{}}
    store.put([below,last,note])
    const neighbor=store.allRecords().find(r=>readProductGraphNode(r)?.key==='month')
    const editor={store,getShape:(id:TLShapeId)=>store.get(id),run:(fn:()=>void)=>fn(),updateShapes:(changes:TLGeoShape[])=>store.put(changes.map(r=>{const old=store.get(r.id) as TLGeoShape;return {...old,...r,props:{...old.props,...r.props}}}))} as unknown as Editor
    growProductGraphCard(editor,first.id,first.props.h+92)
    expect((store.get(first.id) as TLGeoShape).props.h).toBe(first.props.h+92)
    expect((store.get(below.id) as TLGeoShape).y).toBe(below.y+92)
    expect((store.get(last.id) as TLGeoShape).y).toBe(last.y+92)
    expect((store.get(below.id) as TLGeoShape).x).toBe(below.x)
    expect(store.get(note.id)).toEqual(note)
    expect(store.get(neighbor!.id)).toEqual(neighbor)
    growProductGraphCard(editor,first.id,first.props.h+92)
    expect((store.get(last.id) as TLGeoShape).y).toBe(last.y+92)
  })
  it('uses short local associations rather than a fan of links from the need hub',()=>{
    const rows=productGraphRecords({...data,products:Array.from({length:12},(_,i)=>product(`p${i}`,'周礼包'))},{entrance:'shop',need:'spirit'})
    const starts=rows.filter(r=>r.typeName==='binding'&&(r.props as TLArrowBinding['props']).terminal==='start')
    expect(starts.filter(r=>String(r.toId).includes(':need:'))).toHaveLength(1)
    const vertical=rows.find(r=>r.id===`binding:shape:${productGraphPageId({entrance:'shop',need:'spirit'})}:link:p2:start`)!
    expect(vertical.toId).toContain(':product:p0')
    expect((vertical.props as TLArrowBinding['props']).normalizedAnchor).toEqual({x:0.5,y:1})
    expect(rows.filter(r=>r.type==='arrow'&&(r.props as {arrowheadEnd:string}).arrowheadEnd==='arrow')).toHaveLength(1)
  })
  it('keeps hand-adjusted connection anchors when referenced data refreshes',()=>{
    const {store,s}=setup(),binding=store.allRecords().find(r=>r.typeName==='binding') as TLArrowBinding
    const adjusted={...binding,props:{...binding.props,normalizedAnchor:{x:0.25,y:0.85}}}
    store.put([adjusted])
    syncProductGraph({store,deleteShapes:vi.fn()} as unknown as Editor,data,s)
    expect(store.get(binding.id)).toEqual(adjusted)
  })
  it('migrates both endpoints of legacy hub links once, then preserves manually adjusted anchors',()=>{
    const {store,s}=setup(),expanded={...data,products:[...data.products,product('third','周礼包')]}
    syncProductGraph({store,deleteShapes:vi.fn()} as unknown as Editor,expanded,s)
    const arrowId=`shape:${productGraphPageId(s)}:link:third` as TLShapeId
    const arrow=store.get(arrowId) as TLShape
    const start=store.get(`binding:${arrowId}:start` as TLArrowBinding['id']) as TLArrowBinding
    const end=store.get(`binding:${arrowId}:end` as TLArrowBinding['id']) as TLArrowBinding
    store.put([{...arrow,meta:{commerceGraphOwner:productGraphPageId(s)}},{...start,toId:`shape:${productGraphPageId(s)}:need:spirit` as TLShapeId,props:{...start.props,normalizedAnchor:{x:1,y:0.16}}},{...end,props:{...end.props,normalizedAnchor:{x:0,y:0.16}}}])
    syncProductGraph({store,deleteShapes:vi.fn()} as unknown as Editor,expanded,s)
    expect((store.get(start.id) as TLArrowBinding).props.normalizedAnchor).toEqual({x:0.5,y:1})
    expect((store.get(end.id) as TLArrowBinding).props.normalizedAnchor).toEqual({x:0.5,y:0})
    const adjusted={...(store.get(end.id) as TLArrowBinding),props:{...end.props,normalizedAnchor:{x:0.2,y:0.6}}}
    store.put([adjusted]);syncProductGraph({store,deleteShapes:vi.fn()} as unknown as Editor,expanded,s)
    expect(store.get(end.id)).toEqual(adjusted)
  })
  it('adds several products without overlapping hand-placed notes or reusing layer indices',()=>{
    const {store,s}=setup(),old=store.allRecords().find(r=>readProductGraphNode(r)?.key==='week') as TLGeoShape
    const topIndex=store.allRecords().filter((r):r is TLShape=>r.typeName==='shape').map(r=>r.index).sort().at(-1)!
    store.put([{...old,id:'shape:manual-space' as TLShapeId,index:getIndexAbove(topIndex),x:300,y:old.y+old.props.h+26,props:{...old.props,w:900,h:800},meta:{}}])
    const changed={...data,products:[...data.products,...Array.from({length:6},(_,i)=>product(`added-${i}`,'周礼包'))]}
    syncProductGraph({store,deleteShapes:vi.fn()} as unknown as Editor,changed,s)
    const shapes=store.allRecords().filter((r):r is TLShape=>r.typeName==='shape'&&r.parentId===productGraphPageId(s))
    expect(new Set(shapes.map(r=>r.index)).size).toBe(shapes.length)
    const cards=shapes.filter(r=>r.type==='geo') as TLGeoShape[]
    for(let i=0;i<cards.length;i++)for(let j=i+1;j<cards.length;j++){const a=cards[i]!,b=cards[j]!;expect(a.x<b.x+b.props.w&&a.x+a.props.w>b.x&&a.y<b.y+b.props.h&&a.y+a.props.h>b.y).toBe(false)}
  })
  it('stores one hotfix explanation per product and keeps missing rewards as a separate warning',async()=>{
    const {store}=setup(),shape=store.allRecords().find(r=>readProductGraphNode(r)?.key==='week') as TLGeoShape,editor={store,markHistoryStoppingPoint:vi.fn()} as unknown as Editor
    const ledger={purchases:[{key:'week',date:'2026-10-17',server:102,orders:2,buyers:1,diamonds:500,prices:[150,350],rewards:['']}],payments:[],giftScope:{servers:[102]},orderScope:{from:'2026-10-15',through:'2026-10-26'}}
    const d={...data,evidence:{ledger,icons:{},assets:{}} as unknown as CommerceDataset['evidence']}
    render(<CommerceOverviewProvider data={d} error="" store={store} editor={()=>editor} canEdit={()=>true}><CommerceProductGraphShape shape={shape}/></CommerceOverviewProvider>)
    await act(async()=>saveProductAnnotation(editor,'week',{label:'热更调价',detail:'切换时间待核验',confirmed:true}))
    expect(screen.getByText('热更调价 · 原因已确认')).toBeInTheDocument()
    expect(screen.getByText('到账明细不完整 · 奖励暂按配置')).toBeInTheDocument()
    expect(screen.getByText('150 / 350 钻石')).toBeInTheDocument()
    expect(productAnnotation(store,'week')?.confirmed).toBe(true)
    const doc=store.allRecords().find(r=>r.typeName==='document')!
    expect(Object.keys(doc.meta.commerceProductAnnotations!)).toEqual(['week'])
  })
  it('closes a card drawer without sending its close-button pointer events to the canvas',async()=>{
    const {store}=setup(),shape=store.allRecords().find(r=>readProductGraphNode(r)?.key==='week') as TLGeoShape,canvasPointer=vi.fn()
    render(<div onPointerDown={canvasPointer}><CommerceOverviewProvider data={data} error="" store={store} editor={()=>undefined} canEdit={()=>true}><CommerceProductGraphShape shape={shape}/></CommerceOverviewProvider></div>)
    fireEvent.click(screen.getByRole('button',{name:'标记异常'}))
    const close=await screen.findByRole('button',{name:/^(关闭|Close)$/})
    fireEvent.pointerDown(close);fireEvent.pointerUp(close);fireEvent.click(close)
    expect(canvasPointer).not.toHaveBeenCalled()
    await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})
