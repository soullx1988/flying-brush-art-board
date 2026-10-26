import { describe, expect, it } from 'vitest'
import { buildTestApp } from '../../../../../tests/helpers/build-test-app.js'
describe('shared project navigation API', () => {
  it('persists, audits, prevents stale overwrites and cleans deleted parents', async () => {
    const test=await buildTestApp()
    try {
      const headers={cookie:test.sessionCookie()}
      await test.app.inject({method:'POST',url:'/api/projects',headers,payload:{id:'nav',title:'Design',rootBoard:{id:'root',title:'Guide'}}})
      for(const id of ['shop','monthly']) await test.app.inject({method:'POST',url:'/api/projects/nav/boards',headers,payload:{id,title:id}})
      const payload={version:1,revision:0,topics:[{id:'topic:commerce',title:'商业模式',description:'商品与资源'}],parents:{shop:'topic:commerce',monthly:'shop'}}
      const url='/api/projects/nav/navigation'
      expect((await test.app.inject({method:'PUT',url,payload})).statusCode).toBe(401)
      const saved=await test.app.inject({method:'PUT',url,headers,payload})
      expect(saved.statusCode).toBe(200)
      expect(saved.json().navigation.revision).toBe(1)
      expect((await test.app.inject({method:'GET',url:'/api/projects/nav',headers})).json().project.navigation.parents.monthly).toBe('shop')
      expect((await test.app.inject({method:'PUT',url,headers,payload})).statusCode).toBe(409)
      expect((await test.app.inject({method:'PUT',url,headers,payload:{...payload,revision:1,parents:{shop:'monthly',monthly:'shop'}}})).json().code).toBe('NAVIGATION_CYCLE')
      expect((await test.app.inject({method:'PUT',url,headers,payload:{...payload,revision:1,parents:{alien:'shop'}}})).statusCode).toBe(400)
      await test.app.inject({method:'PATCH',url:'/api/boards/monthly',headers,payload:{title:'月卡新名'}})
      expect((await test.app.inject({method:'GET',url:'/api/projects/nav',headers})).json().project.navigation.parents.monthly).toBe('shop')
      expect((await test.app.inject({method:'DELETE',url:'/api/boards/shop',headers})).statusCode).toBe(204)
      const after=(await test.app.inject({method:'GET',url:'/api/projects/nav',headers})).json()
      expect(after.project.navigation.parents).toEqual({monthly:'topic:commerce'})
      expect(after.project.navigation.revision).toBe(2)
      expect(test.database.prepare("SELECT count(*) AS n FROM audit_events WHERE action='project.navigation'").get()).toEqual({n:1})
    } finally {await test.close()}
  })
})
