import {
  useTradingWorkbenchViewState,
  type TradingDrilldownCandidate,
  type TradingWorkbenchDrilldowns,
  type TradingWorkbenchSnapshot,
} from '@infinite-board/tldraw-adapter'

export const TRADING_DRILLDOWN_BOARD_IDS = {
  sentiment: 'board-e3d3579e-3ddd-4d62-9bb2-3a991319ff0b',
  flows: 'board-64466bcc-0a8c-43f6-8bca-b69e25706f0e',
  candidate: 'board-e5a80dcf-3c00-48b4-be98-38026a3e6b26',
  review: 'board-4032db70-9467-44aa-a96a-519dd21b361d',
  evidence: 'board-05c3db41-4000-4490-b418-59caecec54c7',
} as const

type DrilldownKind = keyof typeof TRADING_DRILLDOWN_BOARD_IDS

function drilldownKind(boardId: string | undefined): DrilldownKind | undefined {
  if (!boardId) return undefined
  return (Object.entries(TRADING_DRILLDOWN_BOARD_IDS) as Array<[DrilldownKind, string]>)
    .find(([, value]) => value === boardId)?.[0]
}

export function hasTradingDrilldown(boardId: string | undefined): boolean {
  return Boolean(drilldownKind(boardId))
}

function formatTime(value: string | null | undefined): string {
  if (!value || !Number.isFinite(Date.parse(value))) return '未提供'
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

function formatPercent(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${value > 0 ? '+' : ''}${value.toFixed(2)}%`
    : '—'
}

function formatAmount(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  return value >= 100_000_000
    ? `${(value / 100_000_000).toFixed(1)} 亿`
    : `${(value / 10_000).toFixed(0)} 万`
}

function statusLabel(value: string | undefined): string {
  const state = value?.toUpperCase()
  if (state === 'OBSERVED' || state === 'READY' || state === 'USABLE' || state === 'VERIFIED') return '已观察'
  if (state === 'PARTIAL') return '部分可用'
  if (state === 'MISSING' || state === 'UNAVAILABLE' || state === 'EMPTY') return '缺失'
  if (state === 'BLOCKED') return '本轮不下结论'
  if (state === 'CONFLICTED') return '需要复核'
  if (state === 'WATCH_ONLY') return '仅观察'
  if (state === 'BASELINE_ONLY') return '仅基线'
  return value || '未知'
}

function permissionLabel(value: string | undefined): string {
  const state = value?.trim().toUpperCase()
  if (state === 'ELIGIBLE_FOR_MANUAL_REVIEW' || state === 'ALLOWED') return '可提交人工复核'
  if (state === 'PENDING_TRIGGER' || state === 'PENDING' || state === 'WAIT') return '等待条件确认'
  if (state === 'WATCH_ONLY' || state === 'REVIEW_ONLY') return '只观察'
  if (state === 'BLOCKED' || state === 'DENIED' || state === 'NO_PARTICIPATION') return '当前不参与'
  return '等待实时确认'
}

function awaitsAuctionConfirmation(phase: string | undefined): boolean {
  const normalized = phase?.trim().toLowerCase() ?? ''
  return [
    'us_close',
    'post_close',
    'pre_open',
    'preopen_freeze_readonly',
    'preauction',
  ].includes(normalized)
}

function candidateExecutionLabel(value: string | undefined, phase: string | undefined): string {
  const state = value?.trim().toUpperCase()
  if (state === 'ELIGIBLE_FOR_MANUAL_REVIEW' || state === 'READY' || state === 'ALLOWED') {
    return '可提交人工复核'
  }
  if (state === 'PENDING_TRIGGER' || state === 'PENDING' || state === 'WAIT') return '等待条件确认'
  if (awaitsAuctionConfirmation(phase)) return '等待今日竞价确认'
  if (state === 'REVIEW_ONLY' || state === 'WATCH_ONLY') return '只观察，当前不参与'
  if (state === 'BLOCKED' || state === 'DENIED' || state === 'NO_PARTICIPATION') return '当前不参与'
  return '等待实时确认'
}

function DetailState({ value }: { value?: string | undefined }) {
  return <span className="trading-drilldown__state" data-state={value ?? 'UNKNOWN'}>{statusLabel(value)}</span>
}

function StringList({ values, empty }: { values?: string[] | undefined; empty: string }) {
  if (!values?.length) return <p className="trading-drilldown__empty-copy">{empty}</p>
  return <ul className="trading-drilldown__plain-list">{values.map((value) => <li key={value}>{value}</li>)}</ul>
}

function SentimentDetail({ details }: { details: TradingWorkbenchDrilldowns }) {
  const sentiment = details.marketSentiment
  return <div className="trading-drilldown__content">
    <section className="trading-drilldown__lead">
      <div><span>正式节点</span><strong>{sentiment?.nodeStatus === 'UNKNOWN' ? '当前不能定节点' : sentiment?.nodeStatus ?? '未知'}</strong></div>
      <p>{sentiment?.headline ?? '情绪详情尚未生成。'}</p>
    </section>
    <section>
      <div className="trading-drilldown__section-title"><h3>七维情绪</h3><small>每一维独立判定，不互相补齐</small></div>
      <div className="trading-drilldown__dimension-grid">
        {sentiment?.dimensions?.map((item) => <article key={item.key ?? item.label}>
          <header><strong>{item.label ?? item.key}</strong><DetailState value={item.status} /></header>
          <p>{item.summary ?? item.detail ?? '暂无摘要'}</p>
          {item.missingFields?.length ? <small>缺：{item.missingFields.join('、')}</small> : null}
        </article>)}
      </div>
    </section>
    <section>
      <div className="trading-drilldown__section-title"><h3>近期开合</h3><small>最多 5 个交易日</small></div>
      {sentiment?.history?.length ? <ol className="trading-drilldown__timeline">
        {sentiment.history.map((item) => <li key={item.sourceHash ?? item.tradeDate}>
          <time>{item.tradeDate ?? '—'}</time>
          <strong>{item.nodeVerdict ?? '未知'}</strong>
          <span>涨停 {item.limitUpTotal ?? '—'} · 跌停 {item.limitDownTotal ?? '—'} · 高度 {item.highestBoardLevel ?? '—'}</span>
        </li>)}
      </ol> : <p className="trading-drilldown__empty-copy">当前快照没有可比历史序列。</p>}
    </section>
    <aside className="trading-drilldown__boundary">{sentiment?.methodBoundary}</aside>
  </div>
}

function FundsDetail({ details }: { details: TradingWorkbenchDrilldowns }) {
  const flows = details.mainlineFunds
  return <div className="trading-drilldown__content">
    <section className="trading-drilldown__lead">
      <div><span>当前解释</span><strong>{statusLabel(flows?.status)}</strong></div>
      <p>{flows?.headline ?? '主线与资金详情尚未生成。'}</p>
    </section>
    <section>
      <div className="trading-drilldown__section-title"><h3>三种资金口径</h3><small>并列看，不能相加</small></div>
      <div className="trading-drilldown__basis-grid">
        {flows?.fundBases?.map((item) => <article key={item.key}>
          <header><strong>{item.label}</strong><DetailState value={item.status} /></header>
          <p>{item.summary}</p>
        </article>)}
      </div>
    </section>
    <section>
      <div className="trading-drilldown__section-title"><h3>当前强势方向</h3><small>事实排名，不等于因果主线</small></div>
      {flows?.topDirections?.length ? <div className="trading-drilldown__table" role="table" aria-label="当前强势方向">
        <div role="row" className="trading-drilldown__table-head"><span>方向</span><span>涨幅</span><span>成交</span><span>成分口径</span></div>
        {flows.topDirections.map((item) => <div role="row" key={`${item.taxonomy}:${item.name}`}>
          <span><strong>{item.name}</strong><small>#{item.rank ?? '—'}</small></span>
          <span>{formatPercent(item.changePct)}</span>
          <span>{formatAmount(item.turnoverAmountCny)}</span>
          <span>{item.constituentSetReady ? '已绑定' : '未绑定'}</span>
        </div>)}
      </div> : <p className="trading-drilldown__empty-copy">当前没有结构化方向事实。</p>}
    </section>
    <section>
      <div className="trading-drilldown__section-title"><h3>全市场双向广度</h3><small>上涨与下跌方向同时看</small></div>
      <div className="trading-drilldown__basis-grid">
        {flows?.twoWayFlow?.directions?.map((item) => <article key={item.taxonomy}>
          <header><strong>{item.taxonomy === 'INDUSTRY' ? '行业板块' : item.taxonomy === 'CONCEPT' ? '概念板块' : item.taxonomy}</strong><DetailState value={flows.twoWayFlow?.status} /></header>
          <p>上涨 {item.advanceCount ?? '—'} · 下跌 {item.declineCount ?? '—'} · 平盘 {item.flatCount ?? '—'}</p>
          <small>上涨方向成交 {formatAmount(item.advanceTurnoverAmountCny)} · 下跌方向成交 {formatAmount(item.declineTurnoverAmountCny)}</small>
        </article>)}
      </div>
    </section>
    <aside className="trading-drilldown__boundary">{flows?.methodBoundary}</aside>
  </div>
}

function CandidateSelector({ snapshotId, items, selected }: {
  snapshotId: string | null | undefined
  items: TradingDrilldownCandidate[]
  selected: TradingDrilldownCandidate
}) {
  return <nav className="trading-drilldown__candidate-tabs" aria-label="切换观察对象">
    {items.slice(0, 20).map((item) => {
      const search = new URLSearchParams()
      if (item.code) search.set('symbol', item.code)
      if (snapshotId) search.set('snapshot', snapshotId)
      return <a key={item.code} data-active={item.code === selected?.code} href={`?${search.toString()}`}>{item.name ?? item.code}</a>
    })}
  </nav>
}

function QuoteGrid({ quote }: { quote?: Record<string, unknown> | undefined }) {
  const rows: Array<[string, string]> = [
    ['现价', String(quote?.currentPrice ?? '—')],
    ['涨幅', formatPercent(quote?.priceChangePct)],
    ['开盘缺口', formatPercent(quote?.openGapPct)],
    ['相对均价', formatPercent(quote?.averagePremiumPct)],
    ['换手', formatPercent(quote?.turnoverRatio)],
    ['量比', typeof quote?.volumeRatio === 'number' ? quote.volumeRatio.toFixed(2) : '—'],
  ]
  return <dl className="trading-drilldown__metrics">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
}

function CandidateDetail({ details, snapshot }: {
  details: TradingWorkbenchDrilldowns
  snapshot: TradingWorkbenchSnapshot
}) {
  const items = details.candidates?.items ?? []
  const requested = new URLSearchParams(window.location.search).get('symbol')
  const selected = items.find((item) => item.code === requested) ?? items[0]
  if (!selected) return <div className="trading-drilldown__content"><p className="trading-drilldown__empty-copy">当前快照没有冻结候选或盘中复核对象。</p></div>
  const phase = details.meta?.phase ?? snapshot.todayOverview?.currentPhase
  const executionLabel = candidateExecutionLabel(selected.currentExecution?.state, phase)
  return <div className="trading-drilldown__content">
    <CandidateSelector snapshotId={snapshot.sourceHash} items={items} selected={selected} />
    <section className="trading-drilldown__candidate-hero">
      <div><span>{selected.originLabel}</span><h3>{selected.name} <small>{selected.code}</small></h3><p>{selected.statusLabel}</p></div>
      <div className="trading-drilldown__candidate-permission" data-eligible={selected.currentExecution?.eligible ? 'true' : 'false'}>
        <span>当前执行状态</span>
        <strong>{selected.currentExecution?.eligible ? '仅可提交人工复核' : executionLabel}</strong>
        <small>{executionLabel} · 总权限 {permissionLabel(details.meta?.actionCeiling)}</small>
      </div>
    </section>
    <QuoteGrid quote={selected.quote} />
    <section className="trading-drilldown__reason-grid">
      <article><h3>为什么出现它</h3><p>{selected.selectionSummary}</p><StringList values={selected.supportingFacts} empty="没有可定位的支持事实。" /></article>
      <article data-tone="risk"><h3>为什么还不能参与</h3><StringList values={selected.limitingFacts} empty="当前没有额外限制说明，仍服从总权限。" /></article>
    </section>
    <section className="trading-drilldown__reason-grid">
      <article><h3>同类怎么定义</h3><p><strong>{selected.peerComparison?.label ?? '同类未定义'}</strong></p><p>{selected.peerComparison?.definition ?? '比较组尚未冻结。'}</p><small>{selected.peerComparison?.verdict}</small></article>
      <article><h3>下一次看什么</h3><p>{selected.nextCheck ?? '等待下一阶段事实。'}</p><StringList values={selected.confirmConditions} empty="没有冻结确认条件，只能观察。" /></article>
    </section>
    <section data-tone="risk" className="trading-drilldown__veto"><h3>出现任一就放弃</h3><StringList values={selected.vetoConditions} empty="没有冻结否决条件，不得自行补成可参与。" /></section>
    <aside className="trading-drilldown__boundary">{details.candidates?.boundary}</aside>
  </div>
}

function ReviewDetail({ details }: { details: TradingWorkbenchDrilldowns }) {
  const review = details.review
  return <div className="trading-drilldown__content">
    <section className="trading-drilldown__lead"><div><span>回放状态</span><strong>{statusLabel(review?.status)}</strong></div><p>{review?.boundary}</p></section>
    <section>
      <div className="trading-drilldown__section-title"><h3>判断链路</h3><small>每一步都绑定当时时点</small></div>
      <ol className="trading-drilldown__decision-chain">
        {review?.steps?.map((step) => <li key={step.id}>
          <span><DetailState value={step.status} /><time>{formatTime(step.occurredAt)}</time></span>
          <strong>{step.label}</strong><p>{step.summary}</p>
        </li>)}
      </ol>
    </section>
    <section>
      <div className="trading-drilldown__section-title"><h3>从上一步到现在</h3><small>只记录权限与事实变化</small></div>
      {review?.changes?.map((item) => <article className="trading-drilldown__change" key={item.id}><strong>{item.label}</strong><p>{item.summary}</p></article>)}
    </section>
  </div>
}

function EvidenceDetail({ details }: { details: TradingWorkbenchDrilldowns }) {
  const evidence = details.evidence
  return <div className="trading-drilldown__content">
    <section className="trading-drilldown__lead">
      <div><span>事实覆盖</span><strong>{evidence?.coverage?.observed ?? 0} / {evidence?.coverage?.total ?? 0}</strong></div>
      <p>已完整观察 {evidence?.coverage?.observed ?? 0} 维；部分或缺失 {evidence?.coverage?.partialOrMissing ?? 0} 维。</p>
    </section>
    <section>
      <div className="trading-drilldown__section-title"><h3>来源分工</h3><small>按数据源和工具分组</small></div>
      <div className="trading-drilldown__source-list">
        {evidence?.sourceGroups?.map((item) => <article key={`${item.sourceId}:${item.toolName}`}>
          <header><strong>{item.sourceId}</strong><DetailState value={item.failureCount ? 'PARTIAL' : 'READY'} /></header>
          <p>{item.toolName}</p><small>{item.requestCount ?? 0} 次请求 · {item.failureCount ?? 0} 次失败 · 最近 {formatTime(item.latestAvailableTime)}</small>
        </article>)}
      </div>
    </section>
    {evidence?.sourceFailures?.length ? <section data-tone="risk" className="trading-drilldown__veto">
      <h3>当前失败源</h3>
      <ul className="trading-drilldown__plain-list">{evidence.sourceFailures.map((item) => <li key={item.refId}><strong>{item.refId}</strong>：{item.error}</li>)}</ul>
    </section> : null}
    <section>
      <div className="trading-drilldown__section-title"><h3>权限收紧原因</h3><small>原始 reasonCodes</small></div>
      <StringList values={evidence?.reasonCodes} empty="当前没有额外顶层原因码。" />
    </section>
    <section>
      <div className="trading-drilldown__section-title"><h3>不可变证据</h3><small>{evidence?.evidenceRefs?.length ?? 0} 项</small></div>
      {evidence?.evidenceRefs?.map((item) => <article className="trading-drilldown__evidence" key={item.id}><strong>{item.label}</strong><span>{item.informationNature}</span><code>{item.sha256}</code></article>)}
    </section>
    <aside className="trading-drilldown__boundary">{evidence?.methodBoundary}</aside>
  </div>
}

export function TradingDrilldownDock({ boardId }: { boardId?: string | undefined }) {
  const kind = drilldownKind(boardId)
  const viewState = useTradingWorkbenchViewState()
  if (!kind || !boardId) return null
  if (!viewState || viewState.kind === 'connecting') {
    return <aside className="trading-drilldown" aria-label="交易详情"><div className="trading-drilldown__loading">正在读取 06 统一快照…</div></aside>
  }
  const snapshot = viewState.snapshot
  const details = snapshot.drilldowns
  const linkedSnapshot = new URLSearchParams(window.location.search).get('snapshot')
  const snapshotMismatch = Boolean(linkedSnapshot && snapshot.sourceHash && linkedSnapshot !== snapshot.sourceHash)
  return <aside className="trading-drilldown" aria-label="交易详情" data-kind={kind}>
    <header className="trading-drilldown__header">
      <div><span>06 同快照详情</span><h2>{kind === 'sentiment' ? '市场情绪' : kind === 'flows' ? '主线与资金' : kind === 'candidate' ? '个股理由与同类' : kind === 'review' ? '预案验证与回放' : '数据质量与证据'}</h2></div>
      <DetailState value={details?.meta?.factUsability ?? snapshot.status} />
    </header>
    <dl className="trading-drilldown__meta">
      <div><dt>交易日 / 阶段</dt><dd>{details?.meta?.tradeDate ?? snapshot.tradeDate ?? '—'} · {details?.meta?.phase ?? '—'}</dd></div>
      <div><dt>数据时点</dt><dd>{formatTime(details?.meta?.dataAsOf ?? snapshot.sourceGeneratedAt)}</dd></div>
      <div><dt>有效截止</dt><dd>{formatTime(details?.meta?.validUntil ?? snapshot.freshUntil)}</dd></div>
      <div><dt>权限上限</dt><dd>{permissionLabel(details?.meta?.actionCeiling)}</dd></div>
      <div className="trading-drilldown__snapshot"><dt>snapshotId</dt><dd>{snapshot.sourceHash ?? snapshot.revision ?? '未提供'}</dd></div>
    </dl>
    <div className="trading-drilldown__permission" data-participate={details?.meta?.canParticipate ? 'true' : 'false'}>
      <strong>{details?.meta?.canParticipate ? '可提交人工复核' : '当前不能参与'}</strong>
      <span>{details?.meta?.permissionSummary ?? snapshot.todayOverview?.participationSummary}</span>
    </div>
    {snapshotMismatch ? <div className="trading-drilldown__snapshot-warning" role="alert">链接来自旧快照；下方已切换为当前快照，不继承旧权限。</div> : null}
    {!details ? <div className="trading-drilldown__loading">当前 06 快照尚未包含详情索引，等待服务更新。</div>
      : kind === 'sentiment' ? <SentimentDetail details={details} />
      : kind === 'flows' ? <FundsDetail details={details} />
      : kind === 'candidate' ? <CandidateDetail details={details} snapshot={snapshot} />
      : kind === 'review' ? <ReviewDetail details={details} />
      : <EvidenceDetail details={details} />}
  </aside>
}
