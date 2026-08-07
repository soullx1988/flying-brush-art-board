export const BOARD_COMMAND_ERROR_CODES = [
  'BOARD_REFERENCED',
  'ROOT_BOARD_DELETE_FORBIDDEN',
  'BOARD_NOT_FOUND',
  'BOARD_REFERENCE_NOT_FOUND',
  'BOARD_REFERENCE_IMMUTABLE_FIELDS',
  'EMBEDDED_BOARD_TARGET_MISMATCH',
  'BOARD_EDIT_LEASED',
  'REVISION_CONFLICT',
  'BOARD_REFERENCE_COMMAND_REQUIRED',
  'CLIPBOARD_FORMAT_UNSUPPORTED',
  'CLIPBOARD_REFERENCE_INVALID',
  'CLIPBOARD_COMMAND_EXPIRED',
  'STALE_CLIPBOARD_COMMAND',
] as const

export type BoardCommandErrorCode = (typeof BOARD_COMMAND_ERROR_CODES)[number]

export interface BoardCommandErrorDetails {
  boardId?: string
  referenceId?: string
  sourceBoardId?: string
  targetBoardId?: string
  inboundReferenceIds?: readonly string[]
  projectId?: string
  rootBoardId?: string
}

export interface BoardCommandValidationError {
  code: string
  message: string
  details: BoardCommandErrorDetails
}

export type BoardCommandValidation =
  | { ok: true }
  | { ok: false; error: BoardCommandValidationError }

export class BoardCommandError extends Error {
  readonly code: BoardCommandErrorCode
  readonly details: BoardCommandErrorDetails

  constructor(code: BoardCommandErrorCode, details: BoardCommandErrorDetails = {}) {
    super(code)
    this.name = 'BoardCommandError'
    this.code = code
    this.details = details
  }
}
