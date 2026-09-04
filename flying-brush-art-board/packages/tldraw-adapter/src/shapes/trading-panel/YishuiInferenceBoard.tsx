import {
  validateYishuiInferenceBoard,
  type YishuiInferenceBoardContract,
} from './yishui-inference.js'

export interface YishuiInferenceStatus {
  state:
    | 'PREMARKET_WAITING'
    | 'AUCTION_IN_PROGRESS'
    | 'OPENING_EVIDENCE_COLLECTION'
    | 'WAITING_FIRST_FRAME'
    | 'FIRST_FRAME_BASELINE'
    | 'COMPARISON_READY'
    | 'CURRENT_FRAME_ONLY'
    | 'UPDATING_NEXT_FRAME'
    | 'MIDDAY_BREAK'
    | 'POST_CLOSE_REPLAY'
    | 'MARKET_CLOSED'
    | 'SYSTEM_RECOVERING'
    | 'UNAVAILABLE'
    | string
  headline?: string
  message: string
  displayMode?: 'CURRENT' | 'HISTORICAL_REPLAY' | null
  currentTradeDate?: string
  sourceTradeDate?: string | null
  expectedFirstFrameAt?: string | null
  nextExpectedAt?: string | null
  recoveryAction?: string
  isSystemFault?: boolean
  comparisonSummary?: string
  qualitySummary?: string
  actionBoundary?: string
  actionCeiling?: 'WATCH_ONLY' | string
}

const VALUE_LABELS: Record<string, string> = {
  CURRENT: '当前推演',
  HISTORICAL_REPLAY: '历史回放',
  VERIFIED: '事实已核验',
  PARTIAL: '已按有效事实推演',
  WATCH_ONLY: '只观察',
  CLIMAX: '一致加速',
  COOLING: '强度降温',
  DIVERGENCE: '分歧',
  ICE: '冰点',
  REPAIR: '修复',
  MIXED: '多空混合',
  UNKNOWN: '本轮不下结论',
  OBSERVED: '已观察',
  MISSING: '等待下一帧',
  DOMINANT: '单一方向主导',
  COEXISTING: '多个方向共存',
  ROTATION: '方向轮动',
  DEFENSIVE_TILT: '防御增强',
  UNRESOLVED: '继续比较',
  SUPPORTED: '证据支持',
  PLAUSIBLE: '有可能，待验证',
  REJECTED: '证据不支持',
  UNIFIED: '可统一观察',
  SPLIT: '应拆分观察',
  COMPETING: '互相竞争',
  PASSED: '通过',
  FAILED: '未通过',
  LEADER: '结构前排',
  SUPPLEMENT: '补涨',
  FOLLOWER: '跟随',
  ANCHOR: '锚定',
  TREND: '趋势载体',
  MID_TIER: '中位',
  UNCLASSIFIED: '结构角色未定',
  ACTIVE: '主动',
  PASSIVE: '被动',
  PRICE_DISCOVERY: '价格发现',
  SENTIMENT_ANCHOR: '情绪锚',
  LIQUIDITY_CARRIER: '流动性载体',
  HEIGHT_MARKER: '高度标记',
  OBSERVABLE: '可观察',
  CANDIDATE: '候选研究',
  NOT_SUITABLE: '不适合作为候选',
  FROZEN: '已冻结',
  OPEN: '待验证',
  INVALIDATED: '已失效',
  EXPIRED: '已过期',
  AVAILABLE: '已有上轮结果',
  UNAVAILABLE: '暂无可比上轮',
}

function label(value: string): string {
  return VALUE_LABELS[value] ?? value
}

function formatTime(value: string): string {
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(parsed)
}

function hashPreview(value: string): string {
  return `${value.slice(0, 15)}…${value.slice(-6)}`
}

function YishuiStatusSummary({ status }: { status: YishuiInferenceStatus }) {
  return (
    <div
      className="trading-panel__yishui-status-summary"
      data-system-fault={status.isSystemFault === true ? 'true' : 'false'}
      role="status"
      aria-live="polite"
    >
      <strong>{status.headline ?? '义水画板状态'}</strong>
      <p>{status.message}</p>
      {status.qualitySummary ? <span>{status.qualitySummary}</span> : null}
      {status.comparisonSummary ? <span>{status.comparisonSummary}</span> : null}
      {status.recoveryAction ? <small>{status.recoveryAction}</small> : null}
      {status.nextExpectedAt ? <small>下一时点：{formatTime(status.nextExpectedAt)}</small> : null}
      <b>{status.actionBoundary ?? '只用于研究观察，不会自动下单。'}</b>
    </div>
  )
}

function EvidenceIds({ values }: { values: readonly string[] }) {
  return values.length > 0
    ? <small className="trading-panel__yishui-evidence">证据：{values.join(' · ')}</small>
    : <small className="trading-panel__yishui-evidence">证据：本项未绑定直接证据</small>
}

function OrderedTextList({ values, emptyText }: { values: readonly string[]; emptyText: string }) {
  if (values.length === 0) return <p className="trading-panel__yishui-empty-line">{emptyText}</p>
  return (
    <ul className="trading-panel__yishui-plain-list">
      {values.map((value, index) => <li data-item-order={index} key={`${index}:${value}`}>{value}</li>)}
    </ul>
  )
}

function InferenceBoardHeader({ board }: { board: YishuiInferenceBoardContract }) {
  return (
    <div className="trading-panel__yishui-contract-meta">
      <div>
        <span>用途</span>
        <strong>{board.mode === 'HISTORICAL_REPLAY' ? '历史回放 · 仅用于复盘' : label(board.mode)}</strong>
      </div>
      <div>
        <span>事实截至</span>
        <strong>{formatTime(board.dataAsOf)}</strong>
      </div>
      <div>
        <span>{board.mode === 'HISTORICAL_REPLAY' ? '当时有效至' : '当前有效至'}</span>
        <strong>{formatTime(board.validUntil)}</strong>
      </div>
      <div>
        <span>本轮处理</span>
        <strong data-state={board.factUsability}>{label(board.factUsability)}</strong>
      </div>
      <div>
        <span>权限边界</span>
        <strong data-state={board.actionCeiling}>{label(board.actionCeiling)}</strong>
      </div>
      <div title={board.factEnvelopeRef.snapshotId}>
        <span>事实快照</span>
        <strong>{hashPreview(board.factEnvelopeRef.snapshotId)}</strong>
      </div>
      {board.mode === 'HISTORICAL_REPLAY' ? (
        <p className="trading-panel__yishui-replay-warning" role="note">
          事后回看，不代表当时已经生成，也不能作为样本外有效性证明。
        </p>
      ) : null}
      <p>画板只复述后端冻结结论，不在浏览器里补推断、排板块、定角色或生成交易动作。</p>
      {board.missing.length > 0 ? (
        <ul className="trading-panel__yishui-missing" aria-label="下一步自动确认">
          {board.missing.map((item, index) => (
            <li data-item-order={index} key={`${index}:${item.code}`}>
              <strong>{item.summary}</strong>
              <span>{item.impact}</span>
            </li>
          ))}
        </ul>
      ) : <p className="trading-panel__yishui-no-missing">本轮需要的事实已处理完。</p>}
    </div>
  )
}

function MarketNodeSection({ board }: { board: YishuiInferenceBoardContract }) {
  return (
    <section aria-label="市场节点" data-yishui-section="market-node">
      <header>
        <div>
          <span>01 / 市场节点</span>
          <h3>{board.marketNode.label}</h3>
        </div>
        <b data-state={board.marketNode.status}>{label(board.marketNode.status)}</b>
      </header>
      <p>{board.marketNode.summary}</p>
      <div className="trading-panel__yishui-dimensions">
        {board.marketNode.dimensions.map((item, index) => (
          <article data-item-order={index} data-state={item.status} key={`${index}:${item.key}`}>
            <div><strong>{item.label}</strong><span>{label(item.status)}</span></div>
            <p>{item.summary}</p>
            <EvidenceIds values={item.evidenceRefIds} />
          </article>
        ))}
      </div>
      <div className="trading-panel__yishui-two-sided">
        <div>
          <h4>支持</h4>
          {board.marketNode.support.length > 0 ? (
            <ol>{board.marketNode.support.map((item, index) => (
              <li data-item-order={index} key={`${index}:${item.text}`}><span>{item.text}</span><EvidenceIds values={item.evidenceRefIds} /></li>
            ))}</ol>
          ) : <p className="trading-panel__yishui-empty-line">没有冻结的支持证据。</p>}
        </div>
        <div>
          <h4>反证</h4>
          {board.marketNode.counterEvidence.length > 0 ? (
            <ol>{board.marketNode.counterEvidence.map((item, index) => (
              <li data-item-order={index} key={`${index}:${item.text}`}><span>{item.text}</span><EvidenceIds values={item.evidenceRefIds} /></li>
            ))}</ol>
          ) : <p className="trading-panel__yishui-empty-line">没有冻结的反证。</p>}
        </div>
      </div>
    </section>
  )
}

function SectorStructureSection({ board }: { board: YishuiInferenceBoardContract }) {
  const structure = board.sectorStructure
  return (
    <section aria-label="板块统一与拆分" data-yishui-section="sector-structure">
      <header>
        <div>
          <span>02 / 板块统一与拆分</span>
          <h3>方向结构</h3>
        </div>
        <b data-state={structure.status}>{label(structure.status)}</b>
      </header>
      <p>{structure.summary}</p>
      <div className="trading-panel__yishui-lines">
        {structure.lines.map((line, index) => (
          <article data-item-order={index} data-state={line.status} key={`${index}:${line.lineId}`}>
            <header><strong>{line.label}</strong><span>{label(line.status)}</span></header>
            <p>{line.thesis}</p>
            <dl>
              <div><dt>纳入口径</dt><dd>{line.sectorRefs.map((item) => item.normalizedName).join(' · ') || '无'}</dd></div>
              <div><dt>共享个股</dt><dd>{line.sharedMembers.map((item) => `${item.name}(${item.code})`).join(' · ') || '无'}</dd></div>
              <div><dt>独有部分</dt><dd>{line.uniqueMemberSummary}</dd></div>
              <div><dt>反证</dt><dd>{line.counterEvidence}</dd></div>
            </dl>
            <EvidenceIds values={line.evidenceRefIds} />
          </article>
        ))}
      </div>
      <div className="trading-panel__yishui-relations">
        <h4>方向之间</h4>
        {structure.relations.length > 0 ? structure.relations.map((relation, index) => (
          <article data-item-order={index} key={`${index}:${relation.fromLineId}:${relation.toLineId}`}>
            <strong>{relation.fromLineId} → {relation.toLineId}</strong>
            <span data-state={relation.relationType}>{label(relation.relationType)}</span>
            <p>{relation.summary}</p>
            <EvidenceIds values={relation.evidenceRefIds} />
          </article>
        )) : <p className="trading-panel__yishui-empty-line">没有冻结的方向关系。</p>}
      </div>
      <div className="trading-panel__yishui-tests">
        <h4>反自欺检查</h4>
        {structure.antiSelfDeceptionTests.map((test, index) => (
          <article data-item-order={index} data-state={test.status} key={`${index}:${test.testId}`}>
            <div><strong>{test.label}</strong><span>{label(test.status)}</span></div>
            <p>{test.summary}</p>
            <EvidenceIds values={test.evidenceRefIds} />
          </article>
        ))}
      </div>
    </section>
  )
}

function RoleNodesSection({ board }: { board: YishuiInferenceBoardContract }) {
  return (
    <section aria-label="个股角色" data-yishui-section="role-nodes">
      <header>
        <div><span>03 / 个股角色</span><h3>四个轴分别核对</h3></div>
        <b>{board.roleNodes.length} 个对象</b>
      </header>
      {board.roleNodes.length > 0 ? (
        <div className="trading-panel__yishui-roles">
          {board.roleNodes.map((role, index) => (
            <article data-item-order={index} key={`${index}:${role.code}`}>
              <header><strong>{role.name}</strong><span>{role.code}</span></header>
              <dl>
                <div><dt>结构位置</dt><dd>{label(role.structureRole)}</dd></div>
                <div><dt>主动性</dt><dd>{label(role.initiativeRole)}</dd></div>
                <div><dt>市场功能</dt><dd>{role.marketFunctions.map(label).join(' · ')}</dd></div>
                <div><dt>可研究性</dt><dd>{label(role.tradability)}</dd></div>
              </dl>
              <p>{role.summary}</p>
              <OrderedTextList values={role.counterEvidence} emptyText="没有冻结的角色反证。" />
              <EvidenceIds values={role.evidenceRefIds} />
            </article>
          ))}
        </div>
      ) : <p className="trading-panel__yishui-empty-line">本轮暂不定个股角色；继续按板块分支和下一帧验证。</p>}
    </section>
  )
}

function FrozenBranchesSection({ board }: { board: YishuiInferenceBoardContract }) {
  return (
    <section aria-label="冻结分支" data-yishui-section="branches">
      <header>
        <div><span>04 / 冻结分支</span><h3>后续只验真，不临场改题</h3></div>
        <b>{board.branches.length} 条</b>
      </header>
      {board.branches.length > 0 ? (
        <div className="trading-panel__yishui-branches">
          {board.branches.map((branch, index) => (
            <article data-item-order={index} data-state={branch.status} key={`${index}:${branch.branchId}`}>
              <header>
                <strong>{branch.label}</strong>
                <span>{board.mode === 'HISTORICAL_REPLAY' ? '当时进度' : '验证进度'}：{label(branch.status)}</span>
              </header>
              <p>{branch.hypothesis}</p>
              <dl>
                <div><dt>触发</dt><dd><OrderedTextList values={branch.trigger} emptyText="未冻结触发条件" /></dd></div>
                <div><dt>失效</dt><dd><OrderedTextList values={branch.invalidation} emptyText="未冻结失效条件" /></dd></div>
                <div><dt>最晚验证</dt><dd>{formatTime(branch.deadline)}</dd></div>
              </dl>
              <EvidenceIds values={branch.evidenceRefIds} />
            </article>
          ))}
        </div>
      ) : <p className="trading-panel__yishui-empty-line">后端没有冻结可验证分支。</p>}
    </section>
  )
}

function PreviousSettlementSection({ board }: { board: YishuiInferenceBoardContract }) {
  const settlement = board.previousSettlement
  return (
    <section aria-label="上轮验真" data-yishui-section="previous-settlement">
      <header>
        <div><span>05 / 上轮验真</span><h3>之前的判断后来怎样</h3></div>
        <b data-state={settlement.status}>{label(settlement.status)}</b>
      </header>
      <p>{settlement.summary}</p>
      <div className="trading-panel__yishui-settlement-grid">
        <div><h4>证实</h4><OrderedTextList values={settlement.confirmed} emptyText="无" /></div>
        <div><h4>证伪</h4><OrderedTextList values={settlement.falsified} emptyText="无" /></div>
        <div><h4>未解决</h4><OrderedTextList values={settlement.unresolved} emptyText="无" /></div>
      </div>
    </section>
  )
}

function YishuiContractClosed({
  kind,
  reasons = [],
  status,
}: {
  kind: 'absent' | 'invalid'
  reasons?: readonly string[]
  status?: YishuiInferenceStatus | undefined
}) {
  return (
    <div className="trading-panel__body trading-panel__yishui-closed" role="status" data-contract-state={kind}>
      <strong>{kind === 'absent' ? status?.headline ?? '义水推演契约未接入' : '义水推演契约已关闭'}</strong>
      <span>{kind === 'absent'
        ? status?.message ?? '当前快照没有独立的义水推演结果；不会拿旧市场卡片冒充。'
        : '结构、身份、时间或只读边界没有通过校验；当前不展示部分结果，也不自行补齐。'}</span>
      {kind === 'absent' && status?.recoveryAction ? <small>{status.recoveryAction}</small> : null}
      {kind === 'absent' && status?.nextExpectedAt ? <small>下一时点：{formatTime(status.nextExpectedAt)}</small> : null}
      {kind === 'absent' ? <b>{status?.actionBoundary ?? '只用于研究观察，不会自动下单。'}</b> : null}
      {reasons.length > 0 ? <code>{reasons.slice(0, 6).join(' / ')}</code> : null}
    </div>
  )
}

export function YishuiInferenceBoard({
  value,
  status,
}: {
  value: unknown
  status?: YishuiInferenceStatus | undefined
}) {
  const validation = validateYishuiInferenceBoard(value)
  if (validation.mode === 'absent') return <YishuiContractClosed kind="absent" status={status} />
  if (validation.mode === 'invalid') return <YishuiContractClosed kind="invalid" reasons={validation.reasonCodes} status={status} />
  const board = validation.board
  return (
    <div className="trading-panel__body trading-panel__yishui" tabIndex={0} aria-label="义水北路只读推演画板">
      {status ? <YishuiStatusSummary status={status} /> : null}
      <InferenceBoardHeader board={board} />
      <MarketNodeSection board={board} />
      <SectorStructureSection board={board} />
      <RoleNodesSection board={board} />
      <FrozenBranchesSection board={board} />
      <PreviousSettlementSection board={board} />
    </div>
  )
}
