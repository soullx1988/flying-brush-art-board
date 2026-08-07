import {
  createTLStore,
  defaultShapeUtils,
  type TLAnyShapeUtilConstructor,
  type TLStore,
  type TLStoreOptions,
} from 'tldraw'

import { boardReferenceShapeUtils } from './shapes/board-reference/BoardReferenceShapeUtil.js'
import { enhancedArrowShapeUtils } from './shapes/arrow/EnhancedArrowShapeUtil.js'
import { mindMapShapeUtils } from './shapes/mind-map/MindMapShapeUtil.js'
import { tableShapeUtils } from './shapes/table/TableShapeUtil.js'

export const boardShapeUtils = [
  ...enhancedArrowShapeUtils,
  ...boardReferenceShapeUtils,
  ...tableShapeUtils,
  ...mindMapShapeUtils,
] as const

const replacedShapeTypes = new Set<string>(boardShapeUtils.map((shapeUtil) => shapeUtil.type))

/** Full, de-duplicated shape util list shared by local, browser sync and server stores. */
export const boardStoreShapeUtils = [
  ...defaultShapeUtils.filter((shapeUtil) => !replacedShapeTypes.has(shapeUtil.type)),
  ...boardShapeUtils,
] as TLAnyShapeUtilConstructor[]

/**
 * Creates the one, pinned tldraw 5.2.5 store configuration used by boards.
 * Callers may supply operational options (assets, users, snapshot), but not a
 * replacement schema: persisted board data must share the same schema.
 */
export function createBoardStore(
  options: Omit<TLStoreOptions, 'schema'> = {},
): TLStore {
  return createTLStore({
    ...options,
    shapeUtils: boardStoreShapeUtils,
  })
}

export interface TldrawLicenseEnvironment {
  VITE_TLDRAW_LICENSE_KEY?: unknown
}

/** Reads the Vite-injected key in a browser, with a Node-safe test fallback. */
export function getTldrawLicenseKey(
  environment: TldrawLicenseEnvironment | undefined = (import.meta as ImportMeta & { env?: TldrawLicenseEnvironment }).env,
): string | undefined {
  const viteKey = environment?.VITE_TLDRAW_LICENSE_KEY
  if (typeof viteKey === 'string' && viteKey.length > 0) return viteKey

  const nodeKey = typeof process !== 'undefined' ? process.env.VITE_TLDRAW_LICENSE_KEY : undefined
  return nodeKey || undefined
}
