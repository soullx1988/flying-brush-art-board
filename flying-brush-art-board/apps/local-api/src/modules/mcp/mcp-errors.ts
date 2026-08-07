import { RevisionConflictError } from '../boards/board-repository.js'

export interface McpPublicError {
  code: string
  message: string
  retryable: boolean
  currentRevision?: number
  details?: Record<string, unknown>
}

const PUBLIC_MESSAGES: Record<string, string> = {
  VALIDATION_ERROR: '参数校验失败。',
  MCP_SCOPE_REQUIRED: '当前个人访问令牌缺少此工具所需权限。',
  MCP_IDEMPOTENCY_CONFLICT: '幂等键已用于不同请求。',
  MCP_OPERATION_IN_PROGRESS: '相同幂等请求仍在执行。',
  MCP_PREVIOUS_OPERATION_FAILED: '相同幂等请求此前失败，请使用新的幂等键重试。',
  MCP_CONFIRMATION_INVALID: '确认令牌无效、已使用、已过期或目标版本已变化。',
  REVISION_CONFLICT: '画板已被其他用户修改，请重新读取后再规划。',
  PROJECT_NOT_FOUND: '项目不存在或不可访问。',
  BOARD_NOT_FOUND: '画板不存在或不可访问。',
  SHAPE_NOT_FOUND: '画布元素不存在。',
  BOARD_REFERENCE_NOT_FOUND: '画板引用不存在。',
  COMMENT_THREAD_NOT_FOUND: '评论不存在。',
  BOARD_REFERENCE_COMMAND_REQUIRED: '画板引用必须通过 reference_* 工具修改。',
  ROOT_BOARD_DELETE_FORBIDDEN: '根画板不能直接删除，请先设置其他根画板。',
  BOARD_REFERENCED: '画板仍被其他画板引用。',
  ASSET_NOT_FOUND: '图片资源不存在或格式不受支持。',
  MCP_TOOL_TIMEOUT: '工具执行超时。',
  MCP_TOOL_FAILED: '工具执行失败。',
}

function codeOf(error: unknown): string {
  if (error instanceof RevisionConflictError) return 'REVISION_CONFLICT'
  if (error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string') {
    return (error as { code: string }).code
  }
  if (error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)) return error.message
  return 'MCP_TOOL_FAILED'
}

export function publicMcpError(error: unknown): McpPublicError {
  const code = codeOf(error)
  const details = error && typeof error === 'object' && (error as { details?: unknown }).details
  const detailRecord = details && typeof details === 'object' && !Array.isArray(details)
    ? details as Record<string, unknown>
    : undefined
  const detailRevision = detailRecord?.currentRevision
  const currentRevision = error instanceof RevisionConflictError
    ? error.currentRevision
    : typeof detailRevision === 'number'
      ? detailRevision
      : undefined
  return {
    code,
    message: PUBLIC_MESSAGES[code] ?? '请求未完成。',
    retryable: ['REVISION_CONFLICT', 'MCP_OPERATION_IN_PROGRESS', 'MCP_TOOL_TIMEOUT'].includes(code),
    ...(currentRevision === undefined ? {} : { currentRevision }),
    ...(detailRecord ? { details: detailRecord } : {}),
  }
}
