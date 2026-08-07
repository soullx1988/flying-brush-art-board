import { readIboardArchive, type IboardArchiveReadLimits } from './archive-reader.js'
import { preflightIboardEntries, type IboardPreflightResult } from './import-preflight.js'
import { assertPublishedIboardVersion } from './migrations.js'

export type DecodedIboardProject = IboardPreflightResult

export interface ImportInspectionIssue {
  code: string
  message: string
  action: string
}

export interface ImportInspection {
  compatible: boolean
  formatVersion?: number
  sourceProject?: {
    id: string
    title: string
    rootBoardId: string
  }
  boardCount?: number
  referenceCount?: number
  maxEmbedDepth?: number
  assetCount?: number
  assetBytes?: number
  issues: ImportInspectionIssue[]
}

function errorCode(error: unknown): string {
  if (error instanceof Error && error.message) return error.message.split(':', 1)[0]!
  return 'IBOARD_IMPORT_INVALID'
}

function issueFor(code: string): ImportInspectionIssue {
  if (code === 'IBOARD_FORMAT_VERSION_UNSUPPORTED') {
    return {
      code,
      message: '此文件不是已发布的 .iboard v1 格式。',
      action: '请使用支持 .iboard v1 的版本重新导出。',
    }
  }
  if (code.includes('PATH_UNSAFE')) {
    return { code, message: '压缩包包含不安全路径。', action: '请从可信来源重新导出文件。' }
  }
  if (code.includes('HASH') || code.includes('ASSET')) {
    return { code, message: '资源内容或资源引用不一致。', action: '请重新导出完整文件并重试。' }
  }
  if (code.includes('REFERENCE') || code.includes('EMBED') || code.includes('BOARD')) {
    return { code, message: '画板引用图不完整或不兼容。', action: '请修复报告中的引用关系后重新导出。' }
  }
  return { code, message: '无法安全读取此 .iboard 文件。', action: '请确认文件完整且为 .iboard v1。' }
}

function longestEmbedDepth(decoded: DecodedIboardProject): number {
  const targets = new Map<string, string[]>()
  for (const board of decoded.boards) targets.set(board.id, [])
  for (const reference of decoded.references) {
    if (reference.kind === 'embed') targets.get(reference.sourceBoardId)?.push(reference.targetBoardId)
  }
  const memo = new Map<string, number>()
  const visit = (boardId: string): number => {
    const cached = memo.get(boardId)
    if (cached !== undefined) return cached
    const depth = 1 + Math.max(0, ...(targets.get(boardId) ?? []).map(visit))
    memo.set(boardId, depth)
    return depth
  }
  return Math.max(0, ...decoded.boards.map((board) => visit(board.id)))
}

export function decodeIboard(
  bytes: Uint8Array,
  limits: IboardArchiveReadLimits = {},
): DecodedIboardProject {
  const entries = readIboardArchive(bytes, limits)
  assertPublishedIboardVersion(entries)
  return preflightIboardEntries(entries)
}

export interface IboardInspectAnalysis {
  inspection: ImportInspection
  decoded?: DecodedIboardProject
}

export function inspectAndDecodeIboard(
  bytes: Uint8Array,
  limits: IboardArchiveReadLimits = {},
): IboardInspectAnalysis {
  try {
    const decoded = decodeIboard(bytes, limits)
    return {
      decoded,
      inspection: {
        compatible: true,
        formatVersion: decoded.manifest.formatVersion,
        sourceProject: {
          id: decoded.manifest.projectId,
          title: decoded.manifest.title,
          rootBoardId: decoded.manifest.rootBoardId,
        },
        boardCount: decoded.boards.length,
        referenceCount: decoded.references.length,
        maxEmbedDepth: longestEmbedDepth(decoded),
        assetCount: decoded.assets.length,
        assetBytes: decoded.assets.reduce((total, asset) => total + asset.size, 0),
        issues: [],
      },
    }
  } catch (error) {
    return { inspection: { compatible: false, issues: [issueFor(errorCode(error))] } }
  }
}

export function inspectIboard(
  bytes: Uint8Array,
  limits: IboardArchiveReadLimits = {},
): ImportInspection {
  return inspectAndDecodeIboard(bytes, limits).inspection
}
