import type { VisualImportInput } from './visual-import'

export type ImportDropTarget = 'tab-strip' | 'canvas' | 'new-tab' | 'global'

export type FileDropTarget =
  | { kind: 'tab-strip' }
  | { kind: 'new-tab' }
  | { kind: 'global' }
  | { kind: 'canvas'; dropPoint: { x: number; y: number } }

export interface ActiveImportTab {
  projectId: string
  boardId?: string
}

export type FileImportResult =
  | { fileName: string; status: 'success'; createdBoard: boolean; boardId?: string }
  | { fileName: string; status: 'error'; code: string }

type HandlerResult = void | FileImportResult | {
  boardId?: string
  createdBoard?: boolean
}

export interface DropImportControllerOptions {
  onIboard(file: File, target: ImportDropTarget | FileDropTarget): HandlerResult | Promise<HandlerResult>
  onTldr(file: File, target: ImportDropTarget | FileDropTarget): HandlerResult | Promise<HandlerResult>
  onDrawio(file: File, target: ImportDropTarget | FileDropTarget): HandlerResult | Promise<HandlerResult>
  onVisual?(input: VisualImportInput): HandlerResult | Promise<HandlerResult>
  onUnsupported(message: string): void
  activeTab?: ActiveImportTab | (() => ActiveImportTab | undefined)
}

export interface DropImportController {
  dispatch(
    files: readonly File[],
    target: ImportDropTarget | FileDropTarget,
    activeTab?: ActiveImportTab,
  ): Promise<FileImportResult[]>
}

const TLDR_MIME_TYPES = new Set([
  '',
  'application/json',
  'application/octet-stream',
  'application/vnd.tldraw+json',
])

const DRAWIO_MIME_TYPES = new Set([
  '',
  'application/octet-stream',
  'application/xml',
  'text/xml',
  'application/vnd.jgraph.mxfile',
])

const IBOARD_MIME_TYPES = new Set([
  '',
  'application/octet-stream',
  'application/zip',
  'application/vnd.infinite-board+zip',
])

const VISUAL_EXTENSION_MIME = new Map<string, string>([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.svg', 'image/svg+xml'],
  ['.pdf', 'application/pdf'],
])

function extensionOf(name: string): string {
  return name.toLowerCase().match(/\.[^.]+$/)?.[0] ?? ''
}

function normalizedTarget(target: ImportDropTarget | FileDropTarget): FileDropTarget {
  if (typeof target !== 'string') return target
  return target === 'canvas'
    ? { kind: 'canvas', dropPoint: { x: 0, y: 0 } }
    : { kind: target }
}

function isTldrFile(file: File): boolean {
  return extensionOf(file.name) === '.tldr' && TLDR_MIME_TYPES.has(file.type.toLowerCase())
}

function isDrawioFile(file: File): boolean {
  return extensionOf(file.name) === '.drawio' && DRAWIO_MIME_TYPES.has(file.type.toLowerCase())
}

function isIboardFile(file: File): boolean {
  return extensionOf(file.name) === '.iboard' && IBOARD_MIME_TYPES.has(file.type.toLowerCase())
}

function visualMime(file: File): string | undefined {
  return VISUAL_EXTENSION_MIME.get(extensionOf(file.name))
}

function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    return error.code
  }
  return error instanceof Error && error.message ? error.message : 'IMPORT_FAILED'
}

function successfulResult(file: File, result: HandlerResult, createdBoard: boolean): FileImportResult {
  if (result && 'status' in result) return result
  return {
    fileName: file.name,
    status: 'success',
    createdBoard: result?.createdBoard ?? createdBoard,
    ...(result?.boardId ? { boardId: result.boardId } : {}),
  }
}

async function dispatchOne(
  file: File,
  dropTarget: ImportDropTarget | FileDropTarget,
  activeTab: ActiveImportTab | undefined,
  handlers: DropImportControllerOptions,
): Promise<FileImportResult> {
  try {
    if (isIboardFile(file)) {
      return successfulResult(file, await handlers.onIboard(file, dropTarget), true)
    }
    if (isTldrFile(file)) {
      return successfulResult(file, await handlers.onTldr(file, dropTarget), true)
    }
    if (isDrawioFile(file)) {
      return successfulResult(file, await handlers.onDrawio(file, dropTarget), true)
    }

    const expectedVisualMime = visualMime(file)
    if (expectedVisualMime) {
      if (file.type.toLowerCase() !== expectedVisualMime) {
        throw new Error('VISUAL_FILE_TYPE_MISMATCH')
      }
      if (!handlers.onVisual) throw new Error('VISUAL_IMPORT_UNAVAILABLE')
      const target = normalizedTarget(dropTarget)
      if (target.kind === 'global') throw new Error('UNSUPPORTED_DROP_TARGET')
      if (target.kind === 'canvas') {
        if (!activeTab?.boardId) throw new Error('NO_ACTIVE_BOARD')
        return successfulResult(file, await handlers.onVisual({
          file,
          target: {
            kind: 'current-board',
            boardId: activeTab.boardId,
            dropPoint: target.dropPoint,
          },
        }), false)
      }
      if (!activeTab?.projectId) throw new Error('NO_ACTIVE_PROJECT')
      return successfulResult(file, await handlers.onVisual({
        file,
        target: { kind: 'new-board', projectId: activeTab.projectId },
      }), true)
    }

    const knownExtension = ['.iboard', '.tldr', '.drawio'].includes(extensionOf(file.name))
    throw new Error(knownExtension ? 'FILE_TYPE_MISMATCH' : 'UNSUPPORTED_FILE_TYPE')
  } catch (error) {
    const code = errorCode(error)
    handlers.onUnsupported(code)
    return { fileName: file.name, status: 'error', code }
  }
}

export async function dispatchDroppedFiles(
  files: readonly File[],
  dropTarget: ImportDropTarget | FileDropTarget,
  activeTab: ActiveImportTab | undefined,
  handlers: DropImportControllerOptions,
): Promise<FileImportResult[]> {
  if (files.filter((file) => extensionOf(file.name) === '.iboard').length > 1) {
    const code = 'IBOARD_SINGLE_FILE_REQUIRED'
    handlers.onUnsupported(code)
    return files.map((file) => ({ fileName: file.name, status: 'error', code }))
  }

  const results: FileImportResult[] = []
  for (const file of files) {
    results.push(await dispatchOne(file, dropTarget, activeTab, handlers))
  }
  return results
}

export function createDropImportController(options: DropImportControllerOptions): DropImportController {
  return {
    dispatch(files, target, activeTab) {
      const configuredActiveTab = typeof options.activeTab === 'function'
        ? options.activeTab()
        : options.activeTab
      return dispatchDroppedFiles(files, target, activeTab ?? configuredActiveTab, options)
    },
  }
}
