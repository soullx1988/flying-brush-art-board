import { describe, expect, it } from 'vitest'
import { createReferenceGraphProjectFixture } from '../../../test-fixtures/src/iboard/reference-graph-project.js'
import { exportProjectToIboard } from './export-project.js'
import { preflightIboardImport } from './import-preflight.js'
import { createIboardMergePlan } from './remap-project.js'
import { assertProjectNavigationValid } from '@infinite-board/board-core'
describe('navigation archive roundtrip', () => {
  it('retains topics and remaps every owner when merged into another project', () => {
    const fixture=createReferenceGraphProjectFixture()
    const root=fixture.project.rootBoardId
    fixture.project.navigation={version:1,revision:3,topics:[{id:'topic:design',title:'设计',description:'一个事实一处维护'}],parents:Object.fromEntries(fixture.boards.map(b=>[b.id,b.id===root?'topic:design':root]))}
    const decoded=preflightIboardImport(exportProjectToIboard(fixture))
    expect(decoded.manifest.navigation).toEqual(fixture.project.navigation)
    const plan=createIboardMergePlan(decoded,{targetProjectId:'new-project',namespace:'copy'})
    const newRoot=plan.idMap.boards[root]!
    expect(plan.navigation!.parents[newRoot]).toBe(plan.navigation!.topics[0]!.id)
    for(const board of fixture.boards.filter(b=>b.id!==root)) expect(plan.navigation!.parents[plan.idMap.boards[board.id]!]).toBe(newRoot)
    expect(() => assertProjectNavigationValid(plan.navigation!,plan.boards.map(b=>b.id))).not.toThrow()
    expect(plan.references.length).toBe(fixture.references.length)
  })
  it('keeps older project packages valid and rejects broken navigation exports', () => {
    const fixture=createReferenceGraphProjectFixture()
    expect(preflightIboardImport(exportProjectToIboard(fixture)).manifest.navigation).toBeUndefined()
    fixture.project.navigation={version:1,revision:0,topics:[],parents:{missing:'other'}}
    expect(()=>exportProjectToIboard(fixture)).toThrow('NAVIGATION_BOARD_NOT_FOUND')
  })
})
