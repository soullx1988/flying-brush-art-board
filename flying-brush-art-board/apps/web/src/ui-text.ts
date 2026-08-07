const ERROR_MESSAGES: Record<string, string> = {
  BOARD_EDITING_LEASE_REQUIRED: '当前画板正在其他标签页编辑，请稍后重试。',
  BOARD_FLUSH_FAILED: '画板保存失败，请稍后重试。',
  BOARD_REFERENCE_TARGET_NOT_FOUND: '目标画板不存在，可能已被删除。',
  EMBED_CYCLE: '嵌入画板不能形成循环，请改用普通链接。',
  EMBED_DEPTH_LIMIT_EXCEEDED: '嵌入层级过深，请改用普通链接。',
  CANVAS_CONTEXT_UNAVAILABLE: '无法读取画布内容。',
  CANVAS_PNG_FAILED: '无法生成 PNG 图片。',
  FILE_READ_FAILED: '无法读取文件。',
  FILE_TYPE_MISMATCH: '文件类型与扩展名不匹配。',
  IMPORT_FAILED: '导入失败，请稍后重试。',
  NO_ACTIVE_BOARD: '当前没有可用的画板。',
  NO_ACTIVE_PROJECT: '当前没有可用的项目。',
  NO_SHAPES_TO_EXPORT: '画板中没有可导出的内容。',
  UNSUPPORTED_DROP_TARGET: '当前区域不支持投放文件。',
  UNSUPPORTED_FILE_TYPE: '不支持此文件类型。',
  VISUAL_FILE_TYPE_MISMATCH: '视觉文件类型与扩展名不匹配。',
  VISUAL_IMPORT_UNAVAILABLE: '当前不支持导入视觉文件。',
}

export function chineseErrorMessage(error: unknown, fallback = '操作失败，请稍后重试。'): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  if (!raw) return fallback
  if (ERROR_MESSAGES[raw]) return ERROR_MESSAGES[raw]
  if (/^HTTP_\d+$/.test(raw)) return `请求失败（${raw.slice(5)}）。`
  if (/^[A-Z0-9_:-]+$/.test(raw) || /[A-Za-z]/.test(raw)) return fallback
  return raw
}

export function chineseAuditAction(action: string): string {
  const labels: Record<string, string> = {
    'auth.login': '登录',
    'auth.logout': '退出登录',
    'board.create': '创建画板',
    'board.delete': '删除画板',
    'board.edit': '编辑画板',
    'board.rename': '重命名画板',
    'comment.create': '发表评论',
    'comment.delete': '删除评论',
    'comment.move': '移动评论',
    'comment.reopen': '重新打开评论',
    'comment.reply': '回复评论',
    'comment.resolve': '解决评论',
    'export.complete': '完成导出',
    'import.commit': '完成导入',
    'project.create': '创建项目',
    'project.delete': '删除项目',
    'project.rename': '重命名项目',
    'project.root-board': '更改默认画板',
    'reference.create': '创建画板引用',
    'reference.delete': '删除画板引用',
    'reference.update': '更新画板引用',
  }
  return labels[action] ?? '系统操作'
}
