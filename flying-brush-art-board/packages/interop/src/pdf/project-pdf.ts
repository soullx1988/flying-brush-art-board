import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'

import {
  stableTopologicalBoardOrder,
  type BoardReferenceRecord,
  type ProjectRecord,
  type StoredBoard,
} from '@infinite-board/board-core'

export const MAX_PROJECT_PDF_BOARDS = 200
export const MAX_PROJECT_PDF_SHAPES = 20_000

const PAGE_WIDTH = 792
const PAGE_HEIGHT = 612
const PAGE_MARGIN = 36
const TITLE_HEIGHT = 34
const SNAPSHOT_PADDING = 24

export interface ProjectPdfInput {
  project: ProjectRecord
  boards: readonly StoredBoard[]
  references: readonly BoardReferenceRecord[]
  assets?: ReadonlyMap<string, string> | Readonly<Record<string, string>>
  /** A single point-in-time snapshot shared by every trading panel in this export. */
  tradingSnapshot?: ProjectPdfTradingSnapshot
}

export interface ProjectPdfTradingSnapshot {
  status: 'ready' | 'stale' | 'degraded' | 'unavailable'
  updatedAt: string
  tradeDate?: string
  sourceLabel: string
  message?: string
  revision?: string
  streamId?: string
  sequence?: number
  sourceGeneratedAt?: string | null
  availableAt?: string | null
  lastSuccessAt?: string | null
  lastErrorAt?: string | null
  freshness?: 'CURRENT' | 'STALE' | 'UNKNOWN'
  sourceHealth?: 'CURRENT' | 'STALE' | 'DEGRADED' | 'UNAVAILABLE'
  freshUntil?: string | null
  todayOverview?: {
    reportGeneratedAt?: string | null
    phaseGeneratedAt?: string | null
    currentPhase?: string
    currentPhaseLabel?: string
    overallState?: string
    sourceTradeDate?: string
    decisionTradeDate?: string
    planTradeDate?: string
    dataAsOf?: string | null
    validUntil?: string | null
    nextKeyTime?: string | null
    canParticipate?: boolean
    participationStatus?: string
    participationSummary?: string
    sourceExecutionAuthority?: string
    effectiveExecutionAuthority?: string
    unattendedAction?: string
    focusFamily?: string
    focusSummary?: string
    primaryTheme?: string
    parallelThemes?: string[]
    phase?: string
    phaseStatus?: string
    pipelineHealth?: string
    planAvailability?: string
    marketDecision?: string
    executionAuthority?: string
    reasonCodes?: string[]
    summaryLines?: string[]
    decisionChain?: Array<{
      id: string
      label: string
      status: string
      summary: string
      occurredAt?: string | null
      validUntil?: string | null
      evidenceIds?: string[]
    }>
    changes?: Array<{ id: string; label: string; summary: string }>
    evidenceRefs?: Array<{
      id: string
      label: string
      kind: string
      sha256?: string
      occurredAt?: string | null
      informationNature?: string
    }>
    auction?: {
      status?: string
      snapshotAt?: string | null
      population?: number
      mainBoardPopulation?: number
      executionAuthority?: string
      leader?: {
        code: string
        name: string
        marketSegment?: string
        auctionChangePct?: number
        sealAmountCny?: number
        sealToTurnoverRatio?: number
        executionAuthority?: string
      }
    }
  }
  market?: {
    environmentVerdict?: string
    nodeVerdict?: string
    limitUpTotal?: number
    limitDownTotal?: number
    highestBoardLevel?: number
    summaryLines?: string[]
  }
  themes: Array<{ name: string; heat?: number; structure?: string }>
  stocks: Array<{ code: string; name: string; score?: number; action?: string; reason?: string }>
  announcements: Array<{
    id: string
    title: string
    verificationStatus?: 'VERIFIED' | 'UNVERIFIED'
    summary?: string
    publishedAt?: string
    names?: string[]
    codes?: string[]
  }>
  readiness?: {
    state?: string
    executionEligible?: boolean
    observationEligible?: boolean
    reasonCount?: number
  }
  services: Array<{ name: string; status: string; detail?: string }>
}

export interface PdfShapeBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface ProjectPdfLink {
  referenceId: string
  shapeId: string
  kind: 'embed' | 'link'
  targetBoardId: string
  targetPageNo: number
}

export interface ProjectPdfPage {
  board: StoredBoard
  pageNo: number
  destination: string
  links: ProjectPdfLink[]
}

export interface ProjectPdfOutlineItem {
  boardId: string
  title: string
  pageNo: number
  children: ProjectPdfOutlineItem[]
}

export interface ProjectPdfPlan {
  pages: ProjectPdfPage[]
  pageByBoardId: Map<string, number>
  outline: ProjectPdfOutlineItem[]
}

export class ProjectPdfError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'ProjectPdfError'
  }
}

interface PdfOutline {
  addItem(title: string, options?: { pageNumber?: number; expanded?: boolean }): PdfOutline
}

interface PdfDocumentLike extends NodeJS.ReadableStream {
  outline: PdfOutline
  addPage(options?: { size?: [number, number]; margin?: number }): PdfDocumentLike
  addNamedDestination(name: string, ...args: unknown[]): PdfDocumentLike
  registerFont(name: string, source: string): PdfDocumentLike
  font(name: string): PdfDocumentLike
  fontSize(size: number): PdfDocumentLike
  fillColor(color: string): PdfDocumentLike
  text(text: string, x: number, y: number, options?: Record<string, unknown>): PdfDocumentLike
  rect(x: number, y: number, width: number, height: number): PdfDocumentLike
  fill(color?: string): PdfDocumentLike
  goTo(x: number, y: number, width: number, height: number, destination: string): PdfDocumentLike
  end(): void
}

type PdfDocumentConstructor = new (options?: Record<string, unknown>) => PdfDocumentLike
type SvgToPdf = (
  document: PdfDocumentLike,
  svg: string,
  x: number,
  y: number,
  options?: Record<string, unknown>,
) => void

const require = createRequire(import.meta.url)
const PDF_FONT_FAMILY = 'InfiniteBoardSans'
const PDF_FONT_BOLD = `${PDF_FONT_FAMILY}-Bold`

function pdfFontPath(fileName: 'NotoSansHans-Regular.otf' | 'NotoSansHans-Bold.otf'): string {
  const packageEntry = require.resolve('@embedpdf/fonts-sc')
  return resolve(dirname(packageEntry), '..', 'fonts', fileName)
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function snapshotStore(snapshot: unknown): Record<string, unknown> {
  const value = objectValue(snapshot)
  const document = objectValue(value.document)
  return objectValue(document.store ?? value.store)
}

function snapshotShapeCount(snapshot: unknown): number {
  let count = 0
  for (const record of Object.values(snapshotStore(snapshot))) {
    if (objectValue(record).typeName === 'shape') count += 1
  }
  return count
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

const MIND_MAP_PALETTE: Record<string, string> = {
  black: '#1f2329', gray: '#8f959e', purple: '#d46bfa', violet: '#9333ea',
  indigo: '#4e6ef2', blue: '#3b82f6', amber: '#f3a83b', orange: '#e76a24',
  teal: '#0f9f75', green: '#42b55d', coral: '#f87171', red: '#e53935',
}

function mindMapPaletteColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && MIND_MAP_PALETTE[value] ? MIND_MAP_PALETTE[value]! : fallback
}

function mindMapOpacity(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1
}

interface PointLike { x: number; y: number }

function manualArrowPoints(record: Record<string, unknown>): PointLike[] | undefined {
  if (record.type !== 'arrow') return undefined
  const props = objectValue(record.props)
  if (props.kind !== 'elbow') return undefined
  const manualRoute = objectValue(objectValue(record.meta).manualElbowRoute)
  if (manualRoute.version !== 1 || !Array.isArray(manualRoute.segments) || manualRoute.segments.length === 0) return undefined
  const segments = manualRoute.segments.map(objectValue)
  if (segments.some((segment, index) => (
    (segment.orientation !== 'horizontal' && segment.orientation !== 'vertical')
    || typeof segment.position !== 'number'
    || !Number.isFinite(segment.position)
    || (index > 0 && segments[index - 1]?.orientation === segment.orientation)
  ))) return undefined
  const start = objectValue(props.start)
  const end = objectValue(props.end)
  const startPoint = { x: finiteNumber(start.x, 0), y: finiteNumber(start.y, 0) }
  const endPoint = { x: finiteNumber(end.x, 200), y: finiteNumber(end.y, 120) }
  const resolved = segments.map((segment) => ({
    orientation: segment.orientation as 'horizontal' | 'vertical',
    position: segment.position as number,
  }))
  const first = resolved[0]!
  const last = resolved[resolved.length - 1]!
  first.position = first.orientation === 'horizontal' ? startPoint.y : startPoint.x
  last.position = last.orientation === 'horizontal' ? endPoint.y : endPoint.x
  const points: PointLike[] = [startPoint]
  for (let index = 0; index < resolved.length - 1; index += 1) {
    const left = resolved[index]!
    const right = resolved[index + 1]!
    const horizontal = left.orientation === 'horizontal' ? left : right
    const vertical = left.orientation === 'vertical' ? left : right
    points.push({ x: vertical.position, y: horizontal.position })
  }
  points.push(endPoint)
  return points
}

function shapeBounds(record: Record<string, unknown>): PdfShapeBounds {
  const props = objectValue(record.props)
  const baseX = finiteNumber(record.x, 0)
  const baseY = finiteNumber(record.y, 0)
  if (record.type === 'arrow' || record.type === 'line') {
    const start = objectValue(props.start)
    const end = objectValue(props.end)
    const points = manualArrowPoints(record) ?? [
      { x: finiteNumber(start.x, 0), y: finiteNumber(start.y, 0) },
      { x: finiteNumber(end.x, 200), y: finiteNumber(end.y, 120) },
    ]
    const minX = Math.min(...points.map((point) => point.x))
    const minY = Math.min(...points.map((point) => point.y))
    const maxX = Math.max(...points.map((point) => point.x))
    const maxY = Math.max(...points.map((point) => point.y))
    return { x: baseX + minX, y: baseY + minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) }
  }
  return {
    x: baseX,
    y: baseY,
    width: Math.max(1, finiteNumber(props.w, 200)),
    height: Math.max(1, finiteNumber(props.h, 120)),
  }
}

function escapeXml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function richText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(richText).join('')
  const record = objectValue(value)
  if (typeof record.text === 'string') return record.text
  return record.content === undefined ? '' : richText(record.content)
}

function normalizedColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  if (/^#[0-9a-f]{3,8}$/i.test(value)) return value
  const colors: Record<string, string> = {
    black: '#1f2937',
    grey: '#64748b',
    gray: '#64748b',
    red: '#dc2626',
    orange: '#ea580c',
    yellow: '#ca8a04',
    green: '#16a34a',
    blue: '#2563eb',
    violet: '#7c3aed',
    purple: '#7c3aed',
  }
  return colors[value.toLowerCase()] ?? fallback
}

function assetLookup(
  assets: ProjectPdfInput['assets'],
  key: string,
): string | undefined {
  if (!assets) return undefined
  return typeof (assets as { get?: unknown }).get === 'function'
    ? (assets as ReadonlyMap<string, string>).get(key)
    : (assets as Readonly<Record<string, string>>)[key]
}

function safeImageSource(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  return /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/]+=*$/i.test(value.trim())
    ? value.trim()
    : undefined
}

type PdfTradingFactState = 'CURRENT' | 'STALE' | 'DEGRADED' | 'UNAVAILABLE'

const PDF_TRADING_STATE: Record<PdfTradingFactState, { label: string; color: string; background: string }> = {
  CURRENT: { label: '当前快照', color: '#166534', background: '#dcfce7' },
  STALE: { label: '数据过期', color: '#9a3412', background: '#ffedd5' },
  DEGRADED: { label: '数据降级', color: '#92400e', background: '#fef3c7' },
  UNAVAILABLE: { label: '数据不可用', color: '#991b1b', background: '#fee2e2' },
}

function compactText(value: unknown, maxLength: number): string {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim()
  const characters = [...normalized]
  return characters.length > maxLength
    ? `${characters.slice(0, Math.max(1, maxLength - 1)).join('')}…`
    : normalized
}

function formatPdfTime(value: string | null | undefined): string {
  if (!value || !Number.isFinite(Date.parse(value))) return '未提供'
  return new Date(value).toLocaleString('zh-CN', {
    hour12: false,
    timeZone: 'Asia/Shanghai',
  })
}

function pdfTradingFactState(snapshot: ProjectPdfTradingSnapshot | undefined): PdfTradingFactState {
  if (!snapshot || snapshot.status === 'unavailable' || snapshot.sourceHealth === 'UNAVAILABLE') return 'UNAVAILABLE'
  if (snapshot.status === 'degraded' || snapshot.sourceHealth === 'DEGRADED') return 'DEGRADED'
  if (snapshot.status === 'stale' || snapshot.freshness === 'STALE' || snapshot.sourceHealth === 'STALE') return 'STALE'
  return snapshot.status === 'ready'
    && snapshot.sourceHealth === 'CURRENT'
    && snapshot.freshness === 'CURRENT'
    ? 'CURRENT'
    : 'DEGRADED'
}

function svgTextLine(
  value: unknown,
  x: number,
  y: number,
  options: {
    size?: number
    color?: string
    weight?: 'normal' | 'bold'
    anchor?: 'start' | 'middle' | 'end'
    maxLength?: number
  } = {},
): string {
  const text = compactText(value, options.maxLength ?? 80)
  if (!text) return ''
  return `<text x="${x}" y="${y}" fill="${options.color ?? '#172033'}" font-family="${PDF_FONT_FAMILY}" font-size="${options.size ?? 16}" font-weight="${options.weight ?? 'normal'}" text-anchor="${options.anchor ?? 'start'}">${escapeXml(text)}</text>`
}

function renderTradingPanelUnavailable(
  geometry: PdfShapeBounds,
  snapshot: ProjectPdfTradingSnapshot | undefined,
  bodyTop: number,
  bodyBottom: number,
): string {
  const x = geometry.x + 24
  const y = bodyTop + Math.max(52, (bodyBottom - bodyTop) * 0.34)
  return [
    `<rect x="${x}" y="${bodyTop + 20}" width="${geometry.width - 48}" height="${Math.max(96, bodyBottom - bodyTop - 40)}" rx="14" fill="#fff7f7" stroke="#fecaca"/>`,
    svgTextLine('数据源暂不可用', x + 22, y, { size: 24, weight: 'bold', color: '#991b1b' }),
    svgTextLine(snapshot?.message ?? '选股后台未启用或尚无可核验快照。', x + 22, y + 34, { size: 16, color: '#7f1d1d', maxLength: 70 }),
  ].join('')
}

function renderTradingMarketPanel(
  geometry: PdfShapeBounds,
  snapshot: ProjectPdfTradingSnapshot,
  bodyTop: number,
): string {
  const market = snapshot.market ?? {}
  const metrics = [
    ['环境许可', market.environmentVerdict ?? '—'],
    ['市场节点', market.nodeVerdict ?? '—'],
    ['涨停 / 跌停', `${market.limitUpTotal ?? '—'} / ${market.limitDownTotal ?? '—'}`],
    ['最高连板', market.highestBoardLevel ? `${market.highestBoardLevel} 板` : '—'],
  ]
  const gap = 12
  const left = geometry.x + 24
  const cardWidth = (geometry.width - 48 - gap * 3) / 4
  const cards = metrics.map(([label, value], index) => {
    const x = left + index * (cardWidth + gap)
    return `<g><rect x="${x}" y="${bodyTop + 18}" width="${cardWidth}" height="72" rx="10" fill="#f8fafc" stroke="#dbe4ee"/>${svgTextLine(label, x + 12, bodyTop + 43, { size: 14, color: '#64748b', maxLength: 16 })}${svgTextLine(value, x + 12, bodyTop + 73, { size: 21, weight: 'bold', maxLength: 18 })}</g>`
  }).join('')
  const themes = snapshot.themes.slice(0, 5).map((theme) => theme.heat === undefined
    ? theme.name
    : `${theme.name} ${theme.heat.toFixed(1)}`)
  return [
    cards,
    svgTextLine(`主线：${themes.join(' · ') || '尚无可核验主线'}`, left, bodyTop + 124, { size: 18, weight: 'bold', maxLength: 70 }),
    svgTextLine(market.summaryLines?.[0] ?? '当前快照未提供市场摘要。', left, bodyTop + 158, { size: 16, color: '#475569', maxLength: 82 }),
  ].join('')
}

function renderTradingTodayOverviewPanel(
  geometry: PdfShapeBounds,
  snapshot: ProjectPdfTradingSnapshot,
  bodyTop: number,
  bodyBottom: number,
): string {
  const overview = snapshot.todayOverview
  const left = geometry.x + 24
  const width = geometry.width - 48
  const gap = 12
  const cardWidth = (width - gap * 3) / 4
  const cards = [
    ['今天主要看', overview?.focusFamily ?? overview?.primaryTheme ?? '—'],
    ['现在处于', overview?.currentPhaseLabel ?? overview?.phaseStatus ?? overview?.phase ?? '—'],
    ['系统怎么看', overview?.overallState ?? overview?.marketDecision ?? '—'],
    ['现在能不能参与', overview?.canParticipate ? '可以参与' : '不能参与'],
  ].map(([label, value], index) => {
    const x = left + index * (cardWidth + gap)
    return `<g><rect x="${x}" y="${bodyTop + 18}" width="${cardWidth}" height="72" rx="10" fill="#f8fafc" stroke="#dbe4ee"/>${svgTextLine(label, x + 12, bodyTop + 43, { size: 14, color: '#64748b', maxLength: 16 })}${svgTextLine(value, x + 12, bodyTop + 73, { size: 20, weight: 'bold', maxLength: 18 })}</g>`
  }).join('')
  const lines = overview?.summaryLines?.filter(Boolean) ?? []
  const chain = overview?.decisionChain?.slice(0, 4).map((step) => `${step.label}：${step.status}，${step.summary}`).join('；')
  const changes = overview?.changes?.slice(0, 3).map((item) => `${item.label}：${item.summary}`).join('；')
  const serviceTop = bodyTop + 108
  const serviceHeight = Math.max(46, Math.floor((bodyBottom - serviceTop - 16) / 4))
  const serviceWidth = width
  const services = [
    ['现在怎么看', overview?.participationSummary ?? overview?.focusSummary ?? '当前快照未提供明确结论。'],
    ['判断怎么来的', chain || lines[0] || '当前快照未提供完整判断过程。'],
    ['从上一步到现在', changes || overview?.unattendedAction || overview?.reasonCodes?.[0] || '当前没有需要单独提醒的重要变化。'],
    ['如果我没空', overview?.unattendedAction || '保持观察，不产生新的交易动作。'],
  ].map(([label, value], index) => {
    const y = serviceTop + index * serviceHeight
    return `<g><rect x="${left}" y="${y}" width="${serviceWidth}" height="${serviceHeight - 8}" rx="10" fill="#ffffff" stroke="#e2e8f0"/>${svgTextLine(label, left + 12, y + 23, { size: 14, weight: 'bold', color: '#475569', maxLength: 12 })}${svgTextLine(value, left + 12, y + 46, { size: 15, color: '#172033', maxLength: 88 })}</g>`
  }).join('')
  return `${cards}${services}`
}

function renderTradingStockPanel(
  geometry: PdfShapeBounds,
  snapshot: ProjectPdfTradingSnapshot,
  bodyTop: number,
  bodyBottom: number,
): string {
  const left = geometry.x + 24
  const width = geometry.width - 48
  const rowHeight = 40
  const availableRows = Math.max(1, Math.floor((bodyBottom - bodyTop - 48) / rowHeight))
  const columns = [left, left + width * 0.38, left + width * 0.51, left + width * 0.68]
  const header = `<rect x="${left}" y="${bodyTop + 14}" width="${width}" height="34" rx="8" fill="#eaf2ff"/>${svgTextLine('股票', columns[0]! + 10, bodyTop + 37, { size: 14, weight: 'bold' })}${svgTextLine('分数', columns[1]!, bodyTop + 37, { size: 14, weight: 'bold' })}${svgTextLine('动作', columns[2]!, bodyTop + 37, { size: 14, weight: 'bold' })}${svgTextLine('依据', columns[3]!, bodyTop + 37, { size: 14, weight: 'bold' })}`
  if (snapshot.stocks.length === 0) {
    return `${header}${svgTextLine('当前快照暂无候选股票。', left + 10, bodyTop + 86, { size: 17, color: '#64748b' })}`
  }
  const rows = snapshot.stocks.slice(0, availableRows).map((stock, index) => {
    const y = bodyTop + 48 + index * rowHeight
    const background = index % 2 === 0 ? '#ffffff' : '#f8fafc'
    return `<g><rect x="${left}" y="${y}" width="${width}" height="${rowHeight}" fill="${background}" stroke="#e5eaf0"/>${svgTextLine(`${stock.name} ${stock.code}`, columns[0]! + 10, y + 26, { size: 15, weight: 'bold', maxLength: 22 })}${svgTextLine(stock.score?.toFixed(1) ?? '—', columns[1]!, y + 26, { size: 15 })}${svgTextLine(stock.action ?? '观察', columns[2]!, y + 26, { size: 15, color: '#1d4ed8', maxLength: 10 })}${svgTextLine(stock.reason ?? '—', columns[3]!, y + 26, { size: 14, color: '#475569', maxLength: 34 })}</g>`
  }).join('')
  return `${header}${rows}`
}

function renderTradingAnnouncementsPanel(
  geometry: PdfShapeBounds,
  snapshot: ProjectPdfTradingSnapshot,
  bodyTop: number,
  bodyBottom: number,
): string {
  const left = geometry.x + 24
  const width = geometry.width - 48
  if (snapshot.announcements.length === 0) {
    return `${svgTextLine('暂无启用观察条目', left, bodyTop + 58, { size: 21, weight: 'bold' })}${svgTextLine('后台公告观察源有新内容后，下一次导出会写入冻结快照。', left, bodyTop + 92, { size: 16, color: '#64748b' })}`
  }
  const rowHeight = 78
  const availableRows = Math.max(1, Math.floor((bodyBottom - bodyTop - 12) / rowHeight))
  return snapshot.announcements.slice(0, availableRows).map((item, index) => {
    const y = bodyTop + 12 + index * rowHeight
    const verification = item.verificationStatus === 'VERIFIED' ? '官方原文证据已核验' : '待核验'
    const targets = [...(item.names ?? []), ...(item.codes ?? [])].join(' · ')
    return `<g><rect x="${left}" y="${y}" width="${width}" height="${rowHeight - 8}" rx="10" fill="#ffffff" stroke="#e2e8f0"/>${svgTextLine(item.title, left + 12, y + 25, { size: 16, weight: 'bold', maxLength: 48 })}${svgTextLine(`${verification} · ${item.publishedAt ?? '时间未标注'}`, left + width - 12, y + 25, { size: 13, color: item.verificationStatus === 'VERIFIED' ? '#166534' : '#92400e', anchor: 'end', maxLength: 40 })}${svgTextLine(`观察摘要 / 人工解读：${item.summary ?? '暂无摘要'}`, left + 12, y + 49, { size: 14, color: '#475569', maxLength: 76 })}${svgTextLine(targets || '题材级公告', left + 12, y + 66, { size: 11, color: '#64748b', maxLength: 42 })}</g>`
  }).join('')
}

function renderTradingSystemPanel(
  geometry: PdfShapeBounds,
  snapshot: ProjectPdfTradingSnapshot,
  bodyTop: number,
  bodyBottom: number,
): string {
  const left = geometry.x + 24
  const width = geometry.width - 48
  const readiness = snapshot.readiness
  const header = `<rect x="${left}" y="${bodyTop + 16}" width="${width}" height="58" rx="10" fill="#eef6ff" stroke="#bfdbfe"/>${svgTextLine('协作快照状态', left + 14, bodyTop + 40, { size: 15, color: '#475569' })}${svgTextLine(readiness?.state ?? 'UNKNOWN', left + 164, bodyTop + 40, { size: 18, weight: 'bold', color: '#1d4ed8', maxLength: 18 })}${svgTextLine(`现在可参与：${snapshot.todayOverview?.canParticipate ? '是' : '否'} · 可供研究复核：${readiness?.observationEligible ? '是' : '否'} · 原因数：${readiness?.reasonCount ?? 0}`, left + 14, bodyTop + 63, { size: 13, color: '#475569', maxLength: 58 })}`
  const rowHeight = 42
  const availableRows = Math.max(1, Math.floor((bodyBottom - bodyTop - 88) / rowHeight))
  const rows = snapshot.services.slice(0, availableRows).map((service, index) => {
    const y = bodyTop + 84 + index * rowHeight
    return `<g><rect x="${left}" y="${y}" width="${width}" height="${rowHeight - 4}" fill="${index % 2 === 0 ? '#ffffff' : '#f8fafc'}" stroke="#e5eaf0"/>${svgTextLine(service.name, left + 12, y + 25, { size: 15, weight: 'bold', maxLength: 24 })}${svgTextLine(service.status, left + width * 0.42, y + 25, { size: 14, color: '#1d4ed8', maxLength: 16 })}${svgTextLine(service.detail ?? '', left + width * 0.58, y + 25, { size: 13, color: '#64748b', maxLength: 42 })}</g>`
  }).join('')
  return `${header}${rows}`
}

function renderTradingPanel(
  shapeId: string,
  props: Record<string, unknown>,
  geometry: PdfShapeBounds,
  snapshot: ProjectPdfTradingSnapshot | undefined,
): string {
  const state = pdfTradingFactState(snapshot)
  const stateStyle = PDF_TRADING_STATE[state]
  const panelKind = String(props.panelKind ?? '')
  const title = panelKind === 'announcements'
    ? '公告观察源'
    : compactText(props.title || '交易数据', 40)
  const headerBottom = geometry.y + 112
  const footerTop = geometry.y + geometry.height - 34
  const bodyTop = headerBottom
  const bodyBottom = Math.max(bodyTop + 64, footerTop)
  const clipId = `trading-panel-${shapeId.replace(/[^a-z0-9_-]/gi, '-')}`
  const metaWidth = (geometry.width - 48) / 3
  const sourceLabel = snapshot?.sourceLabel ?? '选股后台（未连接）'
  const revision = snapshot?.revision?.slice(0, 12) ?? '—'
  const body = state === 'UNAVAILABLE'
    ? renderTradingPanelUnavailable(geometry, snapshot, bodyTop, bodyBottom)
    : panelKind === 'today-overview'
      ? renderTradingTodayOverviewPanel(geometry, snapshot!, bodyTop, bodyBottom)
      : panelKind === 'market-overview'
      ? renderTradingMarketPanel(geometry, snapshot!, bodyTop)
      : panelKind === 'stock-pool'
        ? renderTradingStockPanel(geometry, snapshot!, bodyTop, bodyBottom)
        : panelKind === 'announcements'
          ? renderTradingAnnouncementsPanel(geometry, snapshot!, bodyTop, bodyBottom)
          : renderTradingSystemPanel(geometry, snapshot!, bodyTop, bodyBottom)

  return `<g data-shape-id="${escapeXml(shapeId)}" data-panel-kind="${escapeXml(panelKind)}" data-fact-state="${state}"><defs><clipPath id="${clipId}"><rect x="${geometry.x}" y="${geometry.y}" width="${geometry.width}" height="${geometry.height}" rx="12"/></clipPath></defs><g clip-path="url(#${clipId})"><rect x="${geometry.x}" y="${geometry.y}" width="${geometry.width}" height="${geometry.height}" rx="12" fill="#ffffff" stroke="#9aa8bb" stroke-width="2"/><rect x="${geometry.x}" y="${geometry.y}" width="${geometry.width}" height="${headerBottom - geometry.y}" fill="#f8fafc"/><rect x="${geometry.x + geometry.width - 166}" y="${geometry.y + 16}" width="142" height="30" rx="15" fill="${stateStyle.background}"/>${svgTextLine(stateStyle.label, geometry.x + geometry.width - 95, geometry.y + 37, { size: 14, weight: 'bold', color: stateStyle.color, anchor: 'middle', maxLength: 12 })}${svgTextLine(title, geometry.x + 24, geometry.y + 39, { size: 27, weight: 'bold', maxLength: 34 })}${svgTextLine(`来源：${sourceLabel}`, geometry.x + 24, geometry.y + 70, { size: 14, color: '#475569', maxLength: 32 })}${svgTextLine(`交易日：${snapshot?.tradeDate ?? '未提供'}`, geometry.x + 24 + metaWidth, geometry.y + 70, { size: 14, color: '#475569', maxLength: 24 })}${svgTextLine(`新鲜度：${snapshot?.freshness ?? 'UNKNOWN'}`, geometry.x + 24 + metaWidth * 2, geometry.y + 70, { size: 14, color: '#475569', maxLength: 24 })}${svgTextLine(`源时点：${formatPdfTime(snapshot?.sourceGeneratedAt)}`, geometry.x + 24, geometry.y + 96, { size: 13, color: '#64748b', maxLength: 32 })}${svgTextLine(`有效截止：${formatPdfTime(snapshot?.freshUntil)}`, geometry.x + 24 + metaWidth, geometry.y + 96, { size: 13, color: '#64748b', maxLength: 32 })}${svgTextLine(`版本：${revision}`, geometry.x + 24 + metaWidth * 2, geometry.y + 96, { size: 13, color: '#64748b', maxLength: 24 })}<line x1="${geometry.x}" y1="${headerBottom}" x2="${geometry.x + geometry.width}" y2="${headerBottom}" stroke="#dbe3ed"/>${body}<line x1="${geometry.x}" y1="${footerTop}" x2="${geometry.x + geometry.width}" y2="${footerTop}" stroke="#dbe3ed"/>${svgTextLine(`可用时点：${formatPdfTime(snapshot?.availableAt)} · 导出快照：${revision}`, geometry.x + 24, geometry.y + geometry.height - 11, { size: 12, color: '#64748b', maxLength: 72 })}</g></g>`
}

interface SnapshotRender {
  svg: string
  viewBox: PdfShapeBounds
  shapeBoundsById: Map<string, PdfShapeBounds>
}

function renderSnapshot(
  snapshot: unknown,
  assets: ProjectPdfInput['assets'],
  tradingSnapshot?: ProjectPdfTradingSnapshot,
): SnapshotRender {
  const store = snapshotStore(snapshot)
  const shapes = Object.values(store)
    .map(objectValue)
    .filter((record) => record.typeName === 'shape')
    .sort((left, right) => String(left.index ?? '').localeCompare(String(right.index ?? '')))
  if (shapes.length > MAX_PROJECT_PDF_SHAPES) {
    throw new ProjectPdfError('PDF_SHAPE_LIMIT_EXCEEDED')
  }

  const shapeBoundsById = new Map<string, PdfShapeBounds>()
  for (const shape of shapes) shapeBoundsById.set(String(shape.id), shapeBounds(shape))
  const bounds = [...shapeBoundsById.values()]
  const left = bounds.length > 0 ? Math.min(...bounds.map((item) => item.x)) : 0
  const top = bounds.length > 0 ? Math.min(...bounds.map((item) => item.y)) : 0
  const right = bounds.length > 0 ? Math.max(...bounds.map((item) => item.x + item.width)) : 960
  const bottom = bounds.length > 0 ? Math.max(...bounds.map((item) => item.y + item.height)) : 540
  const viewBox = {
    x: left - SNAPSHOT_PADDING,
    y: top - SNAPSHOT_PADDING,
    width: Math.max(1, right - left + SNAPSHOT_PADDING * 2),
    height: Math.max(1, bottom - top + SNAPSHOT_PADDING * 2),
  }

  const body = shapes.map((shape) => {
    const id = String(shape.id)
    const type = String(shape.type ?? '')
    const props = objectValue(shape.props)
    const geometry = shapeBoundsById.get(id)!
    const stroke = normalizedColor(props.color, '#334155')
    const fill = type === 'note' ? '#fef3c7' : type === 'board-reference' ? '#e0f2fe' : '#ffffff'
    const text = richText(props.richText) || String(props.name ?? props.title ?? props.titleFallback ?? '')
    const common = `data-shape-id="${escapeXml(id)}"`

    if (type === 'trading-panel') {
      return renderTradingPanel(id, props, geometry, tradingSnapshot)
    }

    if (type === 'table') {
      const columns = Array.isArray(props.columns) ? props.columns.map(objectValue) : []
      const rows = Array.isArray(props.rows) ? props.rows.map(objectValue) : []
      const columnWeights = columns.map((column) => finiteNumber(column.width, 1 / Math.max(1, columns.length)))
      const rowWeights = rows.map((row) => finiteNumber(row.height, 1 / Math.max(1, rows.length)))
      let y = geometry.y
      const cells = rows.flatMap((row, rowIndex) => {
        const height = geometry.height * (rowWeights[rowIndex] ?? 0)
        const rowCells = Array.isArray(row.cells) ? row.cells.map(objectValue) : []
        let x = geometry.x
        const result = columns.map((_, columnIndex) => {
          const width = geometry.width * (columnWeights[columnIndex] ?? 0)
          const cell = rowCells[columnIndex] ?? {}
          const value = typeof cell.text === 'string' ? cell.text : ''
          const backgrounds: Record<string, string> = { gray: '#f2f3f5', blue: '#e8f1ff', yellow: '#fff6d8', green: '#e8f7ed', red: '#feeceb' }
          const align = cell.align === 'center' || cell.align === 'right' ? cell.align : 'left'
          const textX = align === 'left' ? x + 7 : align === 'right' ? x + width - 7 : x + width / 2
          const anchor = align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle'
          const border = cell.border === 'none' ? 'none' : cell.border === 'strong' ? '#7d8797' : '#d7dce3'
          const svg = `<g><rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${backgrounds[String(cell.background)] ?? '#ffffff'}" stroke="${border}" stroke-width="${cell.border === 'strong' ? 2 : 1}"/><text x="${textX}" y="${y + Math.min(22, Math.max(14, height - 7))}" text-anchor="${anchor}" fill="#1f2633" font-family="sans-serif" font-size="12" font-weight="${cell.header ? 700 : 500}">${escapeXml(value.slice(0, 80))}</text></g>`
          x += width
          return svg
        })
        y += height
        return result
      }).join('')
      return `<g ${common}><rect x="${geometry.x}" y="${geometry.y}" width="${geometry.width}" height="${geometry.height}" fill="#ffffff" stroke="#8f98a8"/>${cells}</g>`
    }

    if (type === 'mind-map') {
      const nodes = Array.isArray(props.nodes) ? props.nodes.map(objectValue) : []
      const root = nodes.find((node) => node.parentId === null) ?? nodes[0]
      if (!root || typeof root.id !== 'string') return ''
      const depthOf = (node: Record<string, unknown>) => {
        let depth = 0
        let parentId = node.parentId
        const visited = new Set<string>()
        while (typeof parentId === 'string' && !visited.has(parentId)) {
          visited.add(parentId)
          depth += 1
          parentId = nodes.find((candidate) => candidate.id === parentId)?.parentId
        }
        return depth
      }
      const nodeById = new Map(nodes.filter((node) => typeof node.id === 'string').map((node) => [node.id as string, node]))
      const isVisible = (node: Record<string, unknown>) => {
        let parentId = node.parentId
        const visited = new Set<string>()
        while (typeof parentId === 'string' && !visited.has(parentId)) {
          visited.add(parentId)
          const parent = nodeById.get(parentId)
          if (!parent) break
          if (parent.collapsed === true) return false
          parentId = parent.parentId
        }
        return true
      }
      const visibleNodes = nodes.filter((node) => typeof node.id === 'string' && isVisible(node))
      const rootX = geometry.x + geometry.width / 2 - 70
      const rootY = geometry.y + geometry.height / 2 - 20
      const positions = new Map<string, { x: number; y: number; w: number; h: number }>()
      positions.set(root.id, { x: rootX, y: rootY, w: 140, h: 40 })
      const branches = visibleNodes.filter((node) => node.id !== root.id)
      branches.forEach((node, index) => {
        const depth = Math.max(1, depthOf(node))
        const side = props.layout === 'bilateral' && node.side === 'left' ? -1 : 1
        const x = side > 0 ? rootX + 140 + depth * 48 : rootX - 120 - depth * 48
        const y = geometry.y + ((index + 1) * geometry.height) / (branches.length + 1) - 17
        positions.set(node.id as string, { x, y, w: 120, h: 34 })
      })
      const edges = branches.map((node) => {
        const from = typeof node.parentId === 'string' ? positions.get(node.parentId) : undefined
        const to = positions.get(node.id as string)
        if (!from || !to) return ''
        const style = objectValue(node.style)
        const edgeColor = mindMapPaletteColor(style.edgeColor, '#8f959e')
        const edgeOpacity = mindMapOpacity(style.edgeOpacity)
        const edgeWidth = Math.max(1, Math.min(4, Math.round(finiteNumber(style.edgeWidth, 2))))
        const dash = style.edgeDash === 'dashed' ? '10 7' : style.edgeDash === 'dotted' ? '2 6' : undefined
        return `<line x1="${from.x + from.w / 2}" y1="${from.y + from.h / 2}" x2="${to.x + to.w / 2}" y2="${to.y + to.h / 2}" stroke="${edgeColor}" stroke-opacity="${edgeOpacity}" stroke-width="${edgeWidth}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`
      }).join('')
      const cards = visibleNodes.map((node) => {
        const position = positions.get(node.id as string)
        if (!position) return ''
        const isRoot = node.id === root.id
        const value = typeof node.text === 'string' ? node.text : ''
        const palettes: Record<string, [string, string]> = {
          blue: ['#3370ff', '#245bd7'], violet: ['#7f5af0', '#6842d8'], green: ['#28a745', '#20883a'],
          orange: ['#f59e0b', '#d47f00'], red: ['#e5484d', '#c9363b'], gray: ['#ffffff', '#9eb3d5'],
        }
        const palette = palettes[String(node.color)] ?? (isRoot ? palettes.blue! : palettes.gray!)
        const colorful = props.theme === 'colorful'
        const minimal = props.theme === 'minimal' || node.shape === 'underline'
        const style = objectValue(node.style)
        const fill = minimal ? 'transparent' : mindMapPaletteColor(style.fillColor, isRoot || colorful ? palette[0] : '#ffffff')
        const foreground = mindMapPaletteColor(style.textColor, isRoot || colorful ? '#ffffff' : '#1f2329')
        const border = mindMapPaletteColor(style.borderColor, palette[1])
        const fillOpacity = mindMapOpacity(style.fillOpacity)
        const borderOpacity = mindMapOpacity(style.borderOpacity)
        const textOpacity = mindMapOpacity(style.textOpacity)
        const radius = node.shape === 'pill' ? position.h / 2 : node.shape === 'underline' ? 0 : 9
        const underline = minimal ? `<line x1="${position.x}" y1="${position.y + position.h}" x2="${position.x + position.w}" y2="${position.y + position.h}" stroke="${border}" stroke-opacity="${borderOpacity}" stroke-width="3"/>` : ''
        const fontSizes: Record<string, number> = { s: 12, m: 14, l: 18, xl: 24 }
        const fontSize = fontSizes[String(style.fontSize)] ?? 14
        const fontFamilies: Record<string, string> = { draw: 'cursive', sans: 'sans-serif', serif: 'serif', mono: 'monospace' }
        const fontFamily = fontFamilies[String(style.fontFamily)] ?? 'sans-serif'
        const align = style.textAlign === 'center' || style.textAlign === 'right' ? style.textAlign : 'left'
        const textX = align === 'left' ? position.x + 9 : align === 'right' ? position.x + position.w - 9 : position.x + position.w / 2
        const anchor = align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle'
        const decoration = [style.underline === true ? 'underline' : '', style.strike === true ? 'line-through' : ''].filter(Boolean).join(' ')
        return `<g><rect x="${position.x}" y="${position.y}" width="${position.w}" height="${position.h}" rx="${radius}" fill="${fill}" fill-opacity="${fillOpacity}" stroke="${minimal ? 'none' : border}" stroke-opacity="${borderOpacity}"/>${underline}<text x="${textX}" y="${position.y + position.h / 2 + fontSize * 0.34}" text-anchor="${anchor}" fill="${foreground}" fill-opacity="${textOpacity}" font-family="${fontFamily}" font-size="${fontSize}" font-weight="${style.bold === false ? 500 : 700}" font-style="${style.italic === true ? 'italic' : 'normal'}"${decoration ? ` text-decoration="${decoration}"` : ''}>${escapeXml(value.slice(0, 48))}</text></g>`
      }).join('')
      return `<g ${common}>${edges}${cards}</g>`
    }

    if (type === 'image') {
      const asset = objectValue(store[String(props.assetId ?? '')])
      const assetProps = objectValue(asset.props)
      const originalSource = typeof assetProps.src === 'string' ? assetProps.src : ''
      const source = safeImageSource(
        assetLookup(assets, String(asset.id ?? ''))
        ?? assetLookup(assets, originalSource)
        ?? originalSource,
      )
      return source
        ? `<image ${common} x="${geometry.x}" y="${geometry.y}" width="${geometry.width}" height="${geometry.height}" href="${escapeXml(source)}" preserveAspectRatio="xMidYMid meet"/>`
        : `<rect ${common} x="${geometry.x}" y="${geometry.y}" width="${geometry.width}" height="${geometry.height}" rx="8" fill="#e2e8f0" stroke="#94a3b8"/>`
    }

    if (type === 'text') {
      return `<text ${common} x="${geometry.x}" y="${geometry.y + 24}" fill="${stroke}" font-family="sans-serif" font-size="18">${escapeXml(text)}</text>`
    }

    if (type === 'arrow' || type === 'line') {
      const start = objectValue(props.start)
      const end = objectValue(props.end)
      const baseX = finiteNumber(shape.x, 0)
      const baseY = finiteNumber(shape.y, 0)
      const manualPoints = manualArrowPoints(shape)
      if (manualPoints) {
        const points = manualPoints.map((point) => `${baseX + point.x},${baseY + point.y}`).join(' ')
        const dash = props.dash === 'dashed' ? ' stroke-dasharray="10 6"' : props.dash === 'dotted' ? ' stroke-dasharray="2 6"' : ''
        const middle = manualPoints[Math.floor(manualPoints.length / 2)]!
        const label = text ? `<text x="${baseX + middle.x}" y="${baseY + middle.y - 8}" text-anchor="middle" fill="${stroke}" font-family="sans-serif" font-size="14">${escapeXml(text)}</text>` : ''
        return `<g ${common}><polyline points="${points}" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"${dash}/>${label}</g>`
      }
      return `<line ${common} x1="${baseX + finiteNumber(start.x, 0)}" y1="${baseY + finiteNumber(start.y, 0)}" x2="${baseX + finiteNumber(end.x, geometry.width)}" y2="${baseY + finiteNumber(end.y, geometry.height)}" stroke="${stroke}" stroke-width="2"/>`
    }

    const radius = type === 'board-reference' || type === 'note' ? 12 : 4
    return `<g ${common}><rect x="${geometry.x}" y="${geometry.y}" width="${geometry.width}" height="${geometry.height}" rx="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="2"/><text x="${geometry.x + 12}" y="${geometry.y + 30}" fill="#0f172a" font-family="sans-serif" font-size="16">${escapeXml(text)}</text></g>`
  }).join('')

  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${viewBox.width}" height="${viewBox.height}" viewBox="${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}"><rect x="${viewBox.x}" y="${viewBox.y}" width="${viewBox.width}" height="${viewBox.height}" fill="#ffffff"/>${body}</svg>`,
    viewBox,
    shapeBoundsById,
  }
}

export function renderSnapshotToSvg(
  snapshot: unknown,
  assets: ProjectPdfInput['assets'] = {},
  tradingSnapshot?: ProjectPdfTradingSnapshot,
): string {
  return renderSnapshot(snapshot, assets, tradingSnapshot).svg
}

function destinationName(boardId: string): string {
  return `board-${boardId.replace(/[^a-z0-9_.-]/gi, '-')}`
}

function outlineFor(
  pages: readonly ProjectPdfPage[],
  references: readonly BoardReferenceRecord[],
): ProjectPdfOutlineItem[] {
  const pageById = new Map(pages.map((page) => [page.board.id, page]))
  const children = new Map<string, string[]>(pages.map((page) => [page.board.id, []]))
  const childIdsBySource = new Map<string, Set<string>>(pages.map((page) => [page.board.id, new Set()]))
  const parentsByChild = new Map<string, Set<string>>(pages.map((page) => [page.board.id, new Set()]))
  for (const reference of references) {
    if (reference.kind !== 'embed') continue
    const childIds = childIdsBySource.get(reference.sourceBoardId)
    const parents = parentsByChild.get(reference.targetBoardId)
    if (childIds && parents && !childIds.has(reference.targetBoardId)) {
      childIds.add(reference.targetBoardId)
      parents.add(reference.sourceBoardId)
    }
  }
  for (const page of pages) {
    for (const parentId of parentsByChild.get(page.board.id) ?? []) {
      children.get(parentId)?.push(page.board.id)
    }
  }

  const expanded = new Set<string>()
  const build = (boardId: string): ProjectPdfOutlineItem => {
    const page = pageById.get(boardId)!
    const expandChildren = !expanded.has(boardId)
    expanded.add(boardId)
    return {
      boardId,
      title: page.board.title,
      pageNo: page.pageNo,
      children: expandChildren
        ? (children.get(boardId) ?? [])
          .map(build)
        : [],
    }
  }
  const embeddedTargets = new Set(
    [...parentsByChild.entries()].filter(([, parents]) => parents.size > 0).map(([boardId]) => boardId),
  )
  const roots = pages.filter((page) => !embeddedTargets.has(page.board.id))
  return (roots.length > 0 ? roots : pages).map((page) => build(page.board.id))
}

export function createProjectPdfPlan(input: ProjectPdfInput): ProjectPdfPlan {
  const boardIds = stableTopologicalBoardOrder(input.project, input.boards, input.references)
  const boardById = new Map(input.boards.map((board) => [board.id, board]))
  const pageByBoardId = new Map(boardIds.map((boardId, index) => [boardId, index + 1]))
  const pages = boardIds.map((boardId, index): ProjectPdfPage => ({
    board: boardById.get(boardId)!,
    pageNo: index + 1,
    destination: destinationName(boardId),
    links: input.references
      .filter((reference) => reference.sourceBoardId === boardId)
      .sort((left, right) => {
        const shape = left.shapeId.localeCompare(right.shapeId)
        return shape !== 0 ? shape : left.id.localeCompare(right.id)
      })
      .map((reference) => ({
        referenceId: reference.id,
        shapeId: reference.shapeId,
        kind: reference.kind,
        targetBoardId: reference.targetBoardId,
        targetPageNo: pageByBoardId.get(reference.targetBoardId)!,
      })),
  }))
  return {
    pages,
    pageByBoardId,
    outline: outlineFor(pages, input.references),
  }
}

function addOutline(parent: PdfOutline, items: readonly ProjectPdfOutlineItem[]): void {
  for (const item of items) {
    const child = parent.addItem(item.title, {
      pageNumber: item.pageNo - 1,
      expanded: item.children.length > 0,
    })
    addOutline(child, item.children)
  }
}

function collectPdf(document: PdfDocumentLike): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = []
    document.on('data', (chunk: Uint8Array) => chunks.push(new Uint8Array(chunk)))
    document.on('error', reject)
    document.on('end', () => {
      const length = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
      const bytes = new Uint8Array(length)
      let offset = 0
      for (const chunk of chunks) {
        bytes.set(chunk, offset)
        offset += chunk.byteLength
      }
      resolve(bytes)
    })
  })
}

export async function renderProjectToPdf(input: ProjectPdfInput): Promise<Uint8Array> {
  if (input.boards.length === 0) throw new ProjectPdfError('PDF_PROJECT_EMPTY')
  if (input.boards.length > MAX_PROJECT_PDF_BOARDS) {
    throw new ProjectPdfError('PDF_BOARD_LIMIT_EXCEEDED')
  }
  let projectShapeCount = 0
  for (const board of input.boards) {
    projectShapeCount += snapshotShapeCount(board.tldrawSnapshot)
    if (projectShapeCount > MAX_PROJECT_PDF_SHAPES) {
      throw new ProjectPdfError('PDF_PROJECT_SHAPE_LIMIT_EXCEEDED')
    }
  }
  const plan = createProjectPdfPlan(input)
  const PDFDocument = require('pdfkit') as PdfDocumentConstructor
  const svgToPdf = require('svg-to-pdfkit') as SvgToPdf
  const document = new PDFDocument({
    autoFirstPage: false,
    compress: true,
    info: { Title: input.project.title, Creator: 'Infinite Board' },
  })
  document
    .registerFont(PDF_FONT_FAMILY, pdfFontPath('NotoSansHans-Regular.otf'))
    .registerFont(PDF_FONT_BOLD, pdfFontPath('NotoSansHans-Bold.otf'))
  const output = collectPdf(document)
  const contentX = PAGE_MARGIN
  const contentY = PAGE_MARGIN + TITLE_HEIGHT
  const contentWidth = PAGE_WIDTH - PAGE_MARGIN * 2
  const contentHeight = PAGE_HEIGHT - contentY - PAGE_MARGIN

  for (const page of plan.pages) {
    document.addPage({ size: [PAGE_WIDTH, PAGE_HEIGHT], margin: 0 })
    document.addNamedDestination(page.destination, 'Fit')
    document.font(PDF_FONT_BOLD).fontSize(20).fillColor('#0f172a').text(page.board.title, PAGE_MARGIN, PAGE_MARGIN, {
      width: contentWidth,
      height: TITLE_HEIGHT,
      ellipsis: true,
    })
    const rendered = renderSnapshot(page.board.tldrawSnapshot, input.assets, input.tradingSnapshot)
    try {
      svgToPdf(document, rendered.svg, contentX, contentY, {
        width: contentWidth,
        height: contentHeight,
        preserveAspectRatio: 'xMidYMid meet',
        assumePt: true,
        fontCallback: (
          _family: string,
          bold: boolean,
          italic: boolean,
          fontOptions: { fauxItalic?: boolean },
        ) => {
          if (italic) fontOptions.fauxItalic = true
          return bold ? PDF_FONT_BOLD : PDF_FONT_FAMILY
        },
      })
    } catch (error) {
      document.end()
      throw new Error(`PDF_SVG_RENDER_FAILED:${page.board.id}`, { cause: error })
    }

    const scale = Math.min(
      contentWidth / rendered.viewBox.width,
      contentHeight / rendered.viewBox.height,
    )
    const offsetX = contentX + (contentWidth - rendered.viewBox.width * scale) / 2
    const offsetY = contentY + (contentHeight - rendered.viewBox.height * scale) / 2
    for (const link of page.links) {
      const bounds = rendered.shapeBoundsById.get(link.shapeId)
      if (!bounds) continue
      const targetPage = plan.pages[link.targetPageNo - 1]
      if (!targetPage) continue
      document.goTo(
        offsetX + (bounds.x - rendered.viewBox.x) * scale,
        offsetY + (bounds.y - rendered.viewBox.y) * scale,
        Math.max(1, bounds.width * scale),
        Math.max(1, bounds.height * scale),
        targetPage.destination,
      )
    }
  }
  addOutline(document.outline, plan.outline)
  document.end()
  return output
}
