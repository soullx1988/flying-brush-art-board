import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const script = (name: string) => readFileSync(join(process.cwd(), 'scripts', name), 'utf8')

describe('backup PowerShell data directory convention', () => {
  it('uses the LOCALAPPDATA base and its InfiniteBoard child consistently', () => {
    const start = script('start-local.ps1')
    const backup = script('backup.ps1')
    const restore = script('restore.ps1')

    for (const content of [start, backup, restore]) {
      expect(content).toContain("Join-Path $resolvedLocalAppDataBase 'InfiniteBoard'")
    }
    expect(start).toContain('$env:LOCALAPPDATA = $resolvedLocalAppDataBase')
    expect(start).toContain('$env:LOCALAPPDATA = $previousLocalAppData')
    expect(start).toContain("'scripts/migrate-local.ts'")
    expect(start).not.toContain('[int]$ApiPort')
    expect(restore).not.toContain('[int]$ApiPort')
  })
})
