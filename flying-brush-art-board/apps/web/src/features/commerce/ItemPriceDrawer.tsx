import { useLayoutEffect, useRef, useState } from 'react'
import { Button, Drawer, Select, Tag } from '@ttqtt/liquid-glass-react'
import type { CommerceDataset, CommerceProduct } from './commerce-data'
import { productPlacement } from './commerce-catalog'
import { GameItemIcon } from './CommerceEvidenceView'
import { ProductFacts } from './CommerceFactsView'
import { TestProductResults } from './CommerceRevenueView'
import { graphFacts, productHistorySummary } from './commerce-product-graph'
import { priceLink, priceProducts, selectedQuantity, type PriceSelection } from './item-price-chain'
import { itemPriceLabel, type ItemValueDataset } from './item-value-map'

const amount = (n: number) => n.toLocaleString('zh-CN', { maximumFractionDigits: 4 })

function PriceReference({ data, product }: { data: CommerceDataset; product: CommerceProduct }) {
  const link = priceLink(data, product)
  return <section className="item-price-drawer-price">
    <small>{product.kind === 'diamond' && link.facts.prices.length ? '历史实扣' : '商品售价'}</small>
    <strong>{link.facts.price || '价格待核验'}</strong>
    {product.kind === 'diamond' ? <>
      <p>{link.diamonds.length && link.basis.rate ? `人民币参考面值 ¥${link.diamonds.map(d => amount(d.yuan!)).join(' / ¥')}` : '人民币参考面值待核验'}</p>
      <small>{link.basis.rate ? `普通充值 1 元＝${amount(link.basis.rate)} 钻；不计赠送，不代表实际现金支付。` : '缺统一的普通充值换算依据。'}</small>
      <details><summary>对应充值档位</summary><p>{link.diamonds.length ? link.diamonds.map(d => d.coveringTier ? `${amount(d.amount)} 钻 → ¥${amount(d.coveringTier.yuan)} 档（${amount(d.coveringTier.diamonds)} 钻）` : `${amount(d.amount)} 钻超过已收录单档`).join('；') : '待核验'}</p><small>单笔充值覆盖对照；已有钻石、多笔充值与赠送未计入。</small></details>
    </> : product.kind === 'cash' ? <small>{link.cash === undefined ? '人民币档位待核验。' : `人民币 ¥${amount(link.cash)} 档；实际现金与代金券分开见下方历史。`}</small>
      : <small>{product.kind === 'resource' ? '资源兑换，不折算人民币或现金收入。' : product.kind === 'unknown' ? '获得方式待核验。' : '免费或广告领取，不计入现金收入。'}</small>}
    {link.facts.prices.length > 1 ? <Tag color="warning">历史多价格，分开保留</Tag> : null}
  </section>
}

/** Shared product detail, resolved from the existing catalog and historical evidence. */
export function ItemPriceProductDetail({ data, product, onOpenSource }: {
  data: CommerceDataset; product: CommerceProduct; onOpenSource?: (() => void) | undefined
}) {
  return <div className="item-value-detail">
    <small>{productPlacement(product)} · {product.sku}</small>
    <PriceReference data={data} product={product} />
    {product.channel === '月卡' ? <section><h3>每日领取</h3><ProductFacts data={data} product={product} /></section> : <ProductFacts data={data} product={product} />}
    {product.extraRewards?.length ? <section><h3>{product.channel === '月卡' ? '购买即时奖励' : '额外奖励 · 配置快照'}</h3>{product.extraRewards.map(r => <div className="commerce-reward" key={r.id}><GameItemIcon evidence={data.evidence} id={r.id} name={r.name} /><span>{r.name} × {r.n}</span></div>)}</section> : null}
    {product.limit ? <p>{product.limit}</p> : null}
    {product.placement ? <section><h3>游戏内入口</h3><p>{product.placement.path}</p><small>{product.placement.source}</small></section> : null}
    {product.note ? <p>{product.note}</p> : null}
    <TestProductResults data={data} product={product} group="all" />
    {onOpenSource ? <Button onClick={onOpenSource}>商品总览 · 折扣与完整历史 ↗</Button> : null}
    <details><summary>配置价格来源</summary><p>{data.sources[product.source]?.path} · {product.row ? `第 ${product.row} 行` : `商品 ${product.sku}`}</p><p>{data.created} 配置快照；各服当前生效仍以发布记录为准。</p></details>
  </div>
}

/** Transient UI only: opening/filtering a price never writes shapes or changes the camera. */
export function ItemPriceDrawer({ data, map, itemId, initialChannel = 'all', onClose, onOpenSource }: {
  data: CommerceDataset; map: ItemValueDataset; itemId: number; initialChannel?: string;
  onClose(): void; onOpenSource?: (() => void) | undefined
}) {
  const [kind, setKind] = useState<PriceSelection['kind']>('all')
  const [channel, setChannel] = useState(initialChannel)
  const [productKey, setProductKey] = useState<string>()
  const [limit, setLimit] = useState(12)
  const content = useRef<HTMLDivElement>(null), listScroll = useRef(0), previousProduct = useRef<string | undefined>(undefined)
  const item = map.items.find(i => i.id === itemId)
  const all = priceProducts(data, { itemId, kind: 'all', channel: 'all', offset: 0 })
  const products = priceProducts(data, { itemId, kind, channel, offset: 0 }).filter(p => kind !== 'other' || p.kind !== 'resource')
  const selected = productKey ? all.find(p => p.key === productKey) : all.length === 1 ? all[0] : undefined
  useLayoutEffect(() => {
    if (previousProduct.current === selected?.key) return
    const body = content.current?.closest('.lg-drawer__body')
    if (body) {
      if (selected) { body.scrollTop = 0; content.current?.querySelector<HTMLElement>('[data-product-heading]')?.focus({ preventScroll: true }) }
      else {
        body.scrollTop = listScroll.current
        const trigger = [...(content.current?.querySelectorAll<HTMLButtonElement>('[data-price-product]') ?? [])].find(el => el.dataset.priceProduct === previousProduct.current)
        trigger?.focus({ preventScroll: true })
      }
    }
    previousProduct.current = selected?.key
  }, [selected?.key])
  const channels = [...new Set(all.map(productPlacement))]
  const reset = () => { setKind('all'); setChannel('all'); setLimit(12) }
  return <Drawer open onOpenChange={open => { if (!open) onClose() }} placement="right" size={620} title={`${item?.name ?? itemId} · 商品售价`}>
    <div ref={content} className="item-value-detail item-price-drawer" aria-label="道具商品售价侧栏">
      <header className="item-price-drawer-item"><GameItemIcon evidence={data.evidence} id={itemId} name={item?.name ?? String(itemId)} /><div><b>{item?.name ?? itemId}</b><small>基础价 {item ? itemPriceLabel(map, item) : '待补'} / 个</small></div><Tag>{all.length} 项关联商品</Tag></header>
      <section aria-label="道具描述"><small>道具描述</small><p className="item-price-drawer-description">{item?.description?.trim() || '道具描述待补'}</p></section>
      {item ? <details><summary>基础价与投放依据</summary><p>{item.priceNote}</p><small>{item.priceSource || '定价来源待补'}</small><p>{item.firstPlacement}</p><small>{item.placementNote}</small></details> : null}
      {selected ? <>
        {all.length > 1 ? <Button variant="ghost" size="sm" onClick={() => setProductKey(undefined)}>← 返回关联商品（{products.length} 项）</Button> : null}
        <h3 tabIndex={-1} data-product-heading>{selected.title}</h3>
        <ItemPriceProductDetail data={data} product={selected} onOpenSource={onOpenSource} />
      </> : <>
        {all.length ? <div className="item-price-drawer-filters">
          <Select aria-label="侧栏支付方式" value={kind} options={[{ value: 'all', label: '全部获得方式' }, { value: 'diamond', label: '钻石购买' }, { value: 'cash', label: '人民币购买' }, { value: 'resource', label: '资源兑换' }, { value: 'other', label: '免费 / 广告等' }]} onChange={value => { setKind(value as PriceSelection['kind']); setLimit(12) }} />
          <Select aria-label="侧栏投放入口" value={channel} options={[{ value: 'all', label: '全部投放入口' }, ...channels.map(value => ({ value, label: value })), ...(channel !== 'all' && !channels.includes(channel) ? [{ value: channel, label: channel }] : [])]} onChange={value => { setChannel(value); setLimit(12) }} />
        </div> : null}
        <div className="item-price-drawer-count"><span role="status">{products.length} 项{products.length > limit ? ` · 已显示 ${limit} 项` : ''}</span>{kind !== 'all' || channel !== 'all' ? <Button size="sm" variant="ghost" onClick={reset}>清除筛选</Button> : null}</div>
        {products.slice(0, limit).map(p => {
          const facts = graphFacts(data, p), quantity = selectedQuantity(data, p, itemId), history = productHistorySummary(data, p)
          return <article key={p.key} className="item-price-drawer-product" aria-label={`${p.title} · ${p.sku}`}>
            <small>{productPlacement(p)} · {p.sku}</small>
            <header><h3>{p.title}</h3><strong>{facts.price || '价格待核验'}</strong></header>
            <div className="item-price-drawer-reward"><GameItemIcon evidence={data.evidence} id={itemId} name={item?.name ?? String(itemId)} /><span>{item?.name ?? itemId}{quantity.regular ? ` × ${amount(quantity.regular)}${p.channel === '月卡' ? ' / 日' : ''}` : ''}{quantity.extra ? `${quantity.regular ? '；' : ' · '}${p.channel === '月卡' ? '购买即时' : '额外'} × ${amount(quantity.extra)}` : ''}{!quantity.regular && !quantity.extra ? ' · 数量待核验' : ''}</span></div>
            <small>{facts.actual ? '流水实得' : '配置快照'}{facts.difference ? ' · 源表与流水不同' : ''}{facts.incomplete || facts.varied ? ' · 到账明细待核全' : ''}{p.limit ? ` · ${p.limit}` : ''}</small>
            <footer><div><b>{history.primary}</b><small>{history.secondary}</small></div><Button size="sm" variant="glass" data-price-product={p.key} aria-label={`查看${p.title}（${p.sku}）价格与历史`} onClick={() => { listScroll.current = content.current?.closest('.lg-drawer__body')?.scrollTop ?? 0; setProductKey(p.key) }}>价格与历史 →</Button></footer>
          </article>
        })}
        {!products.length ? <p>{all.length ? '当前筛选没有匹配商品，可清除筛选查看全部。' : '当前商品库未收录直接发放该道具的商品；兑换消耗不算获得来源。'}</p> : null}
        {products.length > limit ? <Button variant="ghost" onClick={() => setLimit(n => n + 12)}>继续显示（剩余 {products.length - limit} 项）</Button> : null}
      </>}
    </div>
  </Drawer>
}
