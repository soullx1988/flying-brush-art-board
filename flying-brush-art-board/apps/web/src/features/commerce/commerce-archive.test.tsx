import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { archivedRevenueSchema, archiveRows, isPartialDay, type ArchivedRevenue } from './commerce-archive'
import { CommerceArchiveView } from './CommerceArchiveView'
import { mergeCommerceEvidence, type CommerceEvidence } from './commerce-evidence'
import { CommerceBoardView } from './CommerceBoardView'
import type { CommerceDataset } from './commerce-data'

afterEach(cleanup)
const source = {path:'fixture.json',sha256:'a'.repeat(64)}
const report: ArchivedRevenue = {id:'june',title:'6 月测试备份',from:'2026-06-11',through:'2026-06-12',importedAt:'2026-10-27T12:00:00+08:00',servers:[{id:501,name:'王者1服',group:'king'},{id:11,name:'魔灵1服',group:'moling'}],daily:[{server:501,date:'2026-06-11',yuan:100,capturedAt:'2026-06-12T10:00:00+08:00',source:source.path},{server:11,date:'2026-06-12',yuan:30,capturedAt:'2026-06-12T14:00:00+08:00',orders:2,source:source.path}],inputFiles:5,emptyFiles:1,basis:'报表原值，未拆现金或代金券',coverage:'非全期',limitations:[],gaps:['缺商品ID及消费日志'],sources:[source],backup:source}
const evidence: CommerceEvidence = {updated:'2026-10-27',sourceHashes:{},assets:{},icons:{},placements:{},archives:[report],history:{source,readAt:'2026-10-27',population:'October',timeBasis:'',versionNote:'',limitations:[],records:0,successCashOrders:0,successCashYuan:0,failedOrPending:0,voucherOrders:0,byProduct:{},unresolved:[]}}

describe('archived test revenue',()=>{
  it('shows a real single-server result after opening it from a later all-server page',()=>{
    const daily = Array.from({length: 15}, (_, i) => ({...report.daily[0]!, date:`2026-06-${String(i+1).padStart(2,'0')}`}))
    render(<CommerceArchiveView report={{...report,daily:[...daily,report.daily[1]!]}} />)
    fireEvent.click(screen.getByRole('button',{name:'第 2 页'}))
    fireEvent.click(screen.getByRole('button',{name:'查看 S11 逐日备份'}))
    const table = screen.getByRole('table',{name:'历史逐日充值备份'})
    expect(within(table).getByText('¥30')).toBeInTheDocument()
    expect(within(table).queryByText('暂无数据')).not.toBeInTheDocument()
    expect(screen.getByRole('heading',{name:'S11 魔灵1服 · 逐日充值记录'})).toHaveFocus()
    fireEvent.click(screen.getByRole('button',{name:'返回本组全部区服'}))
    expect(screen.getByRole('status')).toHaveTextContent('第 1 / 2 页')
    fireEvent.click(screen.getByRole('combobox',{name:'备份区服分组'}))
    fireEvent.click(screen.getByRole('option',{name:'魔灵'}))
    expect(within(screen.getByRole('table',{name:'历史逐日充值备份'})).getByText('¥30')).toBeInTheDocument()
  })
  it('rejects duplicate server-days and preserves unknown order counts and partial days',()=>{
    expect(archivedRevenueSchema.safeParse(report).success).toBe(true)
    expect(archivedRevenueSchema.safeParse({...report,daily:[...report.daily,report.daily[0]]}).success).toBe(false)
    expect(archiveRows(report,'king')).toHaveLength(1)
    expect(archiveRows(report,'moling')[0]?.orders).toBe(2)
    expect(archiveRows(report,'king')[0]?.orders).toBeUndefined()
    expect(isPartialDay(report.daily[0]!)).toBe(false)
    expect(isPartialDay(report.daily[1]!)).toBe(true)
  })
  it('filters actual archived values by group and server without presenting missing orders as zero',()=>{
    render(<CommerceArchiveView report={report} />)
    expect(screen.getAllByText('¥130')).toHaveLength(1)
    expect(within(screen.getByRole('table',{name:'历史逐日充值备份'})).getByText('原表未保留')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('combobox',{name:'备份区服分组'}))
    fireEvent.click(screen.getByRole('option',{name:'魔灵'}))
    expect(screen.queryByText('¥130')).not.toBeInTheDocument()
    expect(screen.queryByRole('button',{name:'查看 S501 逐日备份'})).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button',{name:'查看 S11 逐日备份'}))
    expect(screen.getByRole('heading',{name:'S11 魔灵1服 · 逐日充值记录'})).toBeInTheDocument()
  })
  it('preserves historical batches when a later image or October import omits them',()=>{
    const older = structuredClone(evidence); delete older.archives
    expect(mergeCommerceEvidence(older,evidence).archives).toEqual([report])
    const newer = {...evidence,archives:[{...report,title:'更新后的六月'}]}
    expect(mergeCommerceEvidence(newer,evidence).archives).toHaveLength(1)
    expect(mergeCommerceEvidence(newer,evidence).archives?.[0]?.title).toBe('更新后的六月')
  })
  it('opens the June archive from the paid-points board and can return to current product design',()=>{
    const data: CommerceDataset = {created:'2026-10-27',scope:'current',sources:{},needs:[],products:[],evidence}
    render(<CommerceBoardView data={data} />)
    fireEvent.click(screen.getByRole('combobox',{name:'历史测试批次'}))
    fireEvent.click(screen.getByRole('option',{name:'6 月测试备份'}))
    expect(screen.getByRole('heading',{name:'6 月测试备份'})).toBeInTheDocument()
    expect(screen.getByText('缺商品ID及消费日志')).toBeInTheDocument()
    expect(screen.queryByRole('table',{name:'商品清单'})).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button',{name:'返回投放总览'}))
    expect(screen.getByRole('heading',{name:'商品与投放核对'})).toBeInTheDocument()
  })
})
