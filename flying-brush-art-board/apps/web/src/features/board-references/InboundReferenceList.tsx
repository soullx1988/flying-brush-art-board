import type { BoardReferenceRecord } from '@infinite-board/board-core'

export interface InboundReferenceListProps {
  references: readonly BoardReferenceRecord[]
  getBoardTitle(boardId: string): string
  onOpenSource(reference: BoardReferenceRecord): void
}

export function InboundReferenceList({
  references,
  getBoardTitle,
  onOpenSource,
}: InboundReferenceListProps) {
  return (
    <section className="inbound-reference-list" aria-label="引用此画板的位置">
      <h2>引用此画板的位置</h2>
      {references.length === 0 ? (
        <p>没有画板引用此画板。</p>
      ) : (
        <ul>
          {references.map((reference) => (
            <li key={reference.id}>
              <button type="button" onClick={() => onOpenSource(reference)}>
                <strong>{getBoardTitle(reference.sourceBoardId)}</strong>
                <span>{reference.kind === 'embed' ? '嵌入' : '链接'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
