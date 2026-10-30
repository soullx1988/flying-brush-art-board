import { createContext, useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Box, HTMLContainer, useEditor, useValue, type Editor, type TLGeoShape, type TLShapeId, type TLStore } from 'tldraw'
import { Button, Drawer, Select, Tag, toast } from '@ttqtt/liquid-glass-react'
import { GameItemIcon } from './CommerceEvidenceView'
import { datasetFromSnapshot } from './commerce-design-map'
import type { CommerceSourceLoader } from './CommerceDesignCanvas'
import type { CommerceDataset } from './commerce-data'
import { currentPricePage, focusPriceChain, growPriceCard, openPriceChain, pricePageSize, priceLink, priceProducts, readPriceNode, readPriceSelection, selectedQuantity, type PriceSelection } from './item-price-chain'
import { productHistorySummary } from './commerce-product-graph'
import { ProductFacts } from './CommerceFactsView'
import { TestProductResults } from './CommerceRevenueView'
import { focusValueItem, itemPriceLabel, itemProducts, itemValueDatasetSchema, itemValueGroups, readItemValueMap, readItemValueNode, readItemValueGroup, toggleItemValueGroup, updateItemValueData, valuePages, type ItemValueDataset } from './item-value-map'
import './item-value-map.css'

const Context = createContext<{ map?: ItemValueDataset | undefined; catalog?: CommerceDataset | undefined; open(id: number): void; chain(id: number): void; product(key: string): void; grow(id: TLShapeId, height: number): void; toggle(id: TLShapeId): void }>({ open: () => undefined, chain: () => undefined, product: () => undefined, grow: () => undefined, toggle: () => undefined })

export function ItemValueCanvas({ store, editorRef, loadSource, canEdit, onOpenSource, children }: {
  store: TLStore; editorRef: RefObject<Editor | undefined>; loadSource?: CommerceSourceLoader | undefined;
  canEdit(): boolean; onOpenSource?: ((id: string) => void) | undefined; children: ReactNode
}) {
  const map = useValue('item value overview', () => readItemValueMap(store.query.records('document').get()[0]?.meta), [store])
  const [catalog, setCatalog] = useState<CommerceDataset>(), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [selectedId, setSelectedId] = useState<number>(), file = useRef<HTMLInputElement>(null)
  const [productKey, setProductKey] = useState<string>()
  const selectedProduct = catalog?.products.find(p => p.key === productKey)
  const priceSelection = useValue('active item price chain', () => { const id = store.query.records('instance').get()[0]?.currentPageId; return id ? readPriceSelection(store.get(id)) : undefined }, [store])
  const showChain = (selection: PriceSelection) => {
    const ed = editorRef.current
    if (!ed || !catalog || !canEdit()) { toast.error('商品引用尚未就绪或当前不可编辑'); return }
    try { openPriceChain(ed, catalog, selection); focusPriceChain(ed); setSelectedId(undefined) } catch (e) { toast.error(e instanceof Error ? e.message : '关联图打开失败') }
  }
  const chain = (itemId: number) => showChain({ itemId, kind: 'paid', channel: 'all', offset: 0, compact: priceSelection?.compact ?? (editorRef.current?.getViewportScreenBounds().h ?? 1000) < 600 })
  useEffect(() => {
    const ed = editorRef.current, page = currentPricePage(store), s = readPriceSelection(page)
    if (ed && catalog && s && ed.getCurrentPageId() === page?.id && canEdit()) openPriceChain(ed, catalog, s)
  }, [catalog, store, editorRef])
  const refresh = useRef<(notify?: boolean) => Promise<void>>(async () => undefined)
  const selected = map?.items.find(i => i.id === selectedId)
  const review = map?.reviewGroups?.find(g => g.itemIds.includes(selectedId ?? -1))
  useEffect(() => {
    let alive = true, pending = false
    setCatalog(undefined); setError(''); setSelectedId(undefined)
    const load = async (notify = false) => {
      if (!map || !loadSource || pending || !alive) return
      pending = true; setBusy(true)
      try {
        const result = await loadSource(map.sourceBoardId), next = datasetFromSnapshot(result.snapshot)
        if (!next) throw new Error('关联商品总览没有有效资料')
        if (alive) { setCatalog(next); setError(''); if (notify) toast.success('图标与商品引用已刷新') }
      } catch (e) { if (alive) { setError(e instanceof Error ? e.message : '商品引用读取失败'); if (notify) toast.error('引用未更新，保留上次读取值') } }
      finally { pending = false; if (alive) setBusy(false) }
    }
    refresh.current = load; void load()
    const onFocus = () => { if (document.visibilityState === 'visible') void load() }
    window.addEventListener('focus', onFocus)
    return () => { alive = false; window.removeEventListener('focus', onFocus) }
  }, [map?.sourceBoardId, loadSource, store])
  const navigate = (kind: 'value' | 'pending') => {
    const ed = editorRef.current; if (!ed) return
    const page = valuePages(store)[kind]
    if (!page) { toast.error('总览页面缺失'); return }
    ed.setCurrentPage(page); ed.selectNone()
    if (kind === 'pending') ed.zoomToBounds(map?.reviewGroups?.length ? new Box(-40, -150, 1700, 900) : new Box(-40, -150, 1160, 720), { targetZoom: 1, animation: { duration: 200 } })
    else ed.zoomToFit({ animation: { duration: 200 } })
  }
  return <Context.Provider value={{ map, catalog, open: setSelectedId, chain, product: setProductKey, grow: (id, height) => { const ed = editorRef.current; if (ed && canEdit()) growPriceCard(ed, id, height) }, toggle: id => {
    const ed = editorRef.current; if (!ed || !canEdit()) return
    toggleItemValueGroup(ed, id); ed.selectNone()
    const group = readItemValueGroup(ed.getShape(id))
    if (group?.expanded) {
      const shapes = ed.store.query.records('shape').get().filter(s => s.id === id || s.meta.itemValueGroupId === id)
      const bounds = shapes.flatMap(s => ed.getShapePageBounds(s.id) ?? [])
      if (bounds.length) { const x = Math.min(...bounds.map(b => b.x)), y = Math.min(...bounds.map(b => b.y)); ed.zoomToBounds(new Box(x - 40, y - 40, Math.max(...bounds.map(b => b.maxX)) - x + 80, Math.max(...bounds.map(b => b.maxY)) - y + 80), { targetZoom: 1, animation: { duration: 200 } }) }
    }
  } }}>
    {map ? <div className="item-value-toolbar" role="region" aria-label="道具价值投放导航">
      <strong>道具价值投放总览</strong>
      <Button size="sm" variant="ghost" onClick={() => navigate('value')}>二维总览</Button>
      <Button size="sm" variant={priceSelection ? 'glass' : 'ghost'} disabled={!catalog} onClick={() => { const saved = readPriceSelection(currentPricePage(store)); saved ? showChain(saved) : chain(map.items.some(i => i.id === 300004) ? 300004 : map.items[0]!.id) }}>道具 → 商品售价</Button>
      <Button size="sm" variant="ghost" onClick={() => navigate('pending')}>定价待处理 · {map.items.filter(i => i.basePrice === null).length}</Button>
      {!priceSelection ? <><Select aria-label="定位同类" placeholder="定位同类" value="" options={itemValueGroups(map).map(g => ({ value: g.key, label: `${g.label} · ${g.items.length}项 · ${itemPriceLabel(map, g.items[0]!)}` }))} onChange={key => { const ed = editorRef.current; if (!ed) return; const shape = ed.store.query.records('shape').get().find(s => readItemValueGroup(s)?.key === key); if (!shape) return; ed.setCurrentPage(shape.parentId as import('tldraw').TLPageId); ed.selectNone(); const b = ed.getShapePageBounds(shape.id); if (b) ed.zoomToBounds(new Box(b.x - 160, b.y - 120, b.w + 320, b.h + 240), { targetZoom: 1, animation: { duration: 200 } }) }} />
      <Select aria-label="定位道具" placeholder="定位道具" value="" options={map.items.map(i => ({ value: String(i.id), label: `${i.name} · ${i.id}` }))} onChange={id => { const ed = editorRef.current; if (ed && !focusValueItem(ed, Number(id))) toast.error('道具图标已被移除，请整理坐标恢复') }} /></> : null}
      {!priceSelection ? <Button size="sm" variant="ghost" onClick={() => { const ed = editorRef.current; if (ed && canEdit()) { updateItemValueData(store, map, ed); ed.zoomToFit(); toast.success('已按基础价与投放条件整理坐标') } }}>整理坐标</Button> : null}
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void refresh.current(true)}>{busy ? '读取中…' : '刷新商品引用'}</Button>
      <Button size="sm" variant="ghost" onClick={() => file.current?.click()}>更新数值资料</Button>
      <input ref={file} hidden type="file" accept=".json" aria-label="导入道具价值资料" onChange={async e => {
        const chosen = e.currentTarget.files?.[0]; e.currentTarget.value = ''
        if (!chosen) return
        try {
          if (chosen.size > 5_000_000) throw new Error('资料文件超过 5 MB')
          const ed = editorRef.current; if (!ed || !canEdit()) throw new Error('当前画板不可编辑')
          const next = itemValueDatasetSchema.parse(JSON.parse(await chosen.text()))
          updateItemValueData(store, next, ed); toast.success('基础价与投放资料已更新；商品总览保持原样')
        } catch (e) { toast.error(e instanceof Error ? e.message : '资料格式不正确') }
      }} />
      <small role="status">{error || `${map.items.filter(i => i.basePrice !== null).length} 项已入图 · ${map.items.length} 项收录 · ${map.updated}`}</small>
    </div> : null}
    {priceSelection && map && catalog ? (() => {
      const all = priceProducts(catalog, { ...priceSelection, channel: 'all' }), products = priceProducts(catalog, priceSelection), pageSize = pricePageSize(priceSelection)
      return <div className="item-price-toolbar" role="region" aria-label="商品售价关联筛选">
        <div className="item-price-select"><Select aria-label="关联道具" value={String(priceSelection.itemId)} options={map.items.map(i => ({ value: String(i.id), label: i.name }))} onChange={id => chain(Number(id))} /></div>
        <div className="item-price-select"><Select aria-label="售价支付方式" value={priceSelection.kind} options={[{ value: 'paid', label: '钻石 + 人民币' }, { value: 'diamond', label: '钻石购买' }, { value: 'cash', label: '人民币购买' }, { value: 'other', label: '免费 / 广告 / 资源' }]} onChange={kind => showChain({ ...priceSelection, kind: kind as PriceSelection['kind'], channel: 'all', offset: 0 })} /></div>
        <div className="item-price-select"><Select aria-label="商品投放入口" value={priceSelection.channel} options={[{ value: 'all', label: '全部投放入口' }, ...[...new Set(all.map(p => p.channel))].map(value => ({ value, label: value }))]} onChange={channel => showChain({ ...priceSelection, channel, offset: 0 })} /></div>
        <Button size="sm" variant="ghost" disabled={priceSelection.offset === 0} onClick={() => showChain({ ...priceSelection, offset: priceSelection.offset - pageSize })}>上一组</Button>
        <span role="status">{products.length ? `${priceSelection.offset + 1}—${Math.min(products.length, priceSelection.offset + pageSize)} / ${products.length} 项` : '暂无匹配商品，可切换支付方式或入口'}</span>
        <Button size="sm" variant="ghost" disabled={priceSelection.offset + pageSize >= products.length} onClick={() => showChain({ ...priceSelection, offset: priceSelection.offset + pageSize })}>下一组</Button>
        <Button size="sm" variant="ghost" onClick={() => showChain({ ...priceSelection, compact: !priceSelection.compact })}>{priceSelection.compact ? '两条比较' : '单条放大'}</Button>
        <Button size="sm" variant="ghost" onClick={() => { if (editorRef.current && canEdit()) openPriceChain(editorRef.current, catalog, priceSelection, true) }}>整理关联图</Button>
      </div>
    })() : null}
    {children}
    <div onPointerDown={e => e.stopPropagation()} onPointerUp={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
      <Drawer open={Boolean(selected)} onOpenChange={open => { if (!open) setSelectedId(undefined) }} placement="right" size={520} title={selected?.name ?? '道具'}>
        {selected && map ? <div className="item-value-detail">
          <div className="item-value-detail-heading"><GameItemIcon evidence={catalog?.evidence} id={selected.id} name={selected.name} /><div><strong>{itemPriceLabel(map, selected)}</strong><small>{selected.category} · {selected.id} · 每 1 单位</small></div></div>
          {error ? <Tag color="warning">{error}</Tag> : null}
          <p>{selected.description || '用途待补'}</p>
          <section><h3>基础定价</h3>
            <p>{selected.priceNote}</p><details><summary>查看定价来源</summary><p>{selected.priceSource || '现用定价页尚未匹配到对应条目'}</p></details>
          </section>
          {review ? <section><h3>{review.kind === 'price' ? '待你定价' : '待核对名称'}</h3><p>{review.context}</p><p>{review.question}</p><details><summary>核对依据</summary>{review.sources.map(s => <p key={s}>{s}</p>)}</details></section> : null}
          <section><h3>已核到的投放来源</h3><p>{selected.firstPlacement}</p><p>{selected.placementNote}</p><details><summary>投放依据</summary>{selected.placementSources.map((s, n) => <p key={n}>{s}</p>)}</details></section>
          <section><h3>关联商品 · {itemProducts(catalog, selected.id).length}</h3><Button variant="glass" disabled={!catalog} onClick={() => chain(selected.id)}>展开商品售价关联图 →</Button><small>在画布上比较奖励数量、钻石售价和人民币档位。</small>{onOpenSource ? <Button variant="ghost" onClick={() => onOpenSource(map.sourceBoardId)}>商品总览 · 折扣与完整历史 ↗</Button> : null}</section>
          <details><summary>来源与范围</summary><p>{map.scope}</p>{map.sources.map(s => <p key={s.path}>{s.label}<br />{s.path}<br /><small>SHA-256：{s.sha256}</small></p>)}</details>
        </div> : null}
      </Drawer>
      <Drawer open={Boolean(selectedProduct)} onOpenChange={open => { if (!open) setProductKey(undefined) }} placement="right" size={580} title={selectedProduct?.title ?? '商品'}>
        {selectedProduct && catalog ? <div className="item-value-detail"><strong>{selectedProduct.price} · {selectedProduct.channel} · {selectedProduct.sku}</strong><ProductFacts data={catalog} product={selectedProduct} />{selectedProduct.extraRewards?.length ? <section><h3>{selectedProduct.channel === '月卡' ? '购买即时奖励' : '额外奖励 · 配置快照'}</h3>{selectedProduct.extraRewards.map(r => <div className="commerce-reward" key={r.id}><GameItemIcon evidence={catalog.evidence} id={r.id} name={r.name} /><span>{r.name} × {r.n}</span></div>)}</section> : null}<p>{selectedProduct.limit}</p><p>{selectedProduct.note}</p><TestProductResults data={catalog} product={selectedProduct} group="all" />{onOpenSource && map ? <Button onClick={() => onOpenSource(map.sourceBoardId)}>商品总览 · 折扣与完整历史 ↗</Button> : null}<details><summary>配置价格来源</summary><p>{catalog.sources[selectedProduct.source]?.path} · {selectedProduct.row ? `第 ${selectedProduct.row} 行` : `商品 ${selectedProduct.sku}`}</p><p>{catalog.created} 配置快照；各服当前生效仍以发布记录为准。</p></details></div> : null}
      </Drawer>
    </div>
  </Context.Provider>
}

export function ItemValueShape({ shape }: { shape: TLGeoShape }) {
  const { map, catalog, chain } = useContext(Context), node = readItemValueNode(shape)!
  const item = map?.items.find(i => i.id === node.itemId)
  return <HTMLContainer><article className="item-value-node" style={{ width: shape.props.w, height: shape.props.h }} aria-label={`道具 ${item?.name ?? node.itemId}`}>
    <div className="item-value-node-main">{catalog?.evidence?.icons?.[node.itemId] ? <GameItemIcon evidence={catalog.evidence} id={node.itemId} name={item?.name ?? String(node.itemId)} /> : <small className="item-value-icon-pending">图标<br />待补</small>}<span>{item?.name ?? `道具 ${node.itemId}`}</span></div>
    <div className="item-value-node-foot"><strong>{map && item ? itemPriceLabel(map, item) : '读取中…'}</strong><Button variant="ghost" size="sm" aria-label={`查看${item?.name ?? node.itemId}的商品售价`} onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); chain(node.itemId) }}>售价 →</Button></div>
  </article></HTMLContainer>
}

export function ItemValueGroupShape({ shape }: { shape: TLGeoShape }) {
  const ed = useEditor()
  const { map, catalog, toggle } = useContext(Context), group = readItemValueGroup(shape)!
  useEffect(() => ed.sideEffects.registerAfterChangeHandler('shape', (before, after) => {
    if (after.id !== shape.id || !ed.isIn('select.translating') || !readItemValueGroup(after)?.expanded || (before.x === after.x && before.y === after.y)) return
    const selectedIds = new Set(ed.getSelectedShapeIds())
    ed.updateShapes(ed.store.query.records('shape').get().filter(s => s.meta.itemValueGroupId === after.id && !selectedIds.has(s.id)).map(s => ({ id: s.id, type: s.type, x: s.x + after.x - before.x, y: s.y + after.y - before.y })))
  }), [ed, shape.id])
  const items = group.itemIds.flatMap(id => map?.items.find(i => i.id === id) ?? [])
  return <HTMLContainer><article className="item-value-node item-value-group" style={{ width: shape.props.w, height: shape.props.h }} aria-label={`同类 ${group.label}`}>
    <header><strong>{group.label}</strong></header>
    <div className="item-value-group-icons">{items.slice(0, 3).map(i => <span key={i.id} title={i.name}>{catalog?.evidence?.icons?.[i.id] ? <GameItemIcon evidence={catalog.evidence} id={i.id} name={i.name} /> : <small className="item-value-icon-pending">图标待补</small>}</span>)}{items.length > 3 ? <span aria-label={`另外 ${items.length - 3} 项`}>…</span> : null}<small>{items.length}项</small></div>
    <div className="item-value-node-foot"><strong>{map && items[0] ? `${itemPriceLabel(map, items[0])}/个` : '读取中…'}</strong><Button variant="ghost" size="sm" aria-label={`${group.expanded ? '收起' : '展开'}${group.label}（${items.length}项）`} aria-expanded={group.expanded} onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); toggle(shape.id) }}>{group.expanded ? '收起' : '展开'}</Button></div>
  </article></HTMLContainer>
}

const amountLabel = (n: number) => n.toLocaleString('zh-CN', { maximumFractionDigits: 4 })
export function ItemPriceChainShape({ shape }: { shape: TLGeoShape }) {
  const { map, catalog, open, grow, product: openProduct } = useContext(Context), node = readPriceNode(shape)!
  const element = useRef<HTMLElement>(null)
  useEffect(() => {
    const el = element.current; if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => grow(shape.id, el.scrollHeight))
    observer.observe(el); return () => observer.disconnect()
  }, [shape.id, grow])
  const item = map?.items.find(i => i.id === node.itemId), product = catalog?.products.find(p => p.key === node.productKey)
  const link = catalog && product ? priceLink(catalog, product) : undefined
  const quantity = catalog && product ? selectedQuantity(catalog, product, node.itemId) : undefined
  const history = catalog && product ? productHistorySummary(catalog, product) : undefined
  return <HTMLContainer><article ref={element} className={`item-price-card item-price-${node.kind}`} style={{ width: shape.props.w, minHeight: shape.props.h }} aria-label={node.kind === 'item' ? `基础价值 ${item?.name ?? node.itemId}` : `${node.kind === 'price' ? '售价' : '商品'} ${product?.title ?? node.productKey}`}>
    {node.kind === 'item' ? <>
      <div className="item-price-hero"><GameItemIcon evidence={catalog?.evidence} id={node.itemId} name={item?.name ?? String(node.itemId)} /><h2>{item?.name ?? '道具未收录'}</h2></div>
      <strong className="item-price-big">{map && item ? itemPriceLabel(map, item) : '基础价待补'}<small> / 个</small></strong>
      <p>{item?.approvedPrice ? '已确认补充定价' : '《商业化产出》基础定价'}</p>
      <div className="item-price-placement"><small>已核到投放</small><span>{item?.firstPlacement ?? '待核验'}</span></div>
      <small>连线表示商品包含该道具；礼包折扣在商品总览查看。</small>
      <Button size="sm" variant="ghost" onPointerDown={e => e.stopPropagation()} onClick={() => open(node.itemId)}>基础价与投放依据 ↗</Button>
    </> : !catalog || !product || !link ? <p>商品引用读取中或已失效，请刷新商品引用。</p> : node.kind === 'product' ? <>
      <header><small>{product.channel} · {product.sku}</small><h3>{product.title}</h3></header>
      <div className="item-price-reward"><GameItemIcon evidence={catalog.evidence} id={node.itemId} name={item?.name ?? String(node.itemId)} /><strong>{item?.name} × {quantity!.regular}{quantity!.extra ? <small>；额外 × {quantity!.extra}</small> : null}</strong><span>{item?.basePrice != null && quantity!.regular ? `仅本项基础价值 ${amountLabel(item.basePrice * quantity!.regular)} 钻` : quantity!.extra ? '额外奖励单列，不与周期领取合并' : '基础价值待补'}</span></div>
      <div className="item-price-caption">{link.facts.actual ? '数量：测试流水实得' : '数量：配置快照'}{link.facts.difference ? ' · 源表差异' : ''}{product.channel === '月卡' ? ' · 上列为每日领取' : ''}</div>
      <small className="item-price-limit">{product.limit}</small>
      <div className="item-price-history"><span>{history?.primary}</span><small>{history?.secondary}</small></div>
      <Button size="sm" variant="ghost" aria-label={`查看${product.title}完整奖励与历史`} onPointerDown={e => e.stopPropagation()} onClick={() => openProduct(product.key)}>完整奖励与历史 ↗</Button>
    </> : <>
      <small>{product.kind === 'cash' ? '人民币购买 · 配置售价' : product.kind === 'diamond' ? link.facts.prices.length ? '钻石购买 · 历史实扣' : '钻石购买 · 配置售价' : '其他获得方式'}</small>
      <strong className="item-price-big">{product.kind === 'cash' && link.cash !== undefined ? `¥${amountLabel(link.cash)} 档` : link.facts.price}</strong>
      {product.kind === 'cash' ? <><p>{link.cash === undefined ? '缺现金定价，暂不归入人民币档位。' : `商品标价 ¥${amountLabel(link.cash)}；实际现金与代金券见历史。`}</p><small>礼包内其他奖励和领取条件见左侧商品。</small></> : product.kind === 'diamond' ? <>
        <p className="item-price-reference">{link.diamonds.length && link.basis.rate ? `参考面值 ¥${link.diamonds.map(d => amountLabel(d.yuan!)).join(' / ¥')}` : '人民币参考面值待核验'}</p>
        <small>{link.basis.rate ? `普通充值 1 元＝${amountLabel(link.basis.rate)} 钻；不计额外赠送` : '缺统一的普通充值换算依据'}</small>
        <div className="item-price-tier">单笔充值覆盖：{link.diamonds.length ? link.diamonds.map(d => d.coveringTier ? `${d.amount}钻 → ¥${d.coveringTier.yuan}档（${d.coveringTier.diamonds}钻）` : `${d.amount}钻超过已收录单档`).join('；') : '待核验'}</div>
        <small>仅作档位对照；已有钻石、多笔充值与赠送均未计入。</small>
        {link.diamonds[0]?.coveringTier ? <Button size="sm" variant="ghost" onPointerDown={e => e.stopPropagation()} onClick={() => openProduct(link.diamonds[0]!.coveringTier!.key)}>充值档位依据 ↗</Button> : null}
      </> : <p>无需人民币购买，或尚未建立人民币换算依据。</p>}
      {link.facts.prices.length > 1 ? <span className="item-price-warning">历史多价格，分开保留；见商品历史。</span> : null}
    </>}
  </article></HTMLContainer>
}
