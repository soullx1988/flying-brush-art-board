import { AssetRecordType, type TLStore, type TLAsset } from 'tldraw'
import { readCommerceDataset } from './commerce-data'
import { applyCatalogUpdate } from './commerce-catalog'
import { mergeCommerceEvidence, validateEvidenceForDataset, type CommerceEvidenceBundle } from './commerce-evidence'

export async function importCommerceEvidence(store: TLStore, bundle: CommerceEvidenceBundle, canEdit: () => boolean) {
  const document = store.query.records('document').get()[0]
  const data = readCommerceDataset(document?.meta)
  if (!document || !data || !canEdit()) throw new Error('当前画板暂不可编辑。')
  validateEvidenceForDataset(bundle.evidence, applyCatalogUpdate(data, bundle.catalog))
  const assets: TLAsset[] = []
  // Verify every file before uploading any. The board is changed only after all uploads succeed.
  for (const [hash, asset] of Object.entries(bundle.evidence.assets)) {
    const base64 = bundle.files[hash]
    if (!base64 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length % 4) throw new Error(`图片文件缺失或无效：${asset.name}`)
    const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0))
    // Web Crypto requires HTTPS; the LAN app may run over HTTP. The asset service verifies the hash below.
    if (globalThis.crypto?.subtle) {
      const actual = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('')
      if (actual !== hash) throw new Error(`图片校验不一致：${asset.name}`)
    }
  }
  for (const [hash, asset] of Object.entries(bundle.evidence.assets)) {
    if (!canEdit()) throw new Error('画板已切换或编辑权限已变化，请重新打开资料包。')
    const response = await fetch('/api/assets', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mime: asset.mime, base64: bundle.files[hash] }) })
    if (!response.ok) throw new Error(`上传图片失败：${asset.name}（${response.status}）`)
    const result = await response.json() as { sha256: string }
    if (result.sha256 !== hash) throw new Error(`图片校验不一致：${asset.name}`)
    assets.push({ id: AssetRecordType.createId(`commerce-${hash}`), typeName: 'asset', type: 'image', props: { w: asset.width, h: asset.height, name: asset.name, isAnimated: false, mimeType: asset.mime, src: `/api/assets/${hash}` }, meta: { commerceEvidence: true, sha256: hash } })
  }
  const current = store.query.records('document').get()[0]
  const currentData = readCommerceDataset(current?.meta)
  if (!current || !currentData || !canEdit()) throw new Error('当前画板状态已变化，未覆盖资料。')
  const refreshedData = applyCatalogUpdate(currentData, bundle.catalog)
  validateEvidenceForDataset(bundle.evidence, refreshedData)
  const evidence = mergeCommerceEvidence(bundle.evidence, currentData.evidence)
  validateEvidenceForDataset(evidence, refreshedData)
  store.put([...assets, { ...current, meta: { ...current.meta, commerceOverview: { version: 1, dataset: { ...refreshedData, evidence } } } }])
}
