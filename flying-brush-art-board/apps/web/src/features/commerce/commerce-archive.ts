import { z } from 'zod'

const count = z.number().int().nonnegative()
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const source = z.object({ path: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/) })
const row = z.object({ server: count, date, yuan: z.number().nonnegative(), capturedAt: z.string().datetime({ offset: true }), source: z.string(), orders: count.optional(), buyers: count.optional() })
export const archivedRevenueSchema = z.object({
  id: z.string(), title: z.string(), from: date, through: date, importedAt: z.string().datetime({ offset: true }),
  servers: z.array(z.object({ id: count, name: z.string(), group: z.string() })).min(1), daily: z.array(row).min(1),
  inputFiles: count, emptyFiles: count, basis: z.string(), coverage: z.string(), limitations: z.array(z.string()), gaps: z.array(z.string()),
  sources: z.array(source).min(1), backup: source,
}).superRefine((r, ctx) => {
  const ids = new Set(r.servers.map(s => s.id)), paths = new Set(r.sources.map(s => s.path))
  const unique = new Set(r.daily.map(d => `${d.server}:${d.date}`))
  if (r.from > r.through || ids.size !== r.servers.length || unique.size !== r.daily.length || r.emptyFiles > r.inputFiles || r.daily.some(d => !ids.has(d.server) || !paths.has(d.source) || d.date < r.from || d.date > r.through || captureDay(d.capturedAt) < d.date || (d.orders !== undefined && d.buyers !== undefined && d.buyers > d.orders))) ctx.addIssue({ code: 'custom', message: '历史备份日期、区服、来源或唯一性校验失败' })
})
export type ArchivedRevenue = z.infer<typeof archivedRevenueSchema>
export type ArchivedRevenueRow = ArchivedRevenue['daily'][number]
export function captureDay(time: string) { return new Date(Date.parse(time) + 8 * 3600_000).toISOString().slice(0, 10) }
export function isPartialDay(row: ArchivedRevenueRow) { return captureDay(row.capturedAt) === row.date }
export function archiveRows(report: ArchivedRevenue, group: string, server = 'all') {
  const ids = new Set(report.servers.filter(s => group === 'all' || s.group === group).map(s => s.id))
  return report.daily.filter(r => ids.has(r.server) && (server === 'all' || r.server === Number(server)))
}
