import { createContext, useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Box, HTMLContainer, useValue, type Editor, type TLGeoShape, type TLStore } from 'tldraw'
import { Button, Drawer, Select, Tag, toast } from '@ttqtt/liquid-glass-react'
import { GameItemIcon } from './CommerceEvidenceView'
import { datasetFromSnapshot } from './commerce-design-map'
import type { CommerceSourceLoader } from './CommerceDesignCanvas'
import type { CommerceDataset } from './commerce-data'
import { focusValueItem, itemPriceLabel, itemProducts, itemValueDatasetSchema, readItemValueMap, readItemValueNode, updateItemValueData, valuePages, type ItemValueDataset } from './item-value-map'
import './item-value-map.css'

const Context = createContext<{ map?: ItemValueDataset | undefined; catalog?: CommerceDataset | undefined; open(id: number): void }>({ open: () => undefined })

export function ItemValueCanvas({ store, editorRef, loadSource, canEdit, onOpenSource, children }: {
  store: TLStore; editorRef: RefObject<Editor | undefined>; loadSource?: CommerceSourceLoader | undefined;
  canEdit(): boolean; onOpenSource?: ((id: string) => void) | undefined; children: ReactNode
}) {
  const map = useValue('item value overview', () => readItemValueMap(store.query.records('document').get()[0]?.meta), [store])
  const [catalog, setCatalog] = useState<CommerceDataset>(), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [selectedId, setSelectedId] = useState<number>(), file = useRef<HTMLInputElement>(null)
  const refresh = useRef<(notify?: boolean) => Promise<void>>(async () => undefined)
  const selected = map?.items.find(i => i.id === selectedId)
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
    if (kind === 'pending') ed.zoomToBounds(new Box(-40, -150, 1160, 720), { targetZoom: 1, animation: { duration: 200 } })
    else ed.zoomToFit({ animation: { duration: 200 } })
  }
  return <Context.Provider value={{ map, catalog, open: setSelectedId }}>
    {map ? <div className="item-value-toolbar" role="region" aria-label="道具价值投放导航">
      <strong>道具价值投放总览</strong>
      <Button size="sm" variant="ghost" onClick={() => navigate('value')}>二维总览</Button>
      <Button size="sm" variant="ghost" onClick={() => navigate('pending')}>基础价待核验 · {map.items.filter(i => i.basePrice === null).length}</Button>
      <Select aria-label="定位道具" placeholder="定位道具" value="" options={map.items.map(i => ({ value: String(i.id), label: `${i.name} · ${i.id}` }))} onChange={id => { const ed = editorRef.current; if (ed && !focusValueItem(ed, Number(id))) toast.error('道具图标已被移除，请整理坐标恢复') }} />
      <Button size="sm" variant="ghost" onClick={() => { const ed = editorRef.current; if (ed && canEdit()) { updateItemValueData(store, map, ed); ed.zoomToFit(); toast.success('已按基础价与投放条件整理坐标') } }}>整理坐标</Button>
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
          <section><h3>已核到的投放来源</h3><p>{selected.firstPlacement}</p><p>{selected.placementNote}</p><details><summary>投放依据</summary>{selected.placementSources.map((s, n) => <p key={n}>{s}</p>)}</details></section>
          <section><h3>关联商品配置 · {itemProducts(catalog, selected.id).length}</h3><small>配置收录不代表当前开放；生效状态与历史见商品总览。</small><div className="item-value-linked-products">{itemProducts(catalog, selected.id).slice(0, 8).map(p => <span key={p.key}>{p.title} · {p.sku}</span>)}</div>{itemProducts(catalog, selected.id).length > 8 ? <details><summary>其余 {itemProducts(catalog, selected.id).length - 8} 项</summary><div className="item-value-linked-products">{itemProducts(catalog, selected.id).slice(8).map(p => <span key={p.key}>{p.title} · {p.sku}</span>)}</div></details> : null}{onOpenSource ? <Button variant="glass" onClick={() => onOpenSource(map.sourceBoardId)}>到商品总览查看售价、折扣与历史 ↗</Button> : null}</section>
          <details><summary>来源与范围</summary><p>{map.scope}</p>{map.sources.map(s => <p key={s.path}>{s.label}<br />{s.path}<br /><small>SHA-256：{s.sha256}</small></p>)}</details>
        </div> : null}
      </Drawer>
    </div>
  </Context.Provider>
}

export function ItemValueShape({ shape }: { shape: TLGeoShape }) {
  const { map, catalog, open } = useContext(Context), node = readItemValueNode(shape)!
  const item = map?.items.find(i => i.id === node.itemId)
  return <HTMLContainer><article className="item-value-node" style={{ width: shape.props.w, height: shape.props.h }} aria-label={`道具 ${item?.name ?? node.itemId}`}>
    <div className="item-value-node-main">{catalog?.evidence?.icons?.[node.itemId] ? <GameItemIcon evidence={catalog.evidence} id={node.itemId} name={item?.name ?? String(node.itemId)} /> : <small className="item-value-icon-pending">图标<br />待补</small>}<span>{item?.name ?? `道具 ${node.itemId}`}</span></div>
    <div className="item-value-node-foot"><strong>{map && item ? itemPriceLabel(map, item) : '读取中…'}</strong><Button variant="ghost" size="sm" aria-label={`展开${item?.name ?? node.itemId}`} onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); open(node.itemId) }}>↗</Button></div>
  </article></HTMLContainer>
}
