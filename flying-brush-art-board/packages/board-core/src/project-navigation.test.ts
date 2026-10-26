import { describe, expect, it } from 'vitest'
import { assertProjectNavigationValid, navigationPath, removeNavigationBoard, type ProjectNavigation } from './project-navigation.js'
const navigation: ProjectNavigation = { version: 1, revision: 4, topics: [{id:'topic:shop',title:'商业模式',description:''}], parents: {shop:'topic:shop',monthly:'shop',resources:'topic:shop'} }
describe('project navigation', () => {
  it('uses stable identities and allows shared cross-linked resources without multiple owners', () => {
    expect(() => assertProjectNavigationValid(navigation,['shop','monthly','resources','new'])).not.toThrow()
    expect(navigationPath(navigation,'monthly')).toEqual(['topic:shop','shop','monthly'])
    expect(navigationPath(navigation,'new')).toEqual(['new'])
  })
  it('rejects cycles, foreign boards, dangling owners and duplicate topics', () => {
    for(const parents of [{shop:'monthly',monthly:'shop'}, {other:'shop'}, {shop:'missing'}]) expect(() => assertProjectNavigationValid({...navigation,parents},['shop','monthly','resources'])).toThrow()
    expect(() => assertProjectNavigationValid({...navigation,topics:[...navigation.topics,...navigation.topics]},['shop','monthly','resources'])).toThrow()
  })
  it('promotes children when their parent is deleted without losing their location', () => {
    const next=removeNavigationBoard(navigation,'shop')
    expect(next.parents).toEqual({monthly:'topic:shop',resources:'topic:shop'})
    expect(next.revision).toBe(5)
    expect(navigation.parents.shop).toBe('topic:shop')
  })
})
