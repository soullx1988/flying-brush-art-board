import { productPlacement } from './commerce-catalog'
import { createContext, useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { GeoShapeUtil, Group2d, HTMLContainer, Rectangle2d, useValue, type Editor, type TLGeoShape, type TLShapeId, type TLStore } from 'tldraw'
import { Button, Drawer, Tag, toast } from '@ttqtt/liquid-glass-react'
import { arrangePayRhythm, datasetFromSnapshot, designKindNames, designPayments, linkedProducts, readDesignCard, updateDesignCard } from './commerce-design-map'
import type { CommerceDataset, CommerceProduct } from './commerce-data'
import { GameItemIcon, GamePlacement } from './CommerceEvidenceView'
import { ProductLedger } from './CommerceLedgerView'
import { ProductFacts } from './CommerceFactsView'
import { TestProductResults } from './CommerceRevenueView'
import { yuan } from './commerce-revenue'
import { CommerceOverviewProvider, CommerceEntranceShape, OverviewOtherEntries } from './CommerceOverviewCanvas'
import { arrangeOverview, ensureCommerceOverview, overviewPageId, readEntranceCard, showCommerceOverview } from './commerce-overview-model'
import { CommerceDesignEditor } from './CommerceDesignEditor'
import { CommerceProductGraphShape, CommerceProductGraphToolbar } from './CommerceProductGraph'
import { readProductGraphNode, readProductGraphPage } from './commerce-product-graph'
import './commerce-design-canvas.css'
import { readItemValueNode, readItemValueGroup } from './item-value-map'
import { readPriceNode } from './item-price-chain'
import { ItemValueShape, ItemValueGroupShape, ItemPriceChainShape } from './ItemValueCanvas'

export type CommerceSourceLoader = (id: string) => Promise<{ snapshot: unknown; revision: number }>
type CanvasContext = { data: CommerceDataset | undefined; error: string; open(id: TLShapeId): void }
const Context = createContext<CanvasContext>({ data: undefined, error: '', open: () => undefined })

export function CommerceDesignCanvas({ sourceBoardId, loadSource, store, editorRef, canEdit, onOpenSource, children }: {
  sourceBoardId?: string | undefined; loadSource?: CommerceSourceLoader | undefined; store: TLStore;
  editorRef: RefObject<Editor | undefined>; canEdit(): boolean; onOpenSource?: ((id: string) => void) | undefined; children: ReactNode
}) {
  const [data, setData] = useState<CommerceDataset>(), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [selectedId, setSelectedId] = useState<TLShapeId>(), refreshRef = useRef<(notify?: boolean) => Promise<void>>(async () => undefined)
  const selected = useValue('selected design card', () => selectedId ? store.get(selectedId) as TLGeoShape | undefined : undefined, [store, selectedId])
  const card = selected && readDesignCard(selected)
  useEffect(() => {
    let alive = true, pending = false
    setData(undefined); setError(''); setSelectedId(undefined)
    const refresh = async (notify = false) => {
      if (!sourceBoardId || !loadSource || pending || !alive) return
      pending = true; setBusy(true)
      try {
        const response = await loadSource(sourceBoardId), next = datasetFromSnapshot(response.snapshot)
        if (!next) throw new Error('商品总览中没有有效数据')
        if (alive) { setData(next); setError(''); if(notify)toast.success('商品与历史引用已刷新，保留当前布局') }
      } catch (e) { if (alive) {setError(e instanceof Error ? e.message : '来源读取失败');if(notify)toast.error('引用未更新，继续显示上次读取值')} }
      finally { pending = false; if (alive) setBusy(false) }
    }
    refreshRef.current = refresh
    void refresh()
    const focus = () => { if (document.visibilityState === 'visible') void refresh() }
    const timer = sourceBoardId ? setInterval(focus, 30_000) : undefined
    window.addEventListener('focus', focus); document.addEventListener('visibilitychange', focus)
    return () => { alive = false; clearInterval(timer); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus) }
  }, [sourceBoardId, loadSource, store])
  const hasOverview = useValue('overview exists', () => !!sourceBoardId && !!store.get(overviewPageId), [store, sourceBoardId])
  const overviewActive = useValue('overview active', () => !!sourceBoardId && store.query.records('instance').get()[0]?.currentPageId === overviewPageId, [store, sourceBoardId])
  const graphActive = useValue('product graph active',()=>{const id=sourceBoardId&&store.query.records('instance').get()[0]?.currentPageId;return !!(id&&readProductGraphPage(store.get(id)))},[store,sourceBoardId])
  const products = card && data ? linkedProducts(data, card) : []
  const design = useValue('linked design goal', () => card ? readDesignCard(store.get(card.designId as TLShapeId) as TLGeoShape ?? { meta: {} }) : undefined, [store, card?.designId])
  return <Context.Provider value={{ data, error, open: setSelectedId }}><CommerceOverviewProvider data={data} error={error} store={store} editor={() => editorRef.current} canEdit={canEdit} onOpenSource={onOpenSource}>
    {sourceBoardId && !graphActive ? <div className="design-map-toolbar" role="region" aria-label="设计画板工具">
      <span>拖动分组 · 展开链路</span>
      <Button size="sm" variant="ghost" onClick={() => { const ed = editorRef.current; if (!ed) return; if (hasOverview) showCommerceOverview(ed, canEdit()); else if(canEdit()) ensureCommerceOverview(ed) }}>{hasOverview ? '商业总览' : '建立六类总览'}</Button>
      {!overviewActive && !graphActive ? <Button size="sm" variant="ghost" onClick={() => editorRef.current?.zoomToFit({ animation: { duration: 200 } })}>全览</Button> : null}
      {!graphActive ? <Button size="sm" variant="ghost" onClick={() => { if (editorRef.current && canEdit()) overviewActive ? arrangeOverview(editorRef.current) : arrangePayRhythm(editorRef.current) }}>整理布局</Button> : null}
      <Button size="sm" variant="ghost" disabled={busy} onClick={async () => { await refreshRef.current(true); }}> {busy ? '读取中…' : '刷新引用'}</Button>
      {onOpenSource ? <Button size="sm" variant="ghost" onClick={() => onOpenSource(sourceBoardId)}>商品总览 ↗</Button> : null}
      {overviewActive ? <OverviewOtherEntries /> : null}
      <span role="status" className={error ? 'design-map-error' : 'design-map-source'}>{error ? `引用未更新：${error}` : data ? `引用已更新 · 配置 ${data.created}` : '正在读取商品总览'}</span>
    </div> : null}
    {graphActive ? <CommerceProductGraphToolbar onRefresh={()=>refreshRef.current(true)} busy={busy}/> : null}
    {children}
    <Drawer open={Boolean(card)} onOpenChange={open => { if (!open) setSelectedId(undefined) }} placement="right" size={560} title={card ? `${designKindNames[card.kind]} · ${card.theme === 'first' ? '首充' : '月卡'}` : ''}>
      {card && selected ? <div className="design-map-details">
        {card.kind === 'design' ? <CommerceDesignEditor key={selected.id} value={card} onSave={(change, expected) => {
          const editor = editorRef.current, latest = editor?.getShape<TLGeoShape>(selected.id)
          if (!editor || !latest || !canEdit()) { toast.error('当前画板不可编辑'); return }
          if (JSON.stringify(readDesignCard(latest)) !== JSON.stringify(expected)) { toast.error('设计已被更新，请重新展开后编辑'); return }
          editor.markHistoryStoppingPoint('edit-design-goal'); editor.updateShapes([updateDesignCard(latest, change)])
          toast.success('设计已保存'); setSelectedId(undefined)
        }} /> : !data ? <p>{error || '正在读取商品数据…'}</p> : <>
          {error ? <Tag color="warning">显示上次读取的数据；来源暂不可用</Tag> : null}
          {card.kind === 'validation' ? <div className="design-map-question"><Tag color="warning">效果待验证</Tag><h3>{design?.title ?? '关联设计已移除'}</h3><p>{design?.measure || '验证目标待补'}</p><p>{card.theme === 'first' ? '缺曝光、分日领奖、奖励使用及购后推进记录。' : '缺逐日领取、资源使用及购后持续游玩记录。'}</p></div> : null}
          {products.length !== card.productKeys.length ? <Tag color="warning">部分商品引用已失效，请核对来源</Tag> : null}
          {products.map(product => <section key={product.key} className="design-map-product-detail"><h3>{product.title} <span>{product.price}</span></h3>
            {card.kind === 'implementation' ? <><small>{data.created} 配置 · {productPlacement(product)} · {product.sku}</small><RewardList data={data} product={product} /><p>{product.limit}</p><p>{product.note}</p><GamePlacement evidence={data.evidence} product={product} />{product.board && onOpenSource ? <Button variant="ghost" size="sm" onClick={() => onOpenSource(product.board!.id)}>原设计资料 ↗</Button> : null}</> : <><ProductLedger data={data} product={product} group="all" /><details><summary>全期商品统计（含代金券订单）</summary><TestProductResults data={data} product={product} group="all" /></details></>}
          </section>)}
        </>}
      </div> : null}
    </Drawer>
  </CommerceOverviewProvider></Context.Provider>
}

function RewardList({ data, product }: { data: CommerceDataset; product: CommerceProduct }) {
  return <><p className="design-map-small">{product.channel === '首充' ? '分日奖励合计' : '每日领取'}</p><ProductFacts data={data} product={product} group="all" />{product.extraRewards?.length ? <p>购买即时：{product.extraRewards.map(r => `${r.name} × ${r.n}`).join('、')}</p> : null}</>
}

export function CommerceDesignCard({ shape }: { shape: TLGeoShape }) {
  const { data, error, open } = useContext(Context), card = readDesignCard(shape)!
  const products = data ? linkedProducts(data, card) : [], totals = data ? designPayments(data, card) : undefined
  const scope = data?.evidence?.ledger?.orderScope
  return <HTMLContainer><article className={`design-map-card design-map-card--${card.kind}`} aria-label={`${card.theme === 'first' ? '首充' : '月卡'}${designKindNames[card.kind]}卡片`} style={{ width: shape.props.w, height: shape.props.h }}>
    <header><span className="design-map-kind">{designKindNames[card.kind]}</span><span className="design-map-state">{card.kind === 'design' ? card.decision === 'confirmed' ? '已确认' : '待确认' : card.kind === 'implementation' ? '引用商品' : '效果待验证'}</span></header>
    {card.kind === 'design' ? <><h3>{card.title}</h3><p className="design-map-goal">{card.goal}</p><p className="design-map-small">{card.measure}</p></> : !data ? <p>{error ? '来源读取失败' : '正在读取引用…'}</p> : card.kind === 'implementation' ? <div className="design-map-items">{products.map(p => <div key={p.key} className="design-map-item"><div><strong>{p.title.replace('首充 · ', '')}</strong><b>{p.price}</b></div><p>{p.rewards.slice(0,p.channel === '首充' ? 3 : 2).map(r => <span key={r.id}><GameItemIcon evidence={data.evidence} id={r.id} name={r.name} />{r.name} × {r.n}</span>)}</p><small>{p.channel === '首充' ? `共 ${p.rewards.length} 项 · 分日领取` : '每日领取 · 即时奖励见展开'}</small></div>)}</div> : <><h3>{totals ? yuan(totals.cash) : '—'}</h3><p>现金订单金额{totals ? ` · ${totals.orders} 笔` : ' · 尚无关联记录'}</p><p className="design-map-small">代金券订单 {totals ? `${yuan(totals.voucher)} · ${totals.voucherOrders} 笔` : '—'}</p><p className="design-map-scope">{scope ? `${scope.from.slice(5)}—${scope.through.slice(5)} · ${scope.servers.length} 服 · 已知角色` : '统计范围待补'}</p><p className="design-map-gap">{card.theme === 'first' ? '缺购后补强与推进记录' : '缺领取与持续游玩记录'}</p></>}
    {error && data && card.kind !== 'design' ? <small className="design-map-error">来源暂不可用 · 上次读取值</small> : null}
    {data && card.kind !== 'design' && products.length !== card.productKeys.length ? <small className="design-map-error">商品引用缺失</small> : null}
    <footer><Button variant="ghost" size="sm" aria-label={`展开${card.theme === 'first' ? '首充' : '月卡'}${designKindNames[card.kind]}`} onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); open(shape.id) }}>展开 ↗</Button></footer>
  </article></HTMLContainer>
}

/** Native geo shapes retain drag, resize, arrow bindings, history and collaboration. */
export class CommerceGeoShapeUtil extends GeoShapeUtil {
  override component(shape: TLGeoShape) { return readPriceNode(shape) ? <ItemPriceChainShape shape={shape} /> : readItemValueGroup(shape) ? <ItemValueGroupShape shape={shape} /> : readItemValueNode(shape) ? <ItemValueShape shape={shape} /> : readProductGraphNode(shape) ? <CommerceProductGraphShape shape={shape}/> : readEntranceCard(shape) ? <CommerceEntranceShape shape={shape} /> : readDesignCard(shape) ? <CommerceDesignCard shape={shape} /> : super.component(shape) }
  override canEdit(shape: TLGeoShape) { return readPriceNode(shape) || readItemValueGroup(shape) || readItemValueNode(shape) || readDesignCard(shape) || readEntranceCard(shape) || readProductGraphNode(shape) ? false : super.canEdit(shape) }
  override getGeometry(shape: TLGeoShape) { return readPriceNode(shape) || readItemValueGroup(shape) || readItemValueNode(shape) || readDesignCard(shape) || readEntranceCard(shape) || readProductGraphNode(shape) ? new Group2d({ children: [new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })] }) : super.getGeometry(shape) }
  override onDoubleClick(shape: TLGeoShape) { return readPriceNode(shape) || readItemValueGroup(shape) || readItemValueNode(shape) || readDesignCard(shape) || readEntranceCard(shape) || readProductGraphNode(shape) ? { ...shape } : super.onDoubleClick(shape) }
}
