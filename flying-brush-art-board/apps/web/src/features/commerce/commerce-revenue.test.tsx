import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { productReportUrl, productRevenue, summarizeRevenue, testRevenueSchema, type TestRevenue } from './commerce-revenue'
import { CommerceBoardView } from './CommerceBoardView'
import type { CommerceDataset } from './commerce-data'
import { mergeCommerceEvidence } from './commerce-evidence'
import { HistoryScopeNotice } from './CommerceRevenueView'

afterEach(cleanup)
const source = { path: 'local-test-fixture', sha256: 'a'.repeat(64) }
const report: TestRevenue = {
  id:'test',title:'测试',from:'2026-10-13',through:'2026-10-26',readAt:'2026-10-27',cashBasis:'现金',productBasis:'含券',coverage:'测试范围',limitations:[],dailyUrl:'https://example.com/daily',productUrl:'https://example.com/products',backup:source,sources:[source],unresolved:[],
  servers:[{id:102,name:'王者1服',group:'king',cashBuyers:1,cashOrders:2,cashYuan:60,productOrders:3,productYuan:90},{id:1,name:'先遣1服',group:'cold',cashBuyers:1,cashOrders:1,cashYuan:30,productOrders:4,productYuan:120}],
  daily:[{server:102,date:'2026-10-14',orders:1,yuan:30,buyers:1},{server:102,date:'2026-10-15',orders:1,yuan:30,buyers:1},{server:1,date:'2026-10-13',orders:1,yuan:30,buyers:1}],
  products:[{server:102,rechargeId:505,type:8,name:'测试礼包',configuredYuan:30,orders:3,yuan:90,buyerDays:2,voucherBuyerDays:1},{server:1,rechargeId:505,type:8,name:'测试礼包',configuredYuan:30,orders:4,yuan:120,buyerDays:2,voucherBuyerDays:1}],
}
const data: CommerceDataset = {created:'2026-10-26',scope:'配置快照',sources:{s:{name:'测试配置',...source}},needs:[{id:'hero',name:'招募补给',question:'需要什么资源？',why:'候选',principle:'待确认'}],products:[{key:'gift',sku:'505',rid:505,title:'测试礼包',kind:'cash',channel:'每日特惠礼包',price:'30 元',limit:'每日1次',note:'',status:'defined',source:'s',rewards:[],needs:['hero']}],evidence:{updated:'2026-10-27',sourceHashes:{s:source.sha256},assets:{},icons:{},placements:{},revenue:report,history:{source,readAt:'2026-10-21',population:'旧样本',timeBasis:'',versionNote:'',limitations:[],records:1,successCashOrders:1,successCashYuan:999,failedOrPending:0,voucherOrders:0,byProduct:{},unresolved:[]}}}

describe('test-period revenue',()=>{
  it('keeps the test report when refreshing an older image/order bundle',()=>{
    const older=structuredClone(data.evidence!); delete older.revenue
    expect(mergeCommerceEvidence(older,data.evidence).revenue).toEqual(report)
    const newer={...data.evidence!,revenue:{...report,id:'next'}}
    expect(mergeCommerceEvidence(newer,data.evidence).revenue?.id).toBe('next')
  })
  it('preserves different accounting bases and never adds the old sample or daily buyers',()=>{
    expect(testRevenueSchema.safeParse(report).success).toBe(true)
    expect(summarizeRevenue(report,'all')).toMatchObject({cashYuan:90,productYuan:210,cashBuyers:2,cashOrders:3})
    expect(summarizeRevenue(report,'king')).toMatchObject({cashYuan:60,productYuan:90,cashBuyers:1})
    expect(productRevenue(data,data.products[0]!,'king')).toMatchObject({orders:3,yuan:90,buyerDays:2})
  })
  it('rejects duplicated, out-of-period and unreconciled data',()=>{
    const duplicate=structuredClone(report); duplicate.daily.push(duplicate.daily[0]!)
    expect(testRevenueSchema.safeParse(duplicate).success).toBe(false)
    const wrong=structuredClone(report); wrong.servers[0]!.cashYuan++
    expect(testRevenueSchema.safeParse(wrong).success).toBe(false)
    const outside=structuredClone(report); outside.daily[0]!.date='2026-10-27'
    expect(testRevenueSchema.safeParse(outside).success).toBe(false)
  })
  it('does not attach an ambiguous recharge ID or turn missing records into zero',()=>{
    const p=data.products[0]!
    expect(productRevenue({...data,products:[p,{...p,key:'duplicate'}]},p,'all')).toBeUndefined()
    expect(productRevenue(data,p,'expedition')).toBeUndefined()
    expect(productRevenue(data,{...p,rid:999},'all')).toBeUndefined()
    expect(productReportUrl(report,102)).toContain('serverId=102&beginDate=1791820800&endDate=1793030400&pid=')
  })
  it('opens the design-to-results chain from revenue and returns to the same revenue scope',()=>{
    render(<CommerceBoardView data={data}/>)
    expect(screen.getByText('¥90')).toBeInTheDocument()
    expect(screen.queryByText('¥999')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button',{name:'查看测试营收'}))
    fireEvent.click(screen.getByRole('button',{name:'查看测试商品 测试礼包 505'}))
    expect(screen.getByRole('heading',{name:'01 设计预期 →'})).toBeInTheDocument()
    expect(screen.getByRole('heading',{name:'02 配置与实际 →'})).toBeInTheDocument()
    expect(screen.getByRole('heading',{name:'03 数据验证'})).toBeInTheDocument()
    expect(screen.getByText('¥210')).toBeInTheDocument()
    expect(screen.getByText('目标未设定，暂不能判定。')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button',{name:'返回测试营收'}))
    expect(screen.getByRole('table',{name:'测试商品贡献'})).toBeInTheDocument()
  })
})

describe('product filters and historical server scope', () => {
  const scopedData: CommerceDataset = structuredClone(data)
  scopedData.needs.push({id:'gem',name:'宝石',question:'宝石需求',why:'候选',principle:'待确认'})
  scopedData.products.push(
    {...data.products[0]!, key:'gift:204',sku:'204',rid:undefined,title:'招募券',channel:'日礼包',kind:'diamond',price:'480 钻石'},
    {...data.products[0]!, key:'gift:205',sku:'205',rid:undefined,title:'未见记录的礼包',channel:'日礼包',kind:'diamond'},
    {...data.products[0]!, key:'gift:206',sku:'206',rid:undefined,title:'宝石礼包',channel:'日礼包',kind:'diamond',needs:['gem']},
  )
  const scope = {label:'已知角色',from:report.from,through:report.through,readAt:report.readAt,roles:5,servers:[102],limitations:[]}
  scopedData.evidence!.ledger = {orderScope:scope,giftScope:scope,sources:[source],backup:source,payments:[],purchases:[{key:'gift:204',giftId:204,server:102,date:'2026-10-20',orders:12,buyers:5,diamonds:5760,prices:[480],rewards:['招募券x20']}],unidentified:{label:'无',rows:0,diamonds:0,dailyRecruitCandidates:0,limitations:[]},audits:{},gaps:[]}
  const choose = (label: string, option: string) => {
    fireEvent.click(screen.getByRole('combobox', {name:label}))
    fireEvent.click(screen.getByRole('option', {name:option}))
  }

  it('keeps product definitions until history-only is chosen, and intersects server scope with player needs', () => {
    render(<CommerceBoardView data={scopedData} />)
    fireEvent.click(screen.getByRole('button', {name:'按玩家需求比较'}))
    choose('玩家需求','招募补给')
    expect(within(screen.getByRole('table', {name:'商品清单'})).getAllByRole('row')).toHaveLength(4)
    expect(screen.queryByRole('button', {name:'查看 宝石礼包 206'})).not.toBeInTheDocument()
    expect(screen.getByText('12 笔钻石购买')).toBeInTheDocument()
    choose('历史数据区服','王者')
    expect(screen.getByText('12 笔钻石购买')).toBeInTheDocument()
    expect(screen.getByText(/当前钻石流水仅来自王者/)).toBeInTheDocument()
    expect(screen.getByText('¥90 商品订单金额')).toBeInTheDocument()
    expect(within(screen.getByRole('table', {name:'商品清单'})).getAllByRole('row')).toHaveLength(4)
    choose('历史数据区服','冷启动')
    expect(screen.queryByText('12 笔钻石购买')).not.toBeInTheDocument()
    expect(screen.getAllByText('所选区服尚未接入流水')).toHaveLength(2)
    expect(screen.getByText('¥120 商品订单金额')).toBeInTheDocument()
    expect(screen.getByText(/该范围钻石流水尚未接入，不代表没有购买/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', {name:'只看有记录的商品'}))
    expect(within(screen.getByRole('table', {name:'商品清单'})).getAllByRole('row')).toHaveLength(2)
    expect(screen.getByRole('heading', {name:'按玩家需求比较'})).toBeInTheDocument()
    choose('历史数据区服','王者')
    expect(within(screen.getByRole('table', {name:'商品清单'})).getAllByRole('row')).toHaveLength(3)
    expect(screen.queryByRole('button', {name:'查看 未见记录的礼包 205'})).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', {name:'清除商品筛选'}))
    expect(screen.getByRole('checkbox', {name:'只看有记录的商品'})).not.toBeChecked()
    expect(within(screen.getByRole('table', {name:'商品清单'})).getAllByRole('row')).toHaveLength(5)
    expect(screen.getByRole('combobox', {name:'历史数据区服'})).toHaveTextContent('王者')
  })

  it('derives coverage explanations from the latest evidence instead of hard-coding the current five servers', () => {
    const {rerender} = render(<HistoryScopeNotice data={scopedData} group="king" />)
    expect(screen.getByRole('status')).toHaveTextContent('钻石流水覆盖其中 1 服的已知角色')
    expect(screen.getByRole('status')).toHaveTextContent('笔数相同')
    const expanded = structuredClone(scopedData)
    expanded.evidence!.ledger!.giftScope.servers.push(1)
    rerender(<HistoryScopeNotice data={expanded} group="all" />)
    expect(screen.getByRole('status')).toHaveTextContent('钻石流水覆盖其中 2 服的已知角色')
    expect(screen.getByRole('status')).not.toHaveTextContent('笔数相同')
  })
})
