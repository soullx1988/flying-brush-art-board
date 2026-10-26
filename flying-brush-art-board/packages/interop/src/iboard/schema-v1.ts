import type { BoardReferenceRecord, ImportSource, ProjectNavigation } from '@infinite-board/board-core'
import { z } from 'zod'

export const IBOARD_FORMAT = 'infinite-board' as const
export const IBOARD_FORMAT_VERSION = 1 as const
export const IBOARD_REFERENCES_PATH = 'references.json' as const

export interface IboardBoardDescriptorV1 {
  id: string
  path: string
}

export interface IboardAssetUsageV1 {
  boardId: string
  shapeId: string
  assetRecordId: string
}

export interface IboardAssetDescriptorV1 {
  sha256: string
  path: string
  mime: string
  size: number
  usages: IboardAssetUsageV1[]
}

export interface IboardManifestV1 {
  navigation?: ProjectNavigation
  format: typeof IBOARD_FORMAT
  formatVersion: typeof IBOARD_FORMAT_VERSION
  projectId: string
  title: string
  rootBoardId: string
  boards: IboardBoardDescriptorV1[]
  referencesPath: typeof IBOARD_REFERENCES_PATH
  assets: IboardAssetDescriptorV1[]
}

export interface IboardBoardV1 {
  title: string
  revision: number
  sourceMetadata?: ImportSource
  tldrawSnapshot: unknown
}

export type IboardReferencesV1 = BoardReferenceRecord[]

export interface IboardAssetInputV1 {
  sha256: string
  mime: string
  size: number
  bytes: Uint8Array
  usages: readonly IboardAssetUsageV1[]
}

const identifierSchema = z.string().min(1)
const archivePathSchema = z.string().min(1)
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)

export const iboardBoardDescriptorV1Schema = z.object({
  id: identifierSchema,
  path: archivePathSchema,
}).strict()

export const iboardAssetUsageV1Schema = z.object({
  boardId: identifierSchema,
  shapeId: identifierSchema,
  assetRecordId: identifierSchema,
}).strict()

export const iboardAssetDescriptorV1Schema = z.object({
  sha256: sha256Schema,
  path: archivePathSchema,
  mime: z.string().min(1),
  size: z.number().int().nonnegative(),
  usages: z.array(iboardAssetUsageV1Schema),
}).strict()

export const iboardManifestV1Schema = z.object({
  navigation: z.object({
    version: z.literal(1), revision: z.number().int().nonnegative(),
    topics: z.array(z.object({ id: z.string().startsWith('topic:'), title: z.string().min(1).max(100), description: z.string().max(300) }).strict()).max(100),
    parents: z.record(z.string().min(1), z.string().min(1)),
  }).strict().optional(),
  format: z.literal(IBOARD_FORMAT),
  formatVersion: z.literal(IBOARD_FORMAT_VERSION),
  projectId: identifierSchema,
  title: z.string(),
  rootBoardId: identifierSchema,
  boards: z.array(iboardBoardDescriptorV1Schema),
  referencesPath: z.literal(IBOARD_REFERENCES_PATH),
  assets: z.array(iboardAssetDescriptorV1Schema),
}).strict()

const importSourceSchema = z.object({
  kind: z.string().min(1),
  importedAt: z.string().min(1),
  sourceId: z.string().min(1).optional(),
}).strict()

export const iboardBoardV1Schema = z.object({
  title: z.string(),
  revision: z.number().int().nonnegative(),
  sourceMetadata: importSourceSchema.optional(),
  tldrawSnapshot: z.unknown(),
}).strict()

export const iboardReferenceV1Schema = z.object({
  id: identifierSchema,
  projectId: identifierSchema,
  sourceBoardId: identifierSchema,
  targetBoardId: identifierSchema,
  shapeId: identifierSchema,
  kind: z.enum(['embed', 'link']),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
}).strict()

export const iboardReferencesV1Schema = z.array(iboardReferenceV1Schema)

export function parseIboardManifestV1(value: unknown): IboardManifestV1 {
  const parsed = iboardManifestV1Schema.safeParse(value)
  if (!parsed.success) throw new Error('IBOARD_MANIFEST_INVALID')
  return parsed.data as IboardManifestV1
}

export function parseIboardBoardV1(value: unknown): IboardBoardV1 {
  const parsed = iboardBoardV1Schema.safeParse(value)
  if (!parsed.success) throw new Error('IBOARD_BOARD_INVALID')
  const sourceMetadata = parsed.data.sourceMetadata === undefined
    ? undefined
    : {
        kind: parsed.data.sourceMetadata.kind,
        importedAt: parsed.data.sourceMetadata.importedAt,
        ...(parsed.data.sourceMetadata.sourceId === undefined
          ? {}
          : { sourceId: parsed.data.sourceMetadata.sourceId }),
      }
  return {
    title: parsed.data.title,
    revision: parsed.data.revision,
    ...(sourceMetadata === undefined ? {} : { sourceMetadata }),
    tldrawSnapshot: parsed.data.tldrawSnapshot,
  }
}

export function parseIboardReferencesV1(value: unknown): IboardReferencesV1 {
  const parsed = iboardReferencesV1Schema.safeParse(value)
  if (!parsed.success) throw new Error('IBOARD_REFERENCES_INVALID')
  return parsed.data
}
