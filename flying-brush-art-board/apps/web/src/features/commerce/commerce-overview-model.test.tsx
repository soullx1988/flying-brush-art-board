import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createBoardStore, getStoreSnapshot, loadSnapshotIntoStore } from '@infinite-board/tldraw-adapter'
import type { Editor, TLGeoShape } from 'tldraw'
import { createPayRhythmSnapshot, readDesignCard, updateDesignCard } from './commerce-design-map'
import { collapsePatch, entranceDesign, entranceHistory, readEntranceCard, withCommerceOverview } from './commerce-overview-model'
import { CommerceEntranceShape, CommerceOverviewProvider } from './CommerceOverviewCanvas'
import type { CommerceDataset, CommerceProduct } from './commerce-data'

const product=(key:string,channel:string):CommerceProduct=>({key,sku:key,title:key,channel,kind:'diamond',price:'10 钻石',rewards:[{id:123,name:'培养券',n:2}],limit:'1次',note:'',source:'s',status:'defined',needs:['n']})
const data:CommerceDataset={created:'test',scope:'test',sources:{s:{name:'test',path:'test',sha256:'test'}},needs:[{id:'n',name:'成长',question:'补充培养材料',why:'候选',principle:''}],products:[product('first','首充'),product('monthly','月卡'),product('shop','日礼包'),product('chain','招募链'),product('trigger','宝石条件礼包'),product('event','英雄试炼')]}
function setup(){const snapshot=withCommerceOverview(createPayRhythmSnapshot('source',data)),store=createBoardStore();loadSnapshotIntoStore(store,snapshot);return {snapshot,store}}
afterEach(cleanup)

describe('commerce overview references',()=>{
  it('adds the overview without copying or overwriting existing designs or catalog facts',()=>{
    const old=createPayRhythmSnapshot('source',data), before=JSON.stringify(old), next=withCommerceOverview(old)
    for(const [id,value] of Object.entries(old.store))expect(next.store[id as TLGeoShape['id']]).toEqual(value)
    expect(JSON.stringify(old)).toBe(before)
    expect(withCommerceOverview(next)).toBe(next)
    const store=createBoardStore();loadSnapshotIntoStore(store,next)
    expect(Object.values(getStoreSnapshot(store).store).filter(r=>readEntranceCard(r))).toHaveLength(6)
    expect(JSON.stringify(next)).not.toContain('培养券')
    expect(JSON.stringify(next)).not.toContain('10 钻石')
    const first=readEntranceCard(store.get('shape:commerce-entrance-first' as TLGeoShape['id']))!
    expect(first.design).toBeUndefined()
    const original=store.get('shape:rhythm-first-design' as TLGeoShape['id']) as TLGeoShape
    const patch=updateDesignCard(original,{title:'负责人已改的目标',goal:'预期',measure:'衡量',decision:'confirmed'})
    store.put([{...original,...patch,props:{...original.props,...patch.props}}])
    expect(entranceDesign(store,first)?.title).toBe('负责人已改的目标')
  })
  it('uses current category selectors and keeps absent evidence distinct from zero',()=>{
    expect(entranceHistory(data,'benefits').products.map(p=>p.key)).toEqual(['monthly'])
    expect(entranceHistory(data,'shop').cash).toBeUndefined()
    expect(entranceHistory(data,'shop').diamonds).toBeUndefined()
    const changed={...data,products:[...data.products,product('new','日礼包'),{...product('unused','日礼包'),status:'missing' as const}]}
    expect(entranceHistory(changed,'shop').products.map(p=>p.key)).toEqual(['shop','new'])
    const ledger={payments:[{key:'shop',cashYuan:6,cashOrders:1,voucherOrderYuan:18,voucherOrders:1},{key:'monthly',cashYuan:99,cashOrders:1,voucherOrderYuan:0,voucherOrders:0}],purchases:[{key:'shop',diamonds:40,orders:4},{key:'chain',diamonds:100,orders:10}]}
    const h=entranceHistory({...data,evidence:{ledger} as CommerceDataset['evidence']},'shop')
    expect([h.cash,h.voucher,h.diamonds,h.diamondOrders,h.recordedProducts]).toEqual([6,18,40,4,1])
  })
  it('restores a user-arranged location after expansion without losing design metadata',()=>{
    const {store}=setup(),shape=store.get('shape:commerce-entrance-shop' as TLGeoShape['id']) as TLGeoShape,card=readEntranceCard(shape)!
    const expanded={...shape,x:0,y:800,props:{...shape.props,w:1120,h:380},meta:{commerceEntrance:{...card,expanded:true,home:{x:103,y:212,w:360,h:240}}}}
    const patch=collapsePatch(expanded)!
    expect([patch.x,patch.y,patch.props.w,patch.props.h]).toEqual([103,212,360,240])
    expect(readEntranceCard(patch)?.design).toEqual(card.design)
    expect(collapsePatch(shape)).toBeUndefined()
  })
  it('edits the existing first-purchase design through the overview instead of creating a second copy',async()=>{
    const {store}=setup(),shape=store.get('shape:commerce-entrance-first' as TLGeoShape['id']) as TLGeoShape
    const expanded={...shape,meta:{...shape.meta,commerceEntrance:{...readEntranceCard(shape)!,expanded:true}}}
    const update=vi.fn((patches:Partial<TLGeoShape>[])=>patches.forEach(p=>{const old=store.get(p.id!) as TLGeoShape;store.put([{...old,...p,props:{...old.props,...p.props}} as TLGeoShape])}))
    const editor={getShape:(id:TLGeoShape['id'])=>store.get(id),updateShapes:update,markHistoryStoppingPoint:vi.fn()} as unknown as Editor
    render(<CommerceOverviewProvider data={data} error="" store={store} editor={()=>editor} canEdit={()=>true}><CommerceEntranceShape shape={expanded}/></CommerceOverviewProvider>)
    fireEvent.click(screen.getByRole('button',{name:'编辑设计'}))
    fireEvent.change(screen.getByLabelText('设计目标'),{target:{value:'补强后愿意继续挑战'}})
    fireEvent.click(screen.getByRole('button',{name:'保存设计'}))
    expect(readDesignCard(store.get('shape:rhythm-first-design' as TLGeoShape['id']) as TLGeoShape)?.title).toBe('补强后愿意继续挑战')
    expect(readEntranceCard(store.get(shape.id))?.design).toBeUndefined()
  })
  it('does not overwrite a concurrently changed design while a form is open',async()=>{
    const {store}=setup(),shape=store.get('shape:commerce-entrance-shop' as TLGeoShape['id']) as TLGeoShape
    const expanded={...shape,meta:{...shape.meta,commerceEntrance:{...readEntranceCard(shape)!,expanded:true}}}, update=vi.fn()
    const editor={getShape:(id:TLGeoShape['id'])=>store.get(id),updateShapes:update,markHistoryStoppingPoint:vi.fn()} as unknown as Editor
    render(<CommerceOverviewProvider data={data} error="" store={store} editor={()=>editor} canEdit={()=>true}><CommerceEntranceShape shape={expanded}/></CommerceOverviewProvider>)
    fireEvent.click(screen.getByRole('button',{name:'编辑设计'}))
    await act(async()=>{store.put([{...shape,meta:{commerceEntrance:{...readEntranceCard(shape)!,design:{...readEntranceCard(shape)!.design!,title:'负责人修改'}}}}])})
    fireEvent.click(screen.getByRole('button',{name:'保存设计'}))
    expect(update).not.toHaveBeenCalled()
  })
  it('opens cross-category needs from the same catalog and displays newly refreshed rewards',()=>{
    const {store}=setup(),shape=store.get('shape:commerce-entrance-shop' as TLGeoShape['id']) as TLGeoShape
    const expanded={...shape,meta:{...shape.meta,commerceEntrance:{...readEntranceCard(shape)!,expanded:true}}}
    const before=JSON.stringify(getStoreSnapshot(store)),props={error:'',store,editor:()=>undefined,canEdit:()=>false,children:<CommerceEntranceShape shape={expanded}/>}
    const view=render(<CommerceOverviewProvider {...props} data={data}/>)
    fireEvent.click(screen.getByRole('button',{name:'成长 ↗'}))
    expect(screen.getByRole('button',{name:'查看商品 monthly'})).toBeInTheDocument()
    const changed={...data,products:data.products.map(p=>p.key==='monthly'?{...p,price:'12 钻石',rewards:[{id:123,name:'培养券',n:8}]}:p)}
    view.rerender(<CommerceOverviewProvider {...props} data={changed}/>)
    expect(screen.getByText('培养券 × 8')).toBeInTheDocument()
    expect(screen.getByText('12 钻石')).toBeInTheDocument()
    expect(JSON.stringify(getStoreSnapshot(store))).toBe(before)
  })
})
