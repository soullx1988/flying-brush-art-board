import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createBoardStore, getStoreSnapshot, loadSnapshotIntoStore } from '@infinite-board/tldraw-adapter'
import type { TLGeoShape } from 'tldraw'
import { CommerceDesignCanvas, CommerceDesignCard } from './CommerceDesignCanvas'
import { createPayRhythmSnapshot, datasetFromSnapshot, designPayments, linkedProducts, readDesignCard, readDesignMap, updateDesignCard } from './commerce-design-map'
import type { CommerceDataset } from './commerce-data'

const data: CommerceDataset = { created:'2026-10-27',scope:'test',sources:{s:{name:'test',path:'test',sha256:'test'}},needs:[{id:'n',name:'培养',question:'',why:'',principle:''}],products:[
  {key:'first:test',sku:'7',title:'首充',channel:'首充',kind:'cash',price:'¥6',rewards:[{id:1,name:'测试券',n:3}],limit:'分日领取',note:'',source:'s',status:'defined',needs:['n']},
  {key:'month:test',sku:'8',title:'月卡',channel:'月卡',kind:'cash',price:'¥18',rewards:[{id:1,name:'测试券',n:2}],limit:'每日领取',note:'',source:'s',status:'defined',needs:['n']},
] }
const source = (d: CommerceDataset) => ({snapshot:{store:{doc:{typeName:'document',meta:{commerceOverview:{version:1,dataset:d}}}}},revision:1})
afterEach(cleanup)
describe('native commerce design map',()=>{
  it('persists six movable native cards and bound arrows without duplicating source facts',()=>{
    const before=JSON.stringify(data), snapshot=createPayRhythmSnapshot('source-board',data)
    const records=Object.values(snapshot.store), cards=records.filter(r=>r.typeName==='shape' && readDesignCard(r))
    expect(cards).toHaveLength(6)
    expect(records.filter(r=>r.typeName==='binding')).toHaveLength(8)
    expect(cards.every(r=>r.typeName==='shape' && r.type==='geo' && !r.isLocked)).toBe(true)
    expect(JSON.stringify(snapshot)).not.toContain('¥18')
    expect(JSON.stringify(snapshot)).not.toContain('测试券')
    expect(JSON.stringify(snapshot)).not.toContain('commerceOverview')
    expect(readDesignMap(records.find(r=>r.typeName==='document')?.meta)?.sourceBoardId).toBe('source-board')
    const store=createBoardStore();loadSnapshotIntoStore(store,snapshot)
    expect(getStoreSnapshot(store).store).toEqual(snapshot.store)
    expect(JSON.stringify(data)).toBe(before)
  })
  it('resolves changed source prices and missing references without guessing zero orders',()=>{
    const snapshot=createPayRhythmSnapshot('source-board',data), card=readDesignCard(snapshot.store['shape:rhythm-first-implementation' as TLGeoShape['id']]!)!
    const changed={...data,products:data.products.map(p=>({...p,price:'¥12'}))}
    expect(linkedProducts(changed,card)[0]?.price).toBe('¥12')
    expect(linkedProducts({...data,products:[]},card)).toEqual([])
    expect(designPayments(data,card)).toBeUndefined()
    expect(datasetFromSnapshot(source(changed).snapshot)?.products[0]?.price).toBe('¥12')
  })
  it('edits design text without changing product identity or writing product values',()=>{
    const snapshot=createPayRhythmSnapshot('source-board',data), shape=snapshot.store['shape:rhythm-first-design' as TLGeoShape['id']] as TLGeoShape
    const next=updateDesignCard(shape,{title:'新的设计目标',goal:'补强',measure:'推进',decision:'draft'})
    expect(readDesignCard(next)?.productKeys).toEqual(readDesignCard(shape)?.productKeys)
    expect(readDesignCard(next)?.title).toBe('新的设计目标')
    expect(readDesignCard(shape)?.title).not.toBe('新的设计目标')
  })
  it('refreshes referenced facts and opens details without modifying the saved canvas',async()=>{
    const store=createBoardStore(), snapshot=createPayRhythmSnapshot('source-board',data); loadSnapshotIntoStore(store,snapshot)
    const shape=store.get('shape:rhythm-first-implementation' as TLGeoShape['id']) as TLGeoShape
    const loader=vi.fn().mockResolvedValue(source(data)), before=JSON.stringify(getStoreSnapshot(store))
    render(<CommerceDesignCanvas sourceBoardId="source-board" loadSource={loader} store={store} editorRef={{current:undefined}} canEdit={()=>false}><CommerceDesignCard shape={shape} /></CommerceDesignCanvas>)
    await screen.findByText('¥6')
    loader.mockResolvedValue(source({...data,products:data.products.map(p=>({...p,price:'¥12'}))}))
    fireEvent.click(screen.getByRole('button',{name:'刷新引用'}))
    await screen.findByText('¥12')
    fireEvent.click(screen.getByRole('button',{name:'展开首充实现'}))
    await screen.findByText('分日奖励合计')
    expect(JSON.stringify(getStoreSnapshot(store))).toBe(before)
  })
  it('discards late data from a previously viewed source',async()=>{
    const store=createBoardStore(); loadSnapshotIntoStore(store,createPayRhythmSnapshot('a',data))
    let resolveA!:(value:ReturnType<typeof source>)=>void
    const loader=vi.fn((id:string)=>id==='a'?new Promise<ReturnType<typeof source>>(resolve=>{resolveA=resolve}):Promise.resolve(source({...data,created:'new-source'})))
    const props={loadSource:loader,store,editorRef:{current:undefined},canEdit:()=>false,children:<div />}
    const view=render(<CommerceDesignCanvas {...props} sourceBoardId="a" />)
    view.rerender(<CommerceDesignCanvas {...props} sourceBoardId="b" />)
    await screen.findByText('引用已更新 · 配置 new-source')
    await act(async()=>resolveA(source(data)))
    expect(screen.getByText('引用已更新 · 配置 new-source')).toBeInTheDocument()
  })
  it('reports failed refresh instead of presenting stale evidence as current',async()=>{
    const store=createBoardStore();loadSnapshotIntoStore(store,createPayRhythmSnapshot('source-board',data))
    const loader=vi.fn().mockResolvedValue(source(data))
    render(<CommerceDesignCanvas sourceBoardId="source-board" loadSource={loader} store={store} editorRef={{current:undefined}} canEdit={()=>false}><div /></CommerceDesignCanvas>)
    await screen.findByText('引用已更新 · 配置 2026-10-27')
    loader.mockRejectedValue(new Error('连接中断'))
    fireEvent.click(screen.getByRole('button',{name:'刷新引用'}))
    await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('引用未更新：连接中断'))
  })
})
