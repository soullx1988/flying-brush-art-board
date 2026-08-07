import { DotsThree } from '@phosphor-icons/react'
import { Button, Menu, type MenuItem } from '@ttqtt/liquid-glass-react'

import type { BoardTabView } from './board-tab-types'

const STATUS_LABELS: Record<BoardTabView['status'], string> = {
  loading: '加载中',
  clean: '已保存',
  dirty: '未保存',
  saving: '保存中',
  conflict: '保存冲突',
  offline: '离线保留',
  error: '保存失败',
}

export interface TabOverflowMenuProps {
  tabs: readonly BoardTabView[]
  onActivate(tabId: string): void
}

export function TabOverflowMenu({ tabs, onActivate }: TabOverflowMenuProps) {
  if (tabs.length === 0) return null
  const items: MenuItem[] = tabs.map((tab) => ({
    key: tab.tabId,
    label: `${tab.title}（${[STATUS_LABELS[tab.status], tab.readOnly ? '只读' : ''].filter(Boolean).join(' · ')}）`,
  }))

  return (
    <div className="tab-overflow">
      <Menu items={items} placement="bottom-start" onSelect={onActivate}>
        <Button variant="ghost" size="sm" type="button" aria-label="更多已打开画板" icon={<DotsThree weight="bold" aria-hidden="true" />} />
      </Menu>
    </div>
  )
}
