import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { resolveTradingDataDirectory } from './trading-data-directory.js'

describe('resolveTradingDataDirectory', () => {
  const repositoryRoot = resolve('D:/workspace/project/08_无限画布工作台/flying-brush-art-board')

  it('finds the picker beside the infinite-board workspace without using process.cwd()', () => {
    expect(resolveTradingDataDirectory(undefined, repositoryRoot)).toBe(
      resolve(repositoryRoot, '..', '..', '07_中短线选股器'),
    )
  })

  it('resolves documented relative overrides from the repository root', () => {
    expect(resolveTradingDataDirectory('../../07_中短线选股器', repositoryRoot)).toBe(
      resolve(repositoryRoot, '..', '..', '07_中短线选股器'),
    )
  })

  it('preserves absolute overrides', () => {
    const absolute = resolve('D:/trading-data')
    expect(resolveTradingDataDirectory(absolute, repositoryRoot)).toBe(absolute)
  })
})
