import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const dataDirectory = process.env.INFINITE_BOARD_DATA_DIR?.trim()
  || resolve(process.cwd(), '.infinite-board-data')
const pnpmEntry = process.env.npm_execpath
if (!pnpmEntry) throw new Error('PNPM_EXEC_PATH_MISSING')

console.log(`Development data directory: ${dataDirectory}`)
const child = spawn(process.execPath, [
  pnpmEntry,
  '--parallel',
  '--filter', '@infinite-board/local-api',
  '--filter', '@infinite-board/web',
  'dev',
], {
  cwd: process.cwd(),
  stdio: 'inherit',
  env: { ...process.env, INFINITE_BOARD_DATA_DIR: dataDirectory },
})

const forward = (signal: NodeJS.Signals) => {
  if (!child.killed) child.kill(signal)
}
process.once('SIGINT', () => forward('SIGINT'))
process.once('SIGTERM', () => forward('SIGTERM'))
child.once('error', (error) => {
  console.error(error)
  process.exitCode = 1
})
child.once('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0)
})
