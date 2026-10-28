import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createBoardStore, getStoreSnapshot, loadSnapshotIntoStore } from '@infinite-board/tldraw-adapter'
import type { Editor, TLGeoShape, TLShapeId } from 'tldraw'
import { createPayRhythmSnapshot } from './commerce-design-map'
import { withCommerceOverview } from './commerce-overview-model'
import { graphProducts, productAnnotation, productGraphPageId, productGraphRecords, productHistorySummary, readProductGraphNode, saveProductAnnotation, syncProductGraph } from './commerce-product-graph'
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
})
