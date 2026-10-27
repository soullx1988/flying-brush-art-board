import { describe, expect, it } from 'vitest'
import { commerceEvidenceSchema, validateEvidenceForDataset, type CommerceEvidence } from './commerce-evidence'
import { missingHistoryReason } from './CommerceEvidenceView'
import type { CommerceProduct } from './commerce-data'

const evidence: CommerceEvidence = {
  updated:'2026-10-26', sourceHashes:{config:'original'}, assets:{}, icons:{}, placements:{},
  history:{ source:{path:'local-backup',sha256:'a'.repeat(64)},readAt:'2026-10-21',population:'test cohort',timeBasis:'created time',versionNote:'version pending',limitations:[],records:3,successCashOrders:2,successCashYuan:60,failedOrPending:1,voucherOrders:0,unresolved:[],
    byProduct:{'gift:505':{rechargeId:505,orders:2,buyers:1,yuan:60,prices:[30],failedOrPending:1,voucherOrders:0,firstDate:'2026-10-15',lastDate:'2026-10-16',daily:[{date:'2026-10-15',server:102,orders:1,buyers:1,yuan:30},{date:'2026-10-16',server:102,orders:1,buyers:1,yuan:30}]}} },
}
const data = {sources:{config:{sha256:'original'}},products:[{key:'gift:505',rid:505}]}

describe('commerce evidence',()=>{
  it('accepts cohort-distinct buyers while checking daily count and amount totals',()=>{
    expect(commerceEvidenceSchema.safeParse(evidence).success).toBe(true)
    const invalid=structuredClone(evidence); invalid.history.byProduct['gift:505']!.yuan=61
    expect(commerceEvidenceSchema.safeParse(invalid).success).toBe(false)
  })
  it('rejects stale configuration and ambiguous recharge mappings',()=>{
    expect(()=>validateEvidenceForDataset(evidence,data)).not.toThrow()
    expect(()=>validateEvidenceForDataset(evidence,{...data,sources:{config:{sha256:'changed'}}})).toThrow('来源配置已变化')
    expect(()=>validateEvidenceForDataset(evidence,{...data,products:[...data.products,{key:'other',rid:505}]})).toThrow('对应不唯一')
  })
  it('does not claim that cash records cover a diamond product or that missing records mean zero sales',()=>{
    expect(missingHistoryReason({kind:'diamond'} as CommerceProduct,evidence)).toBe('未接入钻石购买流水')
    expect(missingHistoryReason({kind:'cash'} as CommerceProduct,evidence)).toBe('本批备份未见可关联成功订单')
  })
})
