import { isCatalogProduct, type CommerceDataset, type CommerceProduct } from './commerce-data'

// Reading groups only. Prices, rewards, images and history remain on the imported records.
export const commerceEntrances = [
  { id: 'shop', name: '商城', description: '随机商店、日 / 周 / 月礼包、关卡礼包与充值', channels: ['每日随机商店', '日礼包', '周礼包', '月礼包', '钻石充值', '金币礼包', '通关礼包'] },
  { id: 'benefits', name: '特惠与长期权益', description: '每日特惠、月卡、战令、基金与付费签到', channels: ['每日特惠礼包', '月卡', '战令', '基金', '每周签到'] },
  { id: 'first', name: '首充', description: '首次充值对应的启程好礼', channels: ['首充'] },
  { id: 'trigger', name: '触发礼包', description: '招募与抽取等条件出现的礼包', channels: ['英雄招募条件礼包', '宝石条件礼包', '武器条件礼包', '触发礼包缺项'] },
  { id: 'chain', name: '链式礼包', description: '按购买顺序查看招募、宝石、魔灵与武器链', channels: ['招募链', '宝石链', '魔灵链', '武器链'] },
  { id: 'events', name: '活动商品', description: '冲刺、星火秘宝、英雄试炼与龙宫活动', channels: ['招募冲刺', '宝石冲刺', '魔灵冲刺', '武器冲刺', '星火秘宝', '英雄试炼', '龙宫钥匙礼包', '龙宫限时礼包', '龙宫药剂礼包'] },
  { id: 'exchange', name: '资源兑换', description: '查看资源兑换选择，比较同一资源的获得方式', channels: ['资源兑换商店'] },
  { id: 'unverified', name: '入口待核验', description: '尚未对应商品的充值档位、其他候选及新出现的投放形式', channels: ['其他商店候选', '充值档位待对应'] },
] as const

export function entranceFor(product: CommerceProduct) {
  return commerceEntrances.find(entry => (entry.channels as readonly string[]).includes(product.channel)) ?? commerceEntrances[7]
}

export function entranceProducts(data: CommerceDataset, entrance: string) {
  return data.products.filter(p => isCatalogProduct(p) && (entrance === 'all' || entranceFor(p).id === entrance))
}

export function relatedReason(product: CommerceProduct, other: CommerceProduct, data: CommerceDataset) {
  const rewards = other.rewards.filter(a => product.rewards.some(b => b.id === a.id && ![300001, 300003].includes(b.id)))
  if (rewards.length) return `同样提供：${rewards.map(r => r.name).join('、')}`
  const needs = data.needs.filter(n => n.id !== 'unknown' && product.needs.includes(n.id) && other.needs.includes(n.id))
  return `候选需求相同：${needs.map(n => n.name).join('、')}`
}

/** Identify a native commerce board without copying its catalog into navigation metadata. */
export function hasCommerceOverview(snapshot: unknown): boolean {
  if (!snapshot || typeof snapshot !== 'object' || !('store' in snapshot)) return false
  const store = snapshot.store
  if (!store || typeof store !== 'object') return false
  return Object.values(store).some(record => record?.typeName === 'document' && record.meta?.commerceOverview?.version === 1 && Array.isArray(record.meta.commerceOverview.dataset?.products))
}
