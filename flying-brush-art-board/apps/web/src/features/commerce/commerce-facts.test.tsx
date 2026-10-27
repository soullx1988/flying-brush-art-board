import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { parseRecordedRewards, productFacts } from './commerce-facts'
import { ProductFacts } from './CommerceFactsView'
import { applyCatalogUpdate } from './commerce-catalog'
import type { CommerceDataset, CommerceProduct } from './commerce-data'

afterEach(cleanup)
const reward={id:300141,name:'武器抽取券',n:20}
const p:CommerceProduct={key:'gift:215',sku:'215',title:'日礼包 · 武器抽招募券',kind:'diamond',channel:'日礼包',price:'260 钻石',rewards:[reward],rid:null,limit:'5次 / 日',note:'',source:'gift',status:'defined',needs:['weapon']}
const purchase={key:p.key,giftId:215,server:102,date:'2026-10-25',orders:150,buyers:20,diamonds:39000,prices:[260],rewards:['武器抽取券x8']}
const makeData=()=>({
  created:'2026-10-27', scope:'配置核对', products:[structuredClone(p)],
  needs:[{id:'weapon',name:'武器',question:'',why:'',principle:''}],
  sources:{gift:{name:'source',path:'/source',sha256:'old'}},
  evidence:{
    icons:{}, assets:{},
    ledger:{purchases:[structuredClone(purchase)],payments:[],giftScope:{servers:[102]}},
    revenue:{servers:[{id:102,group:'king'},{id:100,group:'cold'}]},
  },
} as unknown as CommerceDataset)

describe('configuration versus actual rewards',()=>{
  it('shows 8 from SKU-bearing logs while retaining 20 in the source definition',()=>{
    const d=makeData(), before=JSON.stringify(d), f=productFacts(d,p)
    expect(f.actual).toEqual([{...reward,n:8}]);expect(f.difference).toBe(true)
    render(<ProductFacts data={d} product={p} compact />)
    expect(screen.getByText('武器抽取券 × 8')).toBeInTheDocument()
    expect(screen.getByText('源表：武器抽取券 × 20')).toBeInTheDocument()
    expect(JSON.stringify(d)).toBe(before)
  })
  it('compares concatenated rewards irrespective of order and rejects ambiguous/unrecognized content',()=>{
    const r=[reward,{id:300144,name:'武器精粹',n:800}]
    expect(parseRecordedRewards('武器精粹x800武器抽取券x8',r)).toEqual([r[1],{...reward,n:8}])
    expect(parseRecordedRewards('未知道具x8',r)).toBeUndefined()
    expect(parseRecordedRewards('武器抽取券x8.5',r)).toBeUndefined()
    expect(parseRecordedRewards('武器抽取券x8',[reward,{...reward,id:9}])).toBeUndefined()
  })
  it('does not erase a bundled reward absent from logs, conflate versions, or borrow another server group',()=>{
    const d=makeData(), withBundle={...p,rewards:[reward,{id:3205,name:'随机宝石',n:1}]}
    expect(productFacts(d,withBundle)).toMatchObject({actual:undefined,incomplete:true,rewards:withBundle.rewards})
    d.evidence!.ledger!.purchases.push({...purchase,date:'2026-10-26',rewards:['武器抽取券x10']})
    expect(productFacts(d,p)).toMatchObject({actual:undefined,varied:true,rewards:p.rewards})
    expect(productFacts(d,p,'cold')).toMatchObject({actual:undefined,hasRecords:false,rewards:p.rewards})
  })
  it('compares price as well as rewards and retains each historical variant',()=>{
    const d=makeData(), sameReward={...p,rewards:[{...reward,n:8}],price:'1200 钻石'}
    expect(productFacts(d,sameReward)).toMatchObject({difference:true,price:'260 钻石'})
    d.evidence!.ledger!.purchases.push({...purchase,date:'2026-10-26',prices:[320]})
    expect(productFacts(d,sameReward)).toMatchObject({difference:true,price:'260 / 320 钻石',prices:[260,320]})
  })
  it('shows free/ad claim evidence without inventing diamond spend or borrowing another server group',()=>{
    const d=makeData();d.evidence!.ledger!.purchases=[]
    d.evidence!.catalogReview={audit:{claims:[{key:p.key,server:102,date:'2026-10-25',orders:3,rewards:['武器抽取券x1']}]}} as NonNullable<CommerceDataset['evidence']>['catalogReview']
    expect(productFacts(d,p)).toMatchObject({claimOnly:true,orders:3,prices:[],actual:[{...reward,n:1}],difference:true})
    expect(productFacts(d,p,'cold')).toMatchObject({hasRecords:false,actual:undefined})
    expect(d.evidence!.ledger!.purchases).toEqual([])
  })
  it('retains a debit with no ordinary reward as incomplete, never as zero delivered',()=>{
    const d=makeData();d.evidence!.ledger!.purchases[0]!.rewards=['']
    expect(productFacts(d,p)).toMatchObject({price:'260 钻石',prices:[260],actual:undefined,incomplete:true,rewards:p.rewards})
  })
  it('recalculates differences after a genuine source refresh instead of hiding them behind source hashes',()=>{
    const d=makeData(), update={created:'2026-10-27',scope:'refreshed',baseSources:{gift:'old'},baseProducts:structuredClone(d.products),sources:{gift:{name:'new',path:'/new',sha256:'new'}},products:[{...p,rewards:[{...reward,n:8}]}]}
    const next=applyCatalogUpdate(d,update)
    expect(productFacts(next,next.products[0]!)).toMatchObject({difference:false,actual:[{...reward,n:8}]})
    expect(next.evidence).toBe(d.evidence);expect(next.needs).toBe(d.needs)
    expect(()=>applyCatalogUpdate({...d,products:[{...p,note:'new decision'}]},update)).toThrow('商品或来源已变化')
    expect(()=>applyCatalogUpdate(d,{...update,products:[]})).toThrow('商品身份或设计关联')
    expect(()=>applyCatalogUpdate(d,{...update,products:[{...p,rid:33}]})).toThrow('商品身份或设计关联')
    expect(()=>applyCatalogUpdate(d,{...update,products:[{...p,needs:['missing']}]})).toThrow('新商品身份')
  })
})
