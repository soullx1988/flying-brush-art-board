export const YISHUI_INFERENCE_SCHEMA_VERSION = 'xzn-yishui-inference-board-v1' as const
export const YISHUI_INFERENCE_ACTION_CEILING = 'WATCH_ONLY' as const

export type YishuiInferenceMode = 'CURRENT' | 'HISTORICAL_REPLAY'
export type YishuiFactUsability = 'VERIFIED' | 'PARTIAL'
export type YishuiSentimentNodeStatus =
  | 'CLIMAX'
  | 'COOLING'
  | 'DIVERGENCE'
  | 'ICE'
  | 'REPAIR'
  | 'MIXED'
  | 'UNKNOWN'
export type YishuiDimensionStatus = 'OBSERVED' | 'PARTIAL' | 'MISSING' | 'UNKNOWN'
export type YishuiSectorStatus = 'DOMINANT' | 'COEXISTING' | 'ROTATION' | 'DEFENSIVE_TILT' | 'UNRESOLVED'
export type YishuiLineStatus = 'SUPPORTED' | 'PLAUSIBLE' | 'REJECTED' | 'UNRESOLVED'
export type YishuiRelationType = 'UNIFIED' | 'SPLIT' | 'COMPETING' | 'COEXISTING' | 'UNRESOLVED'
export type YishuiTestStatus = 'PASSED' | 'FAILED' | 'UNRESOLVED'
export type YishuiStructureRole = 'LEADER' | 'SUPPLEMENT' | 'FOLLOWER' | 'ANCHOR' | 'TREND' | 'MID_TIER' | 'UNCLASSIFIED'
export type YishuiInitiativeRole = 'ACTIVE' | 'PASSIVE' | 'MIXED' | 'UNKNOWN'
export type YishuiMarketFunction = 'PRICE_DISCOVERY' | 'SENTIMENT_ANCHOR' | 'LIQUIDITY_CARRIER' | 'HEIGHT_MARKER' | 'UNKNOWN'
export type YishuiTradability = 'OBSERVABLE' | 'CANDIDATE' | 'NOT_SUITABLE' | 'UNKNOWN'
export type YishuiBranchStatus = 'FROZEN' | 'OPEN' | 'SUPPORTED' | 'INVALIDATED' | 'EXPIRED' | 'UNRESOLVED'
export type YishuiSettlementStatus = 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE'
export type YishuiMarketDimensionKey =
  | 'breadth'
  | 'durability'
  | 'height'
  | 'priorWinnerFeedback'
  | 'lossEffect'
  | 'liquidity'
  | 'styleFlow'

export interface YishuiFactEnvelopeRef {
  requestFingerprint: string
  snapshotId: string
}

export interface YishuiSourceStageRef {
  tradeDate: string
  phase: string
  archiveSha256: string
}

export interface YishuiEvidenceStatement {
  text: string
  evidenceRefIds: string[]
}

export interface YishuiMarketDimension {
  key: YishuiMarketDimensionKey
  label: string
  status: YishuiDimensionStatus
  summary: string
  evidenceRefIds: string[]
}

export interface YishuiMarketNode {
  status: YishuiSentimentNodeStatus
  label: string
  summary: string
  dimensions: YishuiMarketDimension[]
  support: YishuiEvidenceStatement[]
  counterEvidence: YishuiEvidenceStatement[]
}

export interface YishuiSectorRef {
  normalizedName: string
  taxonomyRef: string
  constituentSetRef: string
  sourceSnapshotId: string
}

export interface YishuiSectorMember {
  code: string
  name: string
}

export interface YishuiSectorLine {
  lineId: string
  label: string
  status: YishuiLineStatus
  sectorRefs: YishuiSectorRef[]
  sharedMembers: YishuiSectorMember[]
  uniqueMemberSummary: string
  thesis: string
  counterEvidence: string
  evidenceRefIds: string[]
}

export interface YishuiSectorRelation {
  fromLineId: string
  toLineId: string
  relationType: YishuiRelationType
  summary: string
  evidenceRefIds: string[]
}

export interface YishuiAntiSelfDeceptionTest {
  testId: string
  label: string
  status: YishuiTestStatus
  summary: string
  evidenceRefIds: string[]
}

export interface YishuiSectorStructure {
  status: YishuiSectorStatus
  summary: string
  lines: YishuiSectorLine[]
  relations: YishuiSectorRelation[]
  antiSelfDeceptionTests: YishuiAntiSelfDeceptionTest[]
}

export interface YishuiRoleNode {
  code: string
  name: string
  targetFactEnvelopeRef: YishuiFactEnvelopeRef
  structureRole: YishuiStructureRole
  initiativeRole: YishuiInitiativeRole
  marketFunctions: YishuiMarketFunction[]
  tradability: YishuiTradability
  summary: string
  evidenceRefIds: string[]
  counterEvidence: string[]
}

export interface YishuiFrozenBranch {
  branchId: string
  label: string
  status: YishuiBranchStatus
  hypothesis: string
  trigger: string[]
  invalidation: string[]
  deadline: string
  sourceSnapshotId: string
  evidenceRefIds: string[]
}

export interface YishuiPreviousSettlement {
  status: YishuiSettlementStatus
  summary: string
  confirmed: string[]
  falsified: string[]
  unresolved: string[]
}

export interface YishuiEvidenceRef {
  refId: string
  label: string
  sourcePath: string
  sourceSnapshotId: string
}

export interface YishuiMissingItem {
  code: string
  summary: string
  impact: string
}

export interface YishuiInferenceContractRules {
  uiMayInfer: false
  uiMayRankSectors: false
  uiMayAssignRoles: false
  uiMayConvertBranchToTrade: false
}

export interface YishuiInferenceBoardContract {
  schemaVersion: typeof YISHUI_INFERENCE_SCHEMA_VERSION
  mode: YishuiInferenceMode
  generatedAt: string
  dataAsOf: string
  validUntil: string
  factEnvelopeRef: YishuiFactEnvelopeRef
  sourceStageRef: YishuiSourceStageRef
  factUsability: YishuiFactUsability
  actionCeiling: typeof YISHUI_INFERENCE_ACTION_CEILING
  marketNode: YishuiMarketNode
  sectorStructure: YishuiSectorStructure
  roleNodes: YishuiRoleNode[]
  branches: YishuiFrozenBranch[]
  previousSettlement: YishuiPreviousSettlement
  evidenceRefs: YishuiEvidenceRef[]
  missing: YishuiMissingItem[]
  contractRules: YishuiInferenceContractRules
}

export type YishuiInferenceBoardValidation =
  | { mode: 'absent' }
  | { mode: 'invalid'; reasonCodes: string[] }
  | { mode: 'valid'; board: YishuiInferenceBoardContract }

type JsonRecord = Record<string, unknown>

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/
const TRADE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/

const MARKET_NODE_STATUSES = new Set<YishuiSentimentNodeStatus>(['CLIMAX', 'COOLING', 'DIVERGENCE', 'ICE', 'REPAIR', 'MIXED', 'UNKNOWN'])
const DIMENSION_STATUSES = new Set<YishuiDimensionStatus>(['OBSERVED', 'PARTIAL', 'MISSING', 'UNKNOWN'])
const SECTOR_STATUSES = new Set<YishuiSectorStatus>(['DOMINANT', 'COEXISTING', 'ROTATION', 'DEFENSIVE_TILT', 'UNRESOLVED'])
const LINE_STATUSES = new Set<YishuiLineStatus>(['SUPPORTED', 'PLAUSIBLE', 'REJECTED', 'UNRESOLVED'])
const RELATION_TYPES = new Set<YishuiRelationType>(['UNIFIED', 'SPLIT', 'COMPETING', 'COEXISTING', 'UNRESOLVED'])
const TEST_STATUSES = new Set<YishuiTestStatus>(['PASSED', 'FAILED', 'UNRESOLVED'])
const STRUCTURE_ROLES = new Set<YishuiStructureRole>(['LEADER', 'SUPPLEMENT', 'FOLLOWER', 'ANCHOR', 'TREND', 'MID_TIER', 'UNCLASSIFIED'])
const INITIATIVE_ROLES = new Set<YishuiInitiativeRole>(['ACTIVE', 'PASSIVE', 'MIXED', 'UNKNOWN'])
const MARKET_FUNCTIONS = new Set<YishuiMarketFunction>(['PRICE_DISCOVERY', 'SENTIMENT_ANCHOR', 'LIQUIDITY_CARRIER', 'HEIGHT_MARKER', 'UNKNOWN'])
const TRADABILITY_VALUES = new Set<YishuiTradability>(['OBSERVABLE', 'CANDIDATE', 'NOT_SUITABLE', 'UNKNOWN'])
const BRANCH_STATUSES = new Set<YishuiBranchStatus>(['FROZEN', 'OPEN', 'SUPPORTED', 'INVALIDATED', 'EXPIRED', 'UNRESOLVED'])
const SETTLEMENT_STATUSES = new Set<YishuiSettlementStatus>(['AVAILABLE', 'PARTIAL', 'UNAVAILABLE'])
const REQUIRED_DIMENSION_KEYS = [
  'breadth',
  'durability',
  'height',
  'priorWinnerFeedback',
  'lossEffect',
  'liquidity',
  'styleFlow',
] as const satisfies readonly YishuiMarketDimensionKey[]
const REQUIRED_DIMENSION_KEY_SET = new Set<string>(REQUIRED_DIMENSION_KEYS)

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactRecord(value: unknown, keys: readonly string[], path: string, issues: string[]): value is JsonRecord {
  if (!isRecord(value)) {
    issues.push(`${path}:NOT_OBJECT`)
    return false
  }
  const actualKeys = Object.keys(value)
  if (actualKeys.length !== keys.length || actualKeys.some((key) => !keys.includes(key))) {
    issues.push(`${path}:KEYS_MISMATCH`)
    return false
  }
  return true
}

function nonEmptyString(value: unknown, path: string, issues: string[]): value is string {
  if (typeof value === 'string' && value.trim().length > 0) return true
  issues.push(`${path}:STRING_REQUIRED`)
  return false
}

function enumValue<T extends string>(value: unknown, allowed: ReadonlySet<T>, path: string, issues: string[]): value is T {
  if (typeof value === 'string' && allowed.has(value as T)) return true
  issues.push(`${path}:ENUM_INVALID`)
  return false
}

function sha256(value: unknown, path: string, issues: string[]): value is string {
  if (typeof value === 'string' && SHA256_PATTERN.test(value)) return true
  issues.push(`${path}:SHA256_INVALID`)
  return false
}

function isoTimestamp(value: unknown, path: string, issues: string[]): value is string {
  if (typeof value === 'string' && ISO_TIMESTAMP_PATTERN.test(value) && Number.isFinite(Date.parse(value))) return true
  issues.push(`${path}:TIMESTAMP_INVALID`)
  return false
}

function stringArray(value: unknown, path: string, issues: string[]): value is string[] {
  if (!Array.isArray(value)) {
    issues.push(`${path}:ARRAY_REQUIRED`)
    return false
  }
  value.forEach((item, index) => nonEmptyString(item, `${path}[${index}]`, issues))
  return true
}

function evidenceIds(value: unknown, path: string, issues: string[], knownEvidenceIds?: ReadonlySet<string>): value is string[] {
  if (!stringArray(value, path, issues)) return false
  if (knownEvidenceIds) {
    value.forEach((refId, index) => {
      if (!knownEvidenceIds.has(refId)) issues.push(`${path}[${index}]:EVIDENCE_REF_UNKNOWN`)
    })
  }
  return true
}

function validateFactEnvelopeRef(value: unknown, issues: string[]): value is YishuiFactEnvelopeRef {
  if (!exactRecord(value, ['requestFingerprint', 'snapshotId'], 'factEnvelopeRef', issues)) return false
  sha256(value.requestFingerprint, 'factEnvelopeRef.requestFingerprint', issues)
  sha256(value.snapshotId, 'factEnvelopeRef.snapshotId', issues)
  return true
}

function validateSourceStageRef(value: unknown, issues: string[]): value is YishuiSourceStageRef {
  if (!exactRecord(value, ['tradeDate', 'phase', 'archiveSha256'], 'sourceStageRef', issues)) return false
  if (typeof value.tradeDate !== 'string' || !TRADE_DATE_PATTERN.test(value.tradeDate)) issues.push('sourceStageRef.tradeDate:TRADE_DATE_INVALID')
  nonEmptyString(value.phase, 'sourceStageRef.phase', issues)
  sha256(value.archiveSha256, 'sourceStageRef.archiveSha256', issues)
  return true
}

function validateEvidenceRefs(value: unknown, snapshotId: string | undefined, issues: string[]): Set<string> {
  const ids = new Set<string>()
  if (!Array.isArray(value)) {
    issues.push('evidenceRefs:ARRAY_REQUIRED')
    return ids
  }
  value.forEach((item, index) => {
    const path = `evidenceRefs[${index}]`
    if (!exactRecord(item, ['refId', 'label', 'sourcePath', 'sourceSnapshotId'], path, issues)) return
    if (nonEmptyString(item.refId, `${path}.refId`, issues)) {
      if (ids.has(item.refId)) issues.push(`${path}.refId:DUPLICATE`)
      ids.add(item.refId)
    }
    nonEmptyString(item.label, `${path}.label`, issues)
    nonEmptyString(item.sourcePath, `${path}.sourcePath`, issues)
    if (sha256(item.sourceSnapshotId, `${path}.sourceSnapshotId`, issues) && snapshotId && item.sourceSnapshotId !== snapshotId) {
      issues.push(`${path}.sourceSnapshotId:SNAPSHOT_MISMATCH`)
    }
  })
  return ids
}

function validateMarketNode(value: unknown, knownEvidenceIds: ReadonlySet<string>, issues: string[]): void {
  if (!exactRecord(value, ['status', 'label', 'summary', 'dimensions', 'support', 'counterEvidence'], 'marketNode', issues)) return
  enumValue(value.status, MARKET_NODE_STATUSES, 'marketNode.status', issues)
  nonEmptyString(value.label, 'marketNode.label', issues)
  nonEmptyString(value.summary, 'marketNode.summary', issues)
  if (!Array.isArray(value.dimensions)) issues.push('marketNode.dimensions:ARRAY_REQUIRED')
  else {
    const dimensionKeys = new Set<string>()
    value.dimensions.forEach((item, index) => {
    const path = `marketNode.dimensions[${index}]`
    if (!exactRecord(item, ['key', 'label', 'status', 'summary', 'evidenceRefIds'], path, issues)) return
    if (nonEmptyString(item.key, `${path}.key`, issues)) {
      if (!REQUIRED_DIMENSION_KEY_SET.has(item.key)) issues.push(`${path}.key:DIMENSION_UNKNOWN`)
      if (dimensionKeys.has(item.key)) issues.push(`${path}.key:DUPLICATE`)
      dimensionKeys.add(item.key)
      if (item.key !== REQUIRED_DIMENSION_KEYS[index]) issues.push(`${path}.key:DIMENSION_ORDER_INVALID`)
    }
    nonEmptyString(item.label, `${path}.label`, issues)
    enumValue(item.status, DIMENSION_STATUSES, `${path}.status`, issues)
    nonEmptyString(item.summary, `${path}.summary`, issues)
    evidenceIds(item.evidenceRefIds, `${path}.evidenceRefIds`, issues, knownEvidenceIds)
    })
    if (value.dimensions.length !== REQUIRED_DIMENSION_KEYS.length
      || dimensionKeys.size !== REQUIRED_DIMENSION_KEYS.length
      || REQUIRED_DIMENSION_KEYS.some((key) => !dimensionKeys.has(key))) {
      issues.push('marketNode.dimensions:SEVEN_DIMENSIONS_REQUIRED')
    }
  }
  for (const key of ['support', 'counterEvidence'] as const) {
    const statements = value[key]
    const path = `marketNode.${key}`
    if (!Array.isArray(statements)) issues.push(`${path}:ARRAY_REQUIRED`)
    else statements.forEach((item, index) => {
      const itemPath = `${path}[${index}]`
      if (!exactRecord(item, ['text', 'evidenceRefIds'], itemPath, issues)) return
      nonEmptyString(item.text, `${itemPath}.text`, issues)
      evidenceIds(item.evidenceRefIds, `${itemPath}.evidenceRefIds`, issues, knownEvidenceIds)
    })
  }
}

function validateSectorStructure(value: unknown, snapshotId: string | undefined, knownEvidenceIds: ReadonlySet<string>, issues: string[]): void {
  if (!exactRecord(value, ['status', 'summary', 'lines', 'relations', 'antiSelfDeceptionTests'], 'sectorStructure', issues)) return
  enumValue(value.status, SECTOR_STATUSES, 'sectorStructure.status', issues)
  nonEmptyString(value.summary, 'sectorStructure.summary', issues)
  const lineIds = new Set<string>()
  if (!Array.isArray(value.lines)) issues.push('sectorStructure.lines:ARRAY_REQUIRED')
  else value.lines.forEach((item, index) => {
    const path = `sectorStructure.lines[${index}]`
    if (!exactRecord(item, ['lineId', 'label', 'status', 'sectorRefs', 'sharedMembers', 'uniqueMemberSummary', 'thesis', 'counterEvidence', 'evidenceRefIds'], path, issues)) return
    if (nonEmptyString(item.lineId, `${path}.lineId`, issues)) {
      if (lineIds.has(item.lineId)) issues.push(`${path}.lineId:DUPLICATE`)
      lineIds.add(item.lineId)
    }
    nonEmptyString(item.label, `${path}.label`, issues)
    enumValue(item.status, LINE_STATUSES, `${path}.status`, issues)
    if (!Array.isArray(item.sectorRefs) || item.sectorRefs.length === 0) issues.push(`${path}.sectorRefs:NON_EMPTY_ARRAY_REQUIRED`)
    else item.sectorRefs.forEach((sectorRef, sectorIndex) => {
      const sectorPath = `${path}.sectorRefs[${sectorIndex}]`
      if (!exactRecord(sectorRef, ['normalizedName', 'taxonomyRef', 'constituentSetRef', 'sourceSnapshotId'], sectorPath, issues)) return
      nonEmptyString(sectorRef.normalizedName, `${sectorPath}.normalizedName`, issues)
      nonEmptyString(sectorRef.taxonomyRef, `${sectorPath}.taxonomyRef`, issues)
      sha256(sectorRef.constituentSetRef, `${sectorPath}.constituentSetRef`, issues)
      if (sha256(sectorRef.sourceSnapshotId, `${sectorPath}.sourceSnapshotId`, issues) && snapshotId && sectorRef.sourceSnapshotId !== snapshotId) {
        issues.push(`${sectorPath}.sourceSnapshotId:SNAPSHOT_MISMATCH`)
      }
    })
    if (!Array.isArray(item.sharedMembers)) issues.push(`${path}.sharedMembers:ARRAY_REQUIRED`)
    else item.sharedMembers.forEach((member, memberIndex) => {
      const memberPath = `${path}.sharedMembers[${memberIndex}]`
      if (!exactRecord(member, ['code', 'name'], memberPath, issues)) return
      nonEmptyString(member.code, `${memberPath}.code`, issues)
      nonEmptyString(member.name, `${memberPath}.name`, issues)
    })
    nonEmptyString(item.uniqueMemberSummary, `${path}.uniqueMemberSummary`, issues)
    nonEmptyString(item.thesis, `${path}.thesis`, issues)
    nonEmptyString(item.counterEvidence, `${path}.counterEvidence`, issues)
    evidenceIds(item.evidenceRefIds, `${path}.evidenceRefIds`, issues, knownEvidenceIds)
  })
  if (!Array.isArray(value.relations)) issues.push('sectorStructure.relations:ARRAY_REQUIRED')
  else value.relations.forEach((item, index) => {
    const path = `sectorStructure.relations[${index}]`
    if (!exactRecord(item, ['fromLineId', 'toLineId', 'relationType', 'summary', 'evidenceRefIds'], path, issues)) return
    const fromLineId = item.fromLineId
    const toLineId = item.toLineId
    const fromValid = nonEmptyString(fromLineId, `${path}.fromLineId`, issues)
    const toValid = nonEmptyString(toLineId, `${path}.toLineId`, issues)
    if (fromValid && !lineIds.has(fromLineId)) issues.push(`${path}.fromLineId:LINE_UNKNOWN`)
    if (toValid && !lineIds.has(toLineId)) issues.push(`${path}.toLineId:LINE_UNKNOWN`)
    if (fromValid && toValid && fromLineId === toLineId) issues.push(`${path}:SELF_RELATION_FORBIDDEN`)
    enumValue(item.relationType, RELATION_TYPES, `${path}.relationType`, issues)
    nonEmptyString(item.summary, `${path}.summary`, issues)
    evidenceIds(item.evidenceRefIds, `${path}.evidenceRefIds`, issues, knownEvidenceIds)
  })
  const antiTestIds = new Set<string>()
  if (!Array.isArray(value.antiSelfDeceptionTests)) issues.push('sectorStructure.antiSelfDeceptionTests:ARRAY_REQUIRED')
  else value.antiSelfDeceptionTests.forEach((item, index) => {
    const path = `sectorStructure.antiSelfDeceptionTests[${index}]`
    if (!exactRecord(item, ['testId', 'label', 'status', 'summary', 'evidenceRefIds'], path, issues)) return
    if (nonEmptyString(item.testId, `${path}.testId`, issues)) {
      if (antiTestIds.has(item.testId)) issues.push(`${path}.testId:DUPLICATE`)
      antiTestIds.add(item.testId)
    }
    nonEmptyString(item.label, `${path}.label`, issues)
    enumValue(item.status, TEST_STATUSES, `${path}.status`, issues)
    nonEmptyString(item.summary, `${path}.summary`, issues)
    evidenceIds(item.evidenceRefIds, `${path}.evidenceRefIds`, issues, knownEvidenceIds)
  })
}

function validateRoleNodes(value: unknown, knownEvidenceIds: ReadonlySet<string>, issues: string[]): void {
  if (!Array.isArray(value)) {
    issues.push('roleNodes:ARRAY_REQUIRED')
    return
  }
  const roleCodes = new Set<string>()
  value.forEach((item, index) => {
    const path = `roleNodes[${index}]`
    if (!exactRecord(item, ['code', 'name', 'targetFactEnvelopeRef', 'structureRole', 'initiativeRole', 'marketFunctions', 'tradability', 'summary', 'evidenceRefIds', 'counterEvidence'], path, issues)) return
    if (nonEmptyString(item.code, `${path}.code`, issues)) {
      if (roleCodes.has(item.code)) issues.push(`${path}.code:DUPLICATE`)
      roleCodes.add(item.code)
    }
    nonEmptyString(item.name, `${path}.name`, issues)
    if (exactRecord(item.targetFactEnvelopeRef, ['requestFingerprint', 'snapshotId'], `${path}.targetFactEnvelopeRef`, issues)) {
      sha256(item.targetFactEnvelopeRef.requestFingerprint, `${path}.targetFactEnvelopeRef.requestFingerprint`, issues)
      sha256(item.targetFactEnvelopeRef.snapshotId, `${path}.targetFactEnvelopeRef.snapshotId`, issues)
    }
    enumValue(item.structureRole, STRUCTURE_ROLES, `${path}.structureRole`, issues)
    enumValue(item.initiativeRole, INITIATIVE_ROLES, `${path}.initiativeRole`, issues)
    if (!Array.isArray(item.marketFunctions) || item.marketFunctions.length === 0) issues.push(`${path}.marketFunctions:NON_EMPTY_ARRAY_REQUIRED`)
    else {
      item.marketFunctions.forEach((entry, entryIndex) => enumValue(entry, MARKET_FUNCTIONS, `${path}.marketFunctions[${entryIndex}]`, issues))
      if (item.marketFunctions.includes('UNKNOWN') && item.marketFunctions.length > 1) issues.push(`${path}.marketFunctions:UNKNOWN_MUST_STAND_ALONE`)
    }
    enumValue(item.tradability, TRADABILITY_VALUES, `${path}.tradability`, issues)
    nonEmptyString(item.summary, `${path}.summary`, issues)
    evidenceIds(item.evidenceRefIds, `${path}.evidenceRefIds`, issues, knownEvidenceIds)
    stringArray(item.counterEvidence, `${path}.counterEvidence`, issues)
  })
}

function validateBranches(value: unknown, snapshotId: string | undefined, knownEvidenceIds: ReadonlySet<string>, issues: string[]): void {
  if (!Array.isArray(value)) {
    issues.push('branches:ARRAY_REQUIRED')
    return
  }
  const branchIds = new Set<string>()
  value.forEach((item, index) => {
    const path = `branches[${index}]`
    if (!exactRecord(item, ['branchId', 'label', 'status', 'hypothesis', 'trigger', 'invalidation', 'deadline', 'sourceSnapshotId', 'evidenceRefIds'], path, issues)) return
    if (nonEmptyString(item.branchId, `${path}.branchId`, issues)) {
      if (branchIds.has(item.branchId)) issues.push(`${path}.branchId:DUPLICATE`)
      branchIds.add(item.branchId)
    }
    nonEmptyString(item.label, `${path}.label`, issues)
    enumValue(item.status, BRANCH_STATUSES, `${path}.status`, issues)
    nonEmptyString(item.hypothesis, `${path}.hypothesis`, issues)
    if (stringArray(item.trigger, `${path}.trigger`, issues) && item.trigger.length === 0) issues.push(`${path}.trigger:NON_EMPTY_ARRAY_REQUIRED`)
    if (stringArray(item.invalidation, `${path}.invalidation`, issues) && item.invalidation.length === 0) issues.push(`${path}.invalidation:NON_EMPTY_ARRAY_REQUIRED`)
    isoTimestamp(item.deadline, `${path}.deadline`, issues)
    if (sha256(item.sourceSnapshotId, `${path}.sourceSnapshotId`, issues) && snapshotId && item.sourceSnapshotId !== snapshotId) {
      issues.push(`${path}.sourceSnapshotId:SNAPSHOT_MISMATCH`)
    }
    evidenceIds(item.evidenceRefIds, `${path}.evidenceRefIds`, issues, knownEvidenceIds)
  })
}

function validatePreviousSettlement(value: unknown, issues: string[]): void {
  if (!exactRecord(value, ['status', 'summary', 'confirmed', 'falsified', 'unresolved'], 'previousSettlement', issues)) return
  enumValue(value.status, SETTLEMENT_STATUSES, 'previousSettlement.status', issues)
  nonEmptyString(value.summary, 'previousSettlement.summary', issues)
  const settlementRows = [
    ['confirmed', value.confirmed],
    ['falsified', value.falsified],
    ['unresolved', value.unresolved],
  ] as const
  const seen = new Set<string>()
  settlementRows.forEach(([name, rows]) => {
    const path = `previousSettlement.${name}`
    if (!stringArray(rows, path, issues)) return
    rows.forEach((row, index) => {
      if (typeof row !== 'string' || row.trim().length === 0) return
      if (seen.has(row)) issues.push(`${path}[${index}]:DUPLICATE`)
      seen.add(row)
    })
  })
  if (
    value.status === 'UNAVAILABLE'
    && settlementRows.some(([, rows]) => Array.isArray(rows) && rows.length > 0)
  ) {
    issues.push('previousSettlement:UNAVAILABLE_MUST_BE_EMPTY')
  }
}

function validateMissing(value: unknown, issues: string[]): void {
  if (!Array.isArray(value)) {
    issues.push('missing:ARRAY_REQUIRED')
    return
  }
  value.forEach((item, index) => {
    const path = `missing[${index}]`
    if (!exactRecord(item, ['code', 'summary', 'impact'], path, issues)) return
    nonEmptyString(item.code, `${path}.code`, issues)
    nonEmptyString(item.summary, `${path}.summary`, issues)
    nonEmptyString(item.impact, `${path}.impact`, issues)
  })
}

function validateContractRules(value: unknown, issues: string[]): void {
  const keys = ['uiMayInfer', 'uiMayRankSectors', 'uiMayAssignRoles', 'uiMayConvertBranchToTrade'] as const
  if (!exactRecord(value, keys, 'contractRules', issues)) return
  keys.forEach((key) => {
    if (value[key] !== false) issues.push(`contractRules.${key}:MUST_BE_FALSE`)
  })
}

export function validateYishuiInferenceBoard(value: unknown): YishuiInferenceBoardValidation {
  if (value === undefined || value === null) return { mode: 'absent' }
  const issues: string[] = []
  const topLevelKeys = [
    'schemaVersion', 'mode', 'generatedAt', 'dataAsOf', 'validUntil', 'factEnvelopeRef',
    'sourceStageRef', 'factUsability', 'actionCeiling', 'marketNode', 'sectorStructure',
    'roleNodes', 'branches', 'previousSettlement', 'evidenceRefs', 'missing', 'contractRules',
  ] as const
  if (!exactRecord(value, topLevelKeys, 'board', issues)) return { mode: 'invalid', reasonCodes: issues }

  if (value.schemaVersion !== YISHUI_INFERENCE_SCHEMA_VERSION) issues.push('schemaVersion:UNSUPPORTED')
  enumValue(value.mode, new Set<YishuiInferenceMode>(['CURRENT', 'HISTORICAL_REPLAY']), 'mode', issues)
  const generatedAtValid = isoTimestamp(value.generatedAt, 'generatedAt', issues)
  const dataAsOfValid = isoTimestamp(value.dataAsOf, 'dataAsOf', issues)
  const validUntilValid = isoTimestamp(value.validUntil, 'validUntil', issues)
  if (dataAsOfValid && validUntilValid && Date.parse(value.validUntil as string) <= Date.parse(value.dataAsOf as string)) {
    issues.push('validUntil:NOT_AFTER_DATA_AS_OF')
  }
  if (generatedAtValid && dataAsOfValid && Date.parse(value.generatedAt as string) < Date.parse(value.dataAsOf as string)) {
    issues.push('generatedAt:BEFORE_DATA_AS_OF')
  }
  if (generatedAtValid && validUntilValid && Date.parse(value.generatedAt as string) > Date.parse(value.validUntil as string)) {
    issues.push('generatedAt:AFTER_VALID_UNTIL')
  }
  validateFactEnvelopeRef(value.factEnvelopeRef, issues)
  validateSourceStageRef(value.sourceStageRef, issues)
  enumValue(value.factUsability, new Set<YishuiFactUsability>(['VERIFIED', 'PARTIAL']), 'factUsability', issues)
  if (value.actionCeiling !== YISHUI_INFERENCE_ACTION_CEILING) issues.push('actionCeiling:MUST_BE_WATCH_ONLY')

  const snapshotId = isRecord(value.factEnvelopeRef) && typeof value.factEnvelopeRef.snapshotId === 'string'
    ? value.factEnvelopeRef.snapshotId
    : undefined
  const knownEvidenceIds = validateEvidenceRefs(value.evidenceRefs, snapshotId, issues)
  validateMarketNode(value.marketNode, knownEvidenceIds, issues)
  validateSectorStructure(value.sectorStructure, snapshotId, knownEvidenceIds, issues)
  validateRoleNodes(value.roleNodes, knownEvidenceIds, issues)
  validateBranches(value.branches, snapshotId, knownEvidenceIds, issues)
  validatePreviousSettlement(value.previousSettlement, issues)
  validateMissing(value.missing, issues)
  validateContractRules(value.contractRules, issues)

  return issues.length > 0
    ? { mode: 'invalid', reasonCodes: [...new Set(issues)] }
    : { mode: 'valid', board: value as unknown as YishuiInferenceBoardContract }
}
