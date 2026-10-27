import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { CommercePagedTable } from './CommercePagedTable'

afterEach(cleanup)
const rows = Array.from({length: 25}, (_, i) => ({id: String(i), name: `记录-${i + 1}`}))
const columns = [{key: 'name', title: '记录', dataIndex: 'name' as const}]

describe('commerce table feedback', () => {
  it('shows the requested page, announces its range and moves focus to the results', () => {
    render(<CommercePagedTable scope="all" aria-label="明细" rowKey="id" columns={columns} data={rows} pageSize={12} />)
    fireEvent.click(screen.getByRole('button', {name: '下一页'}))
    expect(screen.getByRole('status')).toHaveTextContent('第 2 / 3 页 · 当前第 13—24 条')
    expect(within(screen.getByRole('table')).getByText('记录-13')).toBeInTheDocument()
    expect(screen.queryByText('记录-1', {exact: true})).not.toBeInTheDocument()
    expect(screen.getByLabelText('明细分页结果')).toHaveFocus()
    fireEvent.click(screen.getByRole('button', {name: '上一页'}))
    expect(within(screen.getByRole('table')).getByText('记录-1')).toBeInTheDocument()
  })
  it('resets on scope change and clamps shrinking results without false empty states', () => {
    const {rerender} = render(<CommercePagedTable scope="all" aria-label="明细" rowKey="id" columns={columns} data={rows} pageSize={12} />)
    fireEvent.click(screen.getByRole('button', {name: '第 3 页'}))
    rerender(<CommercePagedTable scope="king" aria-label="明细" rowKey="id" columns={columns} data={rows.slice(0,15)} pageSize={12} />)
    expect(screen.getByRole('status')).toHaveTextContent('第 1 / 2 页')
    expect(within(screen.getByRole('table')).getByText('记录-1')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', {name: '下一页'}))
    rerender(<CommercePagedTable scope="king" aria-label="明细" rowKey="id" columns={columns} data={rows.slice(0,1)} pageSize={12} />)
    expect(within(screen.getByRole('table')).getByText('记录-1')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('第 1 / 1 页')
  })
})
