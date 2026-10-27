import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { commerceLedgerSchema, ledgerRows, type CommerceLedger } from './commerce-ledger'
import { mergeCommerceEvidence, validateEvidenceForDataset } from './commerce-evidence'
import { ProductLedger, ProductAudit } from './CommerceLedgerView'
import type { CommerceDataset } from './commerce-data'
import { entranceFor } from './commerce-browse'

afterEach(cleanup)
const source={path:'fixture',sha256:'a'.repeat(64)}
const scope={label:'已导出的角色样本',from:'2026-10-13',through:'2026-10-26',readAt:'2026-10-27',roles:5,servers:[102],limitations:['不能外推全期']}
const ledger: CommerceLedger={orderScope:scope,giftScope:scope,sources:[source],backup:source,
  payments:[{key:'gift:7',rechargeId:7,server:102,cashOrders:2,cashYuan:12,cashBuyers:1,voucherOrders:1,voucherOrderYuan:6,voucherBuyers:1,unsuccessful:3}],
  purchases:[{key:'gift:204',giftId:204,server:102,date:'2026-10-20',orders:12,buyers:5,diamonds:5760,prices:[480],rewards:['招募券x20']}],
  unidentified:{label:'缺ID',rows:1335,diamonds:640800,dailyRecruitCandidates:1335,limitations:[]},audits:{'gift:21001':{label:'配置存在 · 测试开放待核验',detail:'配置不能证明开放',sources:['工程']}},gaps:[]}
const data: CommerceDataset={created:'2026-10-27',scope:'测试',needs:[],sources:{s:{name:'fixture',...source}},products:[{key:'gift:204',sku:'204',title:'招募券',channel:'日礼包',kind:'diamond',price:'480钻石',rewards:[],limit:'',note:'',source:'s',status:'defined',needs:['hero']},{key:'gift:7',sku:'7',rid:7,title:'首充',channel:'首充',kind:'cash',price:'6元',rewards:[],limit:'',note:'',source:'s',status:'defined',needs:['hero']}],evidence:{updated:'2026-10-27',sourceHashes:{s:source.sha256},assets:{},icons:{},placements:{},ledger,history:{source,readAt:'2026-10-21',population:'',timeBasis:'',versionNote:'',limitations:[],records:0,successCashOrders:0,successCashYuan:0,failedOrPending:0,voucherOrders:0,byProduct:{},unresolved:[]}}}

describe('SKU payment evidence',()=>{
  it('shows confirmed SKU purchases separately from price-matched candidates',()=>{
    render(<ProductLedger data={data} product={data.products[0]!} group="all" />)
    expect(screen.getByText('12 笔')).toBeInTheDocument()
    expect(screen.getByText('5,760 钻石')).toBeInTheDocument()
    expect(screen.getByText(/1,335.*未按候选笔数累加/)).toBeInTheDocument()
    expect(ledgerRows(data,data.products[0]!,'cold').purchases).toEqual([])
  })
  it('keeps voucher order amount out of cash and retains missing availability',()=>{
    render(<ProductLedger data={data} product={data.products[1]!} group="all" />)
    expect(screen.getByText('¥12')).toBeInTheDocument();expect(screen.getByText('¥6')).toBeInTheDocument()
    expect(screen.queryByText('¥18')).not.toBeInTheDocument()
    render(<ProductAudit data={data} product={{...data.products[0]!,key:'gift:21001'}} compact />)
    expect(screen.getByText('配置存在 · 测试开放待核验')).toBeInTheDocument()
    expect(entranceFor({...data.products[0]!,channel:'通关礼包'}).id).toBe('shop')
  })
  it('rejects duplicated or wrongly mapped ledger evidence',()=>{
    expect(commerceLedgerSchema.safeParse(ledger).success).toBe(true)
    const bad=structuredClone(ledger);bad.purchases.push(bad.purchases[0]!)
    expect(commerceLedgerSchema.safeParse(bad).success).toBe(false)
    const changed=structuredClone(data.evidence!);changed.ledger!.payments[0]!.rechargeId=8
    expect(()=>validateEvidenceForDataset(changed,data)).toThrow('支付明细商品对应不唯一')
  })
  it('preserves the ledger when an older bundle refreshes only images',()=>{
    const older=structuredClone(data.evidence!);delete older.ledger
    expect(mergeCommerceEvidence(older,data.evidence).ledger).toEqual(ledger)
  })
})
