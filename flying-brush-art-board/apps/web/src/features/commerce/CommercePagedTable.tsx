import { useLayoutEffect, useRef, useState } from 'react'
import { Table, type TableProps } from '@ttqtt/liquid-glass-react'

type Props<T> = Omit<TableProps<T>, 'pagination'> & { scope: string; pageSize: number }

// A changed scope starts a new result set. The library's uncontrolled table keeps
// its old page, which can otherwise turn a non-empty filtered set into an empty table.
export function CommercePagedTable<T>({ scope, ...props }: Props<T>) {
  return <PagedResults key={scope} {...props} />
}

function PagedResults<T>({ pageSize, ...props }: Omit<Props<T>, 'scope'>) {
  const [page, setPage] = useState(1)
  const result = useRef<HTMLDivElement>(null), revealPage = useRef(false)
  const pages = Math.max(1, Math.ceil(props.data.length / pageSize))
  const current = Math.min(page, pages)
  useLayoutEffect(() => {
    if (!revealPage.current) return
    revealPage.current = false
    result.current?.scrollIntoView?.({ block: 'start' })
    result.current?.focus({ preventScroll: true })
  }, [current])
  return <div ref={result} tabIndex={-1} className="commerce-paged-results" aria-label={`${props['aria-label'] ?? '数据'}分页结果`}>
    <p className="commerce-muted" role="status">共 {props.data.length} 条 · 第 {current} / {pages} 页{props.data.length ? ` · 当前第 ${(current - 1) * pageSize + 1}—${Math.min(current * pageSize, props.data.length)} 条` : ''}</p>
    <Table {...props} pagination={{ pageSize, page: current, onChange: next => { revealPage.current = true; setPage(next) } }} />
  </div>
}
