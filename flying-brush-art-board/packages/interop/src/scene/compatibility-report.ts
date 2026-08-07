export type ImportCompatibilityIssueSeverity = 'warning' | 'error'

export interface ImportCompatibilityIssue {
  code: string
  message: string
  severity: ImportCompatibilityIssueSeverity
  elementId?: string
  sourceType?: string
}

export interface ImportCompatibilityReport {
  issues: ImportCompatibilityIssue[]
  unsupportedElementCount: number
  downgradedElementCount: number
  migrations: string[]
}

export interface ImportResult<T> {
  value: T
  report: ImportCompatibilityReport
}

export function createImportCompatibilityReport(
  input: Partial<Omit<ImportCompatibilityReport, 'issues' | 'migrations'>> & {
    issues?: readonly ImportCompatibilityIssue[]
    migrations?: readonly string[]
  } = {},
): ImportCompatibilityReport {
  return {
    issues: input.issues ? [...input.issues] : [],
    unsupportedElementCount: input.unsupportedElementCount ?? 0,
    downgradedElementCount: input.downgradedElementCount ?? 0,
    migrations: input.migrations ? [...input.migrations] : [],
  }
}
