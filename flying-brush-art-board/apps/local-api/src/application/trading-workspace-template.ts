import { randomUUID } from 'node:crypto'
import { getIndexAbove } from 'tldraw'

import type {
  BoardReferenceRecord,
  ProjectRecord,
  StoredBoard,
} from '@infinite-board/board-core'
import {
  assertBoardReferenceSnapshotConsistent,
  createBoardReferenceShape,
  createTableProps,
  listBoardReferenceShapes,
  type TableShapeProps,
  type TradingPanelKind,
} from '@infinite-board/tldraw-adapter'

import type { LocalDatabase } from '../db/schema.js'
import type { BoardReferenceRepository } from '../modules/board-references/board-reference-repository.js'
import type { BoardRepository } from '../modules/boards/board-repository.js'
import type { ProjectRepository } from '../modules/projects/project-repository.js'
import { BoardOperationQueue } from '../modules/realtime/board-operation-queue.js'

export const TRADING_WORKSPACE_TEMPLATE_KEY = 'shortline-trading-v1'
export const TRADING_WORKSPACE_TEMPLATE_VERSION = 6

const BOARD_DEFINITIONS = [
  { key: 'today', title: '今天怎么看' },
  { key: 'data', title: '数据' },
  { key: 'logic', title: '逻辑' },
  { key: 'experience', title: '经验' },
  { key: 'mindset', title: '心态' },
] as const

type TradingWorkspaceBoardKey = (typeof BOARD_DEFINITIONS)[number]['key']

const TEMPLATE_ROLE_BY_BOARD_KEY: Record<TradingWorkspaceBoardKey, string> = {
  today: 'today-entry',
  data: 'data-entry',
  logic: 'logic-entry',
  experience: 'experience-entry',
  mindset: 'mindset-entry',
}

export interface TradingWorkspaceTemplate {
  project: ProjectRecord
  rootBoard: StoredBoard
  boards: StoredBoard[]
  references: BoardReferenceRecord[]
}

export type TradingWorkspaceBootstrapResult =
  | ({ status: 'created' | 'existing' } & TradingWorkspaceTemplate)
  | { status: 'retired' }

type IdFactory = () => string

function shapeRecord(
  id: string,
  index: string,
  x: number,
  y: number,
  type: string,
  props: object,
): Record<string, unknown> {
  return {
    id,
    typeName: 'shape',
    type,
    parentId: 'page:page',
    index,
    x,
    y,
    rotation: 0,
    isLocked: false,
    opacity: 1,
    meta: { template: TRADING_WORKSPACE_TEMPLATE_KEY },
    props,
  }
}

function tradingPanel(
  id: string,
  index: string,
  x: number,
  y: number,
  w: number,
  h: number,
  panelKind: TradingPanelKind,
  title: string,
  meta?: Record<string, unknown>,
): Record<string, unknown> {
  const shape = shapeRecord(id, index, x, y, 'trading-panel', { w, h, panelKind, title })
  if (meta) shape.meta = { ...(shape.meta as object), ...meta }
  return shape
}

function tableProps(headers: string[], rows: string[][], id: IdFactory): TableShapeProps {
  const props = createTableProps(rows.length + 1, headers.length, () => id())
  props.w = Math.max(980, headers.length * 190)
  props.h = Math.max(420, (rows.length + 1) * 58)
  const values = [headers, ...rows]
  props.rows.forEach((row, rowIndex) => {
    row.cells.forEach((cell, columnIndex) => {
      cell.text = values[rowIndex]?.[columnIndex] ?? ''
      cell.header = rowIndex === 0
      cell.bold = rowIndex === 0
      cell.background = rowIndex === 0 ? 'blue' : 'none'
      cell.fontSize = rowIndex === 0 ? 16 : 14
    })
  })
  return props
}

function dataBoardSnapshot(id: IdFactory): unknown {
  const records = [
    tradingPanel(`shape:${id()}`, 'a1', 0, 0, 900, 390, 'market-overview', '市场环境与主线'),
    tradingPanel(`shape:${id()}`, 'a2', 940, 0, 920, 520, 'stock-pool', '个人选股池'),
    tradingPanel(`shape:${id()}`, 'a3', 0, 430, 900, 520, 'announcements', '公告观察源'),
    tradingPanel(`shape:${id()}`, 'a4', 940, 560, 920, 390, 'system-status', '数据源与生产就绪状态'),
    tradingPanel(`shape:${id()}`, 'a5', 0, 1010, 1860, 1180, 'yishui-inference', '义水北路推演画板', {
      templateRole: 'yishui-inference-panel',
    }),
  ]
  return { store: Object.fromEntries(records.map((record) => [String(record.id), record])) }
}

function todayBoardSnapshot(id: IdFactory): unknown {
  const shapeId = `shape:${id()}`
  return {
    store: {
      [shapeId]: tradingPanel(
        shapeId,
        'a1',
        0,
        0,
        1860,
        900,
        'today-overview',
        '今天怎么看',
        { templateRole: 'today-core', protectedCore: true },
      ),
    },
  }
}

function snapshotStore(snapshot: unknown): Record<string, Record<string, unknown>> {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return {}
  const store = (snapshot as { store?: unknown }).store
  if (!store || typeof store !== 'object' || Array.isArray(store)) return {}
  return store as Record<string, Record<string, unknown>>
}

function hasTradingPanelKind(snapshot: unknown, panelKind: TradingPanelKind): boolean {
  return countTradingPanelKind(snapshot, panelKind) > 0
}

function countTradingPanelKind(snapshot: unknown, panelKind: TradingPanelKind): number {
  return Object.values(snapshotStore(snapshot)).filter((record) => (
    record.type === 'trading-panel'
    && typeof record.props === 'object'
    && !Array.isArray(record.props)
    && (record.props as { panelKind?: unknown }).panelKind === panelKind
  )).length
}

function nextDataPanelPlacement(snapshot: unknown): { index: string; x: number; y: number } {
  const shapes = Object.values(snapshotStore(snapshot)).filter((record) => record.typeName === 'shape')
  const lastIndex = shapes
    .map((shape) => typeof shape.index === 'string' ? shape.index : 'a0')
    .sort((left, right) => left.localeCompare(right))
    .at(-1) ?? 'a0'
  const bottomEdge = shapes.reduce((maximum, shape) => {
    const y = typeof shape.y === 'number' && Number.isFinite(shape.y) ? shape.y : 0
    const props = typeof shape.props === 'object' && shape.props !== null && !Array.isArray(shape.props)
      ? shape.props as { h?: unknown }
      : {}
    const height = typeof props.h === 'number' && Number.isFinite(props.h) ? props.h : 0
    return Math.max(maximum, y + height)
  }, -60)
  return { index: String(getIndexAbove(lastIndex as never)), x: 0, y: bottomEdge + 60 }
}

function appendYishuiInferencePanel(snapshot: unknown, id: IdFactory = randomUUID): unknown {
  if (hasTradingPanelKind(snapshot, 'yishui-inference')) return snapshot
  const nextSnapshot = structuredClone(snapshot) as { store?: Record<string, unknown> }
  if (!nextSnapshot.store || typeof nextSnapshot.store !== 'object' || Array.isArray(nextSnapshot.store)) {
    nextSnapshot.store = {}
  }
  const placement = nextDataPanelPlacement(nextSnapshot)
  const shapeId = `shape:${id()}`
  nextSnapshot.store[shapeId] = tradingPanel(
    shapeId,
    placement.index,
    placement.x,
    placement.y,
    1860,
    1180,
    'yishui-inference',
    '义水北路推演画板',
    { templateRole: 'yishui-inference-panel' },
  )
  return nextSnapshot
}

function templatePlacement(
  key: TradingWorkspaceBoardKey,
): { index: string; x: number; y: number } {
  if (key === 'today') return { index: 'a1', x: 0, y: 0 }
  if (key === 'data') return { index: 'a2', x: 660, y: 0 }
  if (key === 'logic') return { index: 'a3', x: 1320, y: 0 }
  if (key === 'experience') return { index: 'a4', x: 330, y: 370 }
  return { index: 'a5', x: 990, y: 370 }
}

function buildTemplateReferenceShape(
  reference: BoardReferenceRecord,
  title: string,
  key: TradingWorkspaceBoardKey,
  placement = templatePlacement(key),
): Record<string, unknown> {
  const shape = createBoardReferenceShape(
    reference,
    title,
    { ...placement, w: 620, h: 330 },
  )
  return {
    ...shape,
    meta: {
      template: TRADING_WORKSPACE_TEMPLATE_KEY,
      templateRole: TEMPLATE_ROLE_BY_BOARD_KEY[key],
      ...(key === 'today' ? { protectedCore: true } : {}),
    },
    props: {
      ...shape.props,
      previewMode: key === 'mindset' ? 'private' as const : 'content' as const,
    },
  }
}

function isDedicatedTodayBoardSnapshot(snapshot: unknown): boolean {
  return Object.values(snapshotStore(snapshot)).some((record) => {
    const meta = record.meta
    return record.type === 'trading-panel'
      && typeof record.props === 'object'
      && !Array.isArray(record.props)
      && (record.props as { panelKind?: unknown }).panelKind === 'today-overview'
      && typeof meta === 'object'
      && meta !== null
      && !Array.isArray(meta)
      && (meta as { templateRole?: unknown }).templateRole === 'today-core'
      && (meta as { protectedCore?: unknown }).protectedCore === true
  })
}

function appendTodayBoardReference(
  snapshot: unknown,
  reference: BoardReferenceRecord,
  title: string,
  placement: { index: string; x: number; y: number },
): unknown {
  const nextSnapshot = structuredClone(snapshot) as { store?: Record<string, unknown> }
  if (!nextSnapshot.store || typeof nextSnapshot.store !== 'object' || Array.isArray(nextSnapshot.store)) {
    nextSnapshot.store = {}
  }
  const shape = buildTemplateReferenceShape(reference, title, 'today', placement)
  nextSnapshot.store[String(shape.id)] = shape
  return nextSnapshot
}

function nextRootPlacement(snapshot: unknown): { index: string; x: number; y: number } {
  const shapes = Object.values(snapshotStore(snapshot)).filter((record) => record.typeName === 'shape')
  const lastIndex = shapes
    .map((shape) => typeof shape.index === 'string' ? shape.index : 'a0')
    .sort((left, right) => left.localeCompare(right))
    .at(-1) ?? 'a0'
  const rightEdge = shapes.reduce((maximum, shape) => {
    const x = typeof shape.x === 'number' && Number.isFinite(shape.x) ? shape.x : 0
    const props = typeof shape.props === 'object' && shape.props !== null && !Array.isArray(shape.props)
      ? shape.props as { w?: unknown }
      : {}
    const width = typeof props.w === 'number' && Number.isFinite(props.w) ? props.w : 0
    return Math.max(maximum, x + width)
  }, -40)
  return {
    index: String(getIndexAbove(lastIndex as never)),
    x: rightEdge + 40,
    y: 0,
  }
}

function logicBoardSnapshot(id: IdFactory): unknown {
  const props = tableProps(
    ['交易对象', '盘前假设', '触发条件', '证伪条件', '计划动作', '复盘结论'],
    [
      ['主线 A', '等待填写', '板块与核心同步转强', '核心跌破关键位且无修复', '观察 / 试错 / 放弃', '盘后填写'],
      ['候选股', '等待填写', '竞价与承接符合预期', '高开低走或量价背离', '按计划执行', '盘后填写'],
      ['市场环境', '等待填写', '环境许可与节点匹配', '亏钱效应扩散', '降低仓位或停止', '盘后填写'],
    ],
    id,
  )
  const shapeId = `shape:${id()}`
  return { store: { [shapeId]: shapeRecord(shapeId, 'a1', 0, 0, 'table', props) } }
}

function experienceBoardSnapshot(id: IdFactory): unknown {
  const props = tableProps(
    ['日期', '场景 / 模式', '有效信号', '失败信号', '当时动作', '可复用规则'],
    [
      ['待填写', '主线启动 / 修复 / 分歧', '哪些证据真正有效', '哪些证据具有欺骗性', '实际如何处理', '沉淀为下一次检查项'],
      ['待填写', '个股超预期 / 不及预期', '盘口、量能、板块联动', '失效位置与时间', '实际如何处理', '形成明确的 if / then'],
    ],
    id,
  )
  const shapeId = `shape:${id()}`
  return { store: { [shapeId]: shapeRecord(shapeId, 'a1', 0, 0, 'table', props) } }
}

function mindsetBoardSnapshot(id: IdFactory): unknown {
  const props = tableProps(
    ['时间', '情绪', '强度 1-5', '触发事件', '原计划', '实际动作', '校正规则'],
    [
      ['盘前', '平静 / 兴奋 / 恐惧', '1', '今天最担心什么', '计划如何处理', '盘后填写', '下次如何提前阻断'],
      ['盘中', '平静 / 兴奋 / 恐惧', '1', '哪一刻想偏离计划', '计划如何处理', '盘后填写', '建立环境或动作提醒'],
      ['盘后', '接受 / 后悔 / 侥幸', '1', '结果如何影响判断', '只评价过程', '事实记录', '保留有效习惯'],
    ],
    id,
  )
  const shapeId = `shape:${id()}`
  return { store: { [shapeId]: shapeRecord(shapeId, 'a1', 0, 0, 'table', props) } }
}

export function buildTradingWorkspaceTemplate(
  ownerOpenId: string,
  timestamp = new Date().toISOString(),
  id: IdFactory = randomUUID,
): TradingWorkspaceTemplate {
  const projectId = `project-${id()}`
  const rootBoardId = `board-${id()}`
  const project: ProjectRecord = {
    id: projectId,
    title: '短线主线交易工作台',
    rootBoardId,
    formatVersion: 1,
    ownerOpenId,
    createdAt: timestamp,
    updatedAt: timestamp,
  }

  const snapshots: Record<(typeof BOARD_DEFINITIONS)[number]['key'], unknown> = {
    today: todayBoardSnapshot(id),
    data: dataBoardSnapshot(id),
    logic: logicBoardSnapshot(id),
    experience: experienceBoardSnapshot(id),
    mindset: mindsetBoardSnapshot(id),
  }
  const childBoards = BOARD_DEFINITIONS.map((definition) => {
    const ownerOnly = definition.key === 'mindset'
    return {
      id: `board-${id()}`,
      projectId,
      title: definition.title,
      tldrawSnapshot: snapshots[definition.key],
      accessLevel: ownerOnly ? 'owner-only' as const : 'project' as const,
      ...(ownerOnly ? { ownerOpenId } : {}),
      revision: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
  }) satisfies StoredBoard[]

  const references = childBoards.map((board) => ({
    id: `reference-${id()}`,
    projectId,
    sourceBoardId: rootBoardId,
    targetBoardId: board.id,
    shapeId: `shape:${id()}`,
    kind: 'embed' as const,
    createdAt: timestamp,
    updatedAt: timestamp,
  }))
  const rootShapes = references.map((reference, index) => {
    const definition = BOARD_DEFINITIONS[index]!
    return buildTemplateReferenceShape(reference, childBoards[index]!.title, definition.key)
  })
  const rootSnapshot = { store: Object.fromEntries(rootShapes.map((shape) => [shape.id, shape])) }
  assertBoardReferenceSnapshotConsistent(rootSnapshot, references)

  const rootBoard: StoredBoard = {
    id: rootBoardId,
    projectId,
    title: '总览',
    tldrawSnapshot: rootSnapshot,
    accessLevel: 'project',
    revision: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  return { project, rootBoard, boards: [rootBoard, ...childBoards], references }
}

export class TradingWorkspaceBootstrapService {
  constructor(
    private readonly database: LocalDatabase,
    private readonly projects: ProjectRepository,
    private readonly boards: BoardRepository,
    private readonly references: BoardReferenceRepository,
    private readonly operationQueue = new BoardOperationQueue(),
    private readonly realtime?: { closeBoardWithinQueue(boardId: string): Promise<void> },
  ) {}

  async ensure(ownerOpenId: string): Promise<TradingWorkspaceBootstrapResult> {
    if (!ownerOpenId.trim()) throw new Error('TRADING_WORKSPACE_OWNER_REQUIRED')
    const normalizedOwner = ownerOpenId.trim()
    const resolved = this.database.transaction(() => this.resolveMarker(normalizedOwner))()
    if (resolved.result) return resolved.result
    return this.upgradeExisting(normalizedOwner, resolved.marker)
  }

  private resolveMarker(ownerOpenId: string): {
    marker: { projectId: string; templateVersion: number }
    result?: undefined
  } | {
    marker?: undefined
    result: TradingWorkspaceBootstrapResult
  } {
    let marker = this.readMarker(ownerOpenId)
    if (!marker) {
      const legacy = this.readMarker('__legacy_unclaimed__')
      if (legacy) {
        const legacyProject = this.projects.get(legacy.projectId)
        if (!legacyProject || !legacyProject.ownerOpenId || legacyProject.ownerOpenId === ownerOpenId) {
          this.database.prepare(`UPDATE workspace_bootstrap_markers SET owner_open_id = ?
            WHERE template_key = ? AND owner_open_id = ?`)
            .run(ownerOpenId, TRADING_WORKSPACE_TEMPLATE_KEY, '__legacy_unclaimed__')
          marker = this.readMarker(ownerOpenId)
        }
      }
    }

    if (!marker) {
      const template = buildTradingWorkspaceTemplate(ownerOpenId)
      this.projects.create(template.project)
      for (const board of template.boards) this.boards.createTemplate(board)
      for (const reference of template.references) this.references.create(reference)
      this.database.prepare(`INSERT INTO workspace_bootstrap_markers
        (template_key,owner_open_id,template_version,project_id,applied_at) VALUES (?,?,?,?,?)`)
        .run(
          TRADING_WORKSPACE_TEMPLATE_KEY,
          ownerOpenId,
          TRADING_WORKSPACE_TEMPLATE_VERSION,
          template.project.id,
          template.project.createdAt,
        )
      return { result: { status: 'created', ...template } }
    }

    let project = this.projects.get(marker.projectId)
    if (!project) return { result: { status: 'retired' } }
    if (project.ownerOpenId && project.ownerOpenId !== ownerOpenId) {
      throw new Error('TRADING_WORKSPACE_ACCESS_DENIED')
    }
    if (!project.ownerOpenId) project = this.projects.claimOwnershipIfUnowned(project.id, ownerOpenId)
    const template = this.readExistingTemplate(project.id)
    if (!template) return { result: { status: 'retired' } }
    if (marker.templateVersion >= TRADING_WORKSPACE_TEMPLATE_VERSION) {
      this.assertVersionFiveStructure(template)
      const dataBoard = this.findDataBoard(template)
      if (!dataBoard) throw new Error('TRADING_WORKSPACE_V6_MIGRATION_FAILED')
      const yishuiPanelCount = countTradingPanelKind(dataBoard.tldrawSnapshot, 'yishui-inference')
      if (yishuiPanelCount === 1) {
        this.assertVersionSixStructure(template)
        return { result: { status: 'existing', ...template } }
      }
      if (yishuiPanelCount > 1) throw new Error('TRADING_WORKSPACE_V6_MIGRATION_FAILED')
    }
    return { marker }
  }

  private readMarker(ownerOpenId: string): { projectId: string; templateVersion: number } | undefined {
    const row = this.database.prepare(`SELECT project_id, template_version
      FROM workspace_bootstrap_markers WHERE template_key = ? AND owner_open_id = ?`)
      .get(TRADING_WORKSPACE_TEMPLATE_KEY, ownerOpenId) as {
        project_id: string
        template_version: number
      } | undefined
    return row ? { projectId: row.project_id, templateVersion: row.template_version } : undefined
  }

  private readExistingTemplate(projectId: string): TradingWorkspaceTemplate | undefined {
    const project = this.projects.get(projectId)
    if (!project) return undefined
    const boards = this.boards.listByProject(project.id)
    const rootBoard = boards.find((board) => board.id === project.rootBoardId)
    if (!rootBoard) return undefined
    return {
      project,
      rootBoard,
      boards,
      references: this.references.listByProject(project.id),
    }
  }

  private async upgradeExisting(
    ownerOpenId: string,
    initialMarker: { projectId: string; templateVersion: number },
  ): Promise<TradingWorkspaceBootstrapResult> {
    const initialTemplate = this.readExistingTemplate(initialMarker.projectId)
    if (!initialTemplate) return { status: 'retired' }
    const initialMindsetBoard = this.findMindsetBoard(initialTemplate)
    if (!initialMindsetBoard) throw new Error('TRADING_WORKSPACE_PRIVACY_MIGRATION_FAILED')
    const initialDataBoard = this.findDataBoard(initialTemplate)
    if (!initialDataBoard) throw new Error('TRADING_WORKSPACE_V6_MIGRATION_FAILED')

    return this.withBoardLocks(
      [initialTemplate.rootBoard.id, initialMindsetBoard.id, initialDataBoard.id],
      async () => {
        const marker = this.readMarker(ownerOpenId)
        if (!marker) throw new Error('TRADING_WORKSPACE_PRIVACY_MIGRATION_FAILED')
        const beforeClose = this.readExistingTemplate(marker.projectId)
        if (!beforeClose) return { status: 'retired' }
        if (marker.templateVersion >= TRADING_WORKSPACE_TEMPLATE_VERSION) {
          this.assertVersionFiveStructure(beforeClose)
          const dataBoard = this.findDataBoard(beforeClose)
          if (!dataBoard) throw new Error('TRADING_WORKSPACE_V6_MIGRATION_FAILED')
          const yishuiPanelCount = countTradingPanelKind(dataBoard.tldrawSnapshot, 'yishui-inference')
          if (yishuiPanelCount === 1) {
            this.assertVersionSixStructure(beforeClose)
            return { status: 'existing', ...beforeClose }
          }
          if (yishuiPanelCount > 1) throw new Error('TRADING_WORKSPACE_V6_MIGRATION_FAILED')
        }
        const mindsetBeforeClose = this.findMindsetBoard(beforeClose)
        if (!mindsetBeforeClose) throw new Error('TRADING_WORKSPACE_PRIVACY_MIGRATION_FAILED')

        // Persist and disconnect legacy public sessions before the access policy
        // changes. Both board queues are held, so an old callback cannot race the
        // privacy migration or write a stale snapshot afterwards.
        await this.realtime?.closeBoardWithinQueue(mindsetBeforeClose.id)
        await this.realtime?.closeBoardWithinQueue(beforeClose.rootBoard.id)
        const dataBeforeClose = this.findDataBoard(beforeClose)
        if (!dataBeforeClose) throw new Error('TRADING_WORKSPACE_V6_MIGRATION_FAILED')
        await this.realtime?.closeBoardWithinQueue(dataBeforeClose.id)

        this.database.transaction(() => {
          const currentMarker = this.readMarker(ownerOpenId)
          if (!currentMarker) throw new Error('TRADING_WORKSPACE_PRIVACY_MIGRATION_FAILED')
          const current = this.readExistingTemplate(currentMarker.projectId)
          if (!current) throw new Error('TRADING_WORKSPACE_PRIVACY_MIGRATION_FAILED')
          const mindset = this.findMindsetBoard(current)
          if (!mindset) throw new Error('TRADING_WORKSPACE_PRIVACY_MIGRATION_FAILED')
          const dataBoard = this.findDataBoard(current)
          if (!dataBoard) throw new Error('TRADING_WORKSPACE_V6_MIGRATION_FAILED')
          const yishuiPanelCount = countTradingPanelKind(dataBoard.tldrawSnapshot, 'yishui-inference')
          if (currentMarker.templateVersion >= TRADING_WORKSPACE_TEMPLATE_VERSION) {
            this.assertVersionFiveStructure(current)
            if (yishuiPanelCount === 1) {
              this.assertVersionSixStructure(current)
              return
            }
            if (yishuiPanelCount > 1) throw new Error('TRADING_WORKSPACE_V6_MIGRATION_FAILED')
          }

          let nextRootSnapshot = structuredClone(current.rootBoard.tldrawSnapshot)
          if (currentMarker.templateVersion < 2) {
            const mindsetShape = listBoardReferenceShapes(nextRootSnapshot).find((shape) => {
              const meta = shape.meta as { template?: unknown }
              return meta.template === TRADING_WORKSPACE_TEMPLATE_KEY
                && shape.props.targetBoardId === mindset.id
            })
            if (!mindsetShape) throw new Error('TRADING_WORKSPACE_PRIVACY_MIGRATION_FAILED')
            if (mindsetShape.props.previewMode !== 'private') {
              mindsetShape.props.previewMode = 'private'
            }
          }
          if (currentMarker.templateVersion < 3) {
            this.boards.setAccess(mindset.id, 'owner-only', ownerOpenId)
          }
          if (currentMarker.templateVersion < 5) {
            const existingTodayEntryShapes = listBoardReferenceShapes(nextRootSnapshot).filter((shape) => {
              const meta = shape.meta as { templateRole?: unknown; protectedCore?: unknown }
              return meta.templateRole === 'today-entry' && meta.protectedCore === true
            })
            if (existingTodayEntryShapes.length > 1) {
              throw new Error('TRADING_WORKSPACE_V5_MIGRATION_FAILED')
            }

            const existingTodayBoards = current.boards.filter((board) => (
              board.id !== current.rootBoard.id && isDedicatedTodayBoardSnapshot(board.tldrawSnapshot)
            ))
            if (existingTodayBoards.length > 1) {
              throw new Error('TRADING_WORKSPACE_V5_MIGRATION_FAILED')
            }

            const existingEntryShape = existingTodayEntryShapes[0]
            const existingReference = existingEntryShape
              ? current.references.find((reference) => (
                  reference.id === existingEntryShape.props.referenceId
                  && reference.shapeId === existingEntryShape.id
                  && reference.sourceBoardId === current.rootBoard.id
                  && reference.targetBoardId === existingEntryShape.props.targetBoardId
                ))
              : undefined
            if (existingEntryShape && !existingReference) {
              throw new Error('TRADING_WORKSPACE_V5_MIGRATION_FAILED')
            }

            let todayBoard = existingReference
              ? current.boards.find((board) => board.id === existingReference.targetBoardId)
              : existingTodayBoards[0]
            if (todayBoard && !isDedicatedTodayBoardSnapshot(todayBoard.tldrawSnapshot)) {
              throw new Error('TRADING_WORKSPACE_V5_MIGRATION_FAILED')
            }
            if (!todayBoard) {
              const timestamp = new Date().toISOString()
              todayBoard = this.boards.createTemplate({
                id: `board-${randomUUID()}`,
                projectId: current.project.id,
                title: '今天怎么看',
                tldrawSnapshot: todayBoardSnapshot(randomUUID),
                accessLevel: 'project',
                revision: 0,
                createdAt: timestamp,
                updatedAt: timestamp,
              })
            }

            let todayReference = existingReference
            if (!todayReference) {
              const timestamp = new Date().toISOString()
              todayReference = {
                id: `reference-${randomUUID()}`,
                projectId: current.project.id,
                sourceBoardId: current.rootBoard.id,
                targetBoardId: todayBoard.id,
                shapeId: `shape:${randomUUID()}`,
                kind: 'embed',
                createdAt: timestamp,
                updatedAt: timestamp,
              }
              nextRootSnapshot = appendTodayBoardReference(
                nextRootSnapshot,
                todayReference,
                todayBoard.title,
                nextRootPlacement(nextRootSnapshot),
              )
              this.references.create(todayReference)
            }
          }
          if (currentMarker.templateVersion < 6 || yishuiPanelCount === 0) {
            const nextDataSnapshot = appendYishuiInferencePanel(dataBoard.tldrawSnapshot)
            if (JSON.stringify(nextDataSnapshot) !== JSON.stringify(dataBoard.tldrawSnapshot)) {
              this.boards.saveTemplateSnapshot(dataBoard.id, dataBoard.revision, nextDataSnapshot)
            }
          }

          const nextReferences = this.references.listByProject(current.project.id)
          assertBoardReferenceSnapshotConsistent(nextRootSnapshot, nextReferences.filter((reference) => (
            reference.sourceBoardId === current.rootBoard.id
          )))
          if (JSON.stringify(nextRootSnapshot) !== JSON.stringify(current.rootBoard.tldrawSnapshot)) {
            this.boards.saveTemplateSnapshot(current.rootBoard.id, current.rootBoard.revision, nextRootSnapshot)
          }

          const upgraded = this.readExistingTemplate(current.project.id)
          if (!upgraded) throw new Error('TRADING_WORKSPACE_V5_MIGRATION_FAILED')
          this.assertVersionSixStructure(upgraded)
          this.database.prepare(`UPDATE workspace_bootstrap_markers
            SET template_version = ?, applied_at = ?
            WHERE template_key = ? AND owner_open_id = ?`)
            .run(
              TRADING_WORKSPACE_TEMPLATE_VERSION,
              new Date().toISOString(),
              TRADING_WORKSPACE_TEMPLATE_KEY,
              ownerOpenId,
            )
        })()

        const upgraded = this.readExistingTemplate(marker.projectId)
        if (!upgraded) return { status: 'retired' }
        return { status: 'existing', ...upgraded }
      },
    )
  }

  private findMindsetBoard(template: TradingWorkspaceTemplate): StoredBoard | undefined {
    const byTitle = template.boards.find((board) => board.title === '心态')
    const shape = listBoardReferenceShapes(template.rootBoard.tldrawSnapshot).find((candidate) => {
      const meta = candidate.meta as { template?: unknown }
      return meta.template === TRADING_WORKSPACE_TEMPLATE_KEY && (
        candidate.props.titleFallback === '心态'
        || candidate.props.previewMode === 'private'
        || candidate.props.targetBoardId === byTitle?.id
      )
    })
    return shape
      ? template.boards.find((board) => board.id === shape.props.targetBoardId)
      : byTitle
  }

  private findDataBoard(template: TradingWorkspaceTemplate): StoredBoard | undefined {
    const dataEntry = listBoardReferenceShapes(template.rootBoard.tldrawSnapshot).find((shape) => {
      const meta = shape.meta as { templateRole?: unknown }
      return meta.templateRole === 'data-entry'
    })
    return template.boards.find((board) => board.id === dataEntry?.props.targetBoardId)
      ?? template.boards.find((board) => board.title === '数据')
      ?? template.boards.find((board) => (
        hasTradingPanelKind(board.tldrawSnapshot, 'market-overview')
        && hasTradingPanelKind(board.tldrawSnapshot, 'stock-pool')
        && hasTradingPanelKind(board.tldrawSnapshot, 'announcements')
        && hasTradingPanelKind(board.tldrawSnapshot, 'system-status')
      ))
  }

  private assertVersionFiveStructure(template: TradingWorkspaceTemplate): void {
    const entryShapes = listBoardReferenceShapes(template.rootBoard.tldrawSnapshot).filter((shape) => {
      const meta = shape.meta as { templateRole?: unknown; protectedCore?: unknown }
      return meta.templateRole === 'today-entry' && meta.protectedCore === true
    })
    if (entryShapes.length !== 1) throw new Error('TRADING_WORKSPACE_V5_MIGRATION_FAILED')

    const entry = entryShapes[0]!
    const matchingReferences = template.references.filter((reference) => (
      reference.id === entry.props.referenceId
      && reference.shapeId === entry.id
      && reference.sourceBoardId === template.rootBoard.id
      && reference.targetBoardId === entry.props.targetBoardId
      && reference.kind === 'embed'
    ))
    if (matchingReferences.length !== 1) throw new Error('TRADING_WORKSPACE_V5_MIGRATION_FAILED')

    const todayBoard = template.boards.find((board) => board.id === matchingReferences[0]!.targetBoardId)
    if (!todayBoard || !isDedicatedTodayBoardSnapshot(todayBoard.tldrawSnapshot)) {
      throw new Error('TRADING_WORKSPACE_V5_MIGRATION_FAILED')
    }
    const coreCount = template.boards.reduce((count, board) => (
      count + Object.values(snapshotStore(board.tldrawSnapshot)).filter((record) => {
        const meta = record.meta as { templateRole?: unknown; protectedCore?: unknown } | undefined
        return meta?.templateRole === 'today-core' && meta.protectedCore === true
      }).length
    ), 0)
    if (coreCount !== 1) throw new Error('TRADING_WORKSPACE_V5_MIGRATION_FAILED')
  }

  private assertVersionSixStructure(template: TradingWorkspaceTemplate): void {
    this.assertVersionFiveStructure(template)
    const dataBoard = this.findDataBoard(template)
    if (!dataBoard || countTradingPanelKind(dataBoard.tldrawSnapshot, 'yishui-inference') !== 1) {
      throw new Error('TRADING_WORKSPACE_V6_MIGRATION_FAILED')
    }
  }

  private withBoardLocks<T>(boardIds: readonly string[], operation: () => Promise<T> | T): Promise<T> {
    const orderedIds = [...new Set(boardIds.map((boardId) => boardId.trim()).filter(Boolean))].sort()
    const acquire = (index: number): Promise<T> => {
      const boardId = orderedIds[index]
      if (!boardId) return Promise.resolve().then(operation)
      return this.operationQueue.run(boardId, () => acquire(index + 1))
    }
    return acquire(0)
  }
}
