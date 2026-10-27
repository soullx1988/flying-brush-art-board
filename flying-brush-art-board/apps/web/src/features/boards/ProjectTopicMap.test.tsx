import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectTopicMap } from './ProjectTopicMap'
import type { ProjectRecord, StoredBoard, BoardReferenceRecord } from '@infinite-board/board-core'
afterEach(cleanup)
const project:ProjectRecord={id:'p',title:'Design',rootBoardId:'shop',formatVersion:1,createdAt:'',updatedAt:'',navigation:{version:1,revision:1,topics:[{id:'topic:commerce',title:'商业模式',description:'卖什么、怎么卖'}],parents:{shop:'topic:commerce',monthly:'shop',resource:'topic:commerce'}}}
const boards:StoredBoard[]=[['shop','特惠'],['monthly','月卡'],['resource','货币与资源'],['new','新画板']].map(([id,title])=>({id:id!,title:title!,projectId:'p',tldrawSnapshot:{store:{}},revision:0,createdAt:'',updatedAt:''}))
const references:BoardReferenceRecord[]=[['r1','monthly','resource'],['r2','shop','resource'],['r3','monthly','resource']].map(([id,sourceBoardId,targetBoardId])=>({id:id!,projectId:'p',sourceBoardId:sourceBoardId!,targetBoardId:targetBoardId!,shapeId:`shape:${id}`,kind:'link',createdAt:'',updatedAt:''}))
describe('topic map navigation',()=>{
  it('opens the existing commerce overview from its topic without a duplicate catalog or hardcoded board id',()=>{
    const open=vi.fn()
    const catalog:StoredBoard={id:'catalog',title:'任意命名',projectId:'p',tldrawSnapshot:{store:{doc:{typeName:'document',meta:{commerceOverview:{version:1,dataset:{products:[]}}}}}},revision:0,createdAt:'',updatedAt:''}
    const updated:ProjectRecord={...project,navigation:{...project.navigation!,parents:{...project.navigation!.parents,catalog:'topic:commerce'}}}
    render(<ProjectTopicMap project={updated} boards={[...boards,catalog]} references={references} onOpenBoard={open} />)
    fireEvent.click(screen.getByRole('button',{name:'商业模式'}))
    expect(open).toHaveBeenCalledWith('catalog','current')
    fireEvent.click(screen.getByRole('button',{name:'查看设计资料'}))
    expect(screen.getByRole('button',{name:'打开 任意命名'})).toBeInTheDocument()
  })
  it('shows a topic, drills into children, exposes unclassified boards and opens existing content',()=>{
    const onOpenBoard=vi.fn()
    render(<ProjectTopicMap project={project} boards={boards} references={references} onOpenBoard={onOpenBoard} />)
    expect(screen.getByRole('button',{name:'待归类'})).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button',{name:'商业模式'}))
    fireEvent.click(screen.getByRole('button',{name:'查看下级内容 · 1'}))
    const hierarchy=within(screen.getByRole('region',{name:'当前层级'}))
    fireEvent.click(hierarchy.getByRole('button',{name:'打开 月卡'}))
    expect(onOpenBoard).toHaveBeenCalledWith('monthly','current')
  })
  it('searches paths and reflects board renames without changing ownership',()=>{
    const {rerender}=render(<ProjectTopicMap project={project} boards={boards} references={references} onOpenBoard={vi.fn()} />)
    fireEvent.change(screen.getByRole('textbox',{name:'搜索主题地图'}),{target:{value:'商业模式'}})
    expect(screen.getByText('商业模式 › 特惠 › 月卡')).toBeInTheDocument()
    rerender(<ProjectTopicMap project={project} boards={boards.map(b=>b.id==='monthly'?{...b,title:'新月卡'}:b)} references={references} onOpenBoard={vi.fn()} />)
    expect(screen.getByText('商业模式 › 特惠 › 新月卡')).toBeInTheDocument()
  })
  it('groups duplicate links by direction and locates shared resources at their single home',()=>{
    render(<ProjectTopicMap project={project} boards={boards} references={references} initialFocus="monthly" onOpenBoard={vi.fn()} />)
    expect(screen.queryByRole('region',{name:'局部引用关系'})).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button',{name:'查看画板引用资料 · 1'}))
    const relations=within(screen.getByRole('region',{name:'局部引用关系'}))
    expect(relations.getByText('1 个引用方向 / 2 条引用')).toBeInTheDocument()
    expect(relations.getByText('商业模式 › 货币与资源')).toBeInTheDocument()
    expect(relations.getAllByRole('button',{name:'货币与资源'})).toHaveLength(1)
  })
})
