import fs from 'node:fs'
import { exportProjectToIboard } from '../packages/interop/src/index'
import { createItemValueSnapshot, itemValueDatasetSchema } from '../apps/web/src/features/commerce/item-value-map'

const [input, output] = process.argv.slice(2)
if (!input || !output) throw new Error('Usage: tsx scripts/package-item-value-map.mts data.json output.iboard|snapshot.json')
const data = itemValueDatasetSchema.parse(JSON.parse(fs.readFileSync(input, 'utf8')))
const snapshot = createItemValueSnapshot(data)
if (output.endsWith('.iboard')) {
  const id = 'item-value-overview', projectId = 'item-value-export', title = '道具价值投放总览', timestamp = new Date().toISOString()
  fs.writeFileSync(output, exportProjectToIboard({
    project: { id: projectId, title, rootBoardId: id, createdAt: timestamp, updatedAt: timestamp },
    boards: [{ id, projectId, title, revision: 0, tldrawSnapshot: snapshot, createdAt: timestamp, updatedAt: timestamp }],
    references: [], assets: [],
  }))
} else fs.writeFileSync(output, JSON.stringify(snapshot))
console.log(`Prepared independent map: ${data.items.length} items`)
process.exit(0)
