import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { decodeIboard } from '../../../../packages/interop/src/index.js'
import { createPngFixture } from '../../../../packages/test-fixtures/src/media.js'
import { afterEach, describe, expect, it } from 'vitest'

import { buildTestApp, type TestApp } from '../../../../tests/helpers/build-test-app.js'
import { AssetRepository } from '../modules/assets/asset-repository.js'
import { BoardRepository } from '../modules/boards/board-repository.js'
import { ProjectRepository } from '../modules/projects/project-repository.js'

describe('owner-only Board privacy', () => {
  const apps: TestApp[] = []
  const directories: string[] = []

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()))
    directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }))
  })

  it('keeps 心态 content owner-only across aggregate, REST, export, comments, assets and clipboard', async () => {
    const owner = { openId: 'owner-a', name: 'Owner A' }
    const member = { openId: 'member-b', name: 'Member B' }
    const assetDirectory = mkdtempSync(join(tmpdir(), 'infinite-board-privacy-'))
    directories.push(assetDirectory)
    const testApp = await buildTestApp({ users: [owner, member], assetDirectory })
    apps.push(testApp)
    const ownerCookie = testApp.sessionCookie(owner)
    const memberCookie = testApp.sessionCookie(member)

    const created = await testApp.app.inject({
      method: 'PUT',
      url: '/api/bootstrap/personal-trading-workspace',
      headers: { cookie: ownerCookie },
    })
    expect(created.statusCode).toBe(201)
    const projectId = created.json().project.id as string
    const projects = new ProjectRepository(testApp.database)
    const boards = new BoardRepository(testApp.database)
    projects.addMember(projectId, member.openId)
    const projectBoards = boards.listByProject(projectId)
    const privateBoard = projectBoards.find((board) => board.title === '心态')!
    const publicBoard = projectBoards.find((board) => board.title === '数据')!
    const rootBoard = projectBoards.find((board) => board.id === created.json().project.rootBoardId)!
    expect(privateBoard).toMatchObject({ accessLevel: 'owner-only', ownerOpenId: owner.openId })

    const secret = '只属于 A 的亏损后冲动记录'
    boards.saveSnapshot(privateBoard.id, privateBoard.revision, {
      store: {
        'shape:secret': {
          id: 'shape:secret', typeName: 'shape', type: 'text', parentId: 'page:page',
          index: 'a1', x: 0, y: 0, rotation: 0, isLocked: false, opacity: 1,
          props: { text: secret },
        },
      },
    })

    const ownerDirect = await testApp.app.inject({
      method: 'GET', url: `/api/boards/${privateBoard.id}`, headers: { cookie: ownerCookie },
    })
    expect(ownerDirect.statusCode).toBe(200)
    expect(JSON.stringify(ownerDirect.json())).toContain(secret)

    const ownerRootDirect = await testApp.app.inject({
      method: 'GET', url: `/api/boards/${rootBoard.id}`, headers: { cookie: ownerCookie },
    })
    expect(ownerRootDirect.statusCode).toBe(200)
    expect(ownerRootDirect.json().snapshotAccess).toBe('full')
    expect(JSON.stringify(ownerRootDirect.json())).toContain(privateBoard.id)

    const memberRootDirect = await testApp.app.inject({
      method: 'GET', url: `/api/boards/${rootBoard.id}`, headers: { cookie: memberCookie },
    })
    expect(memberRootDirect.statusCode).toBe(200)
    expect(memberRootDirect.json().snapshotAccess).toBe('projected')
    expect(JSON.stringify(memberRootDirect.json())).not.toContain(privateBoard.id)

    const memberRootSnapshot = await testApp.app.inject({
      method: 'GET', url: `/api/boards/${rootBoard.id}/snapshot`, headers: { cookie: memberCookie },
    })
    expect(memberRootSnapshot.statusCode).toBe(200)
    expect(memberRootSnapshot.json()).toMatchObject({
      revision: rootBoard.revision,
      snapshotAccess: 'projected',
    })

    const projectedSnapshotSave = await testApp.app.inject({
      method: 'PUT',
      url: `/api/boards/${rootBoard.id}/snapshot`,
      headers: { cookie: memberCookie },
      payload: {
        expectedRevision: memberRootSnapshot.json().revision,
        snapshot: memberRootSnapshot.json().snapshot,
      },
    })
    expect(projectedSnapshotSave.statusCode).toBe(403)
    expect(projectedSnapshotSave.json()).toEqual({ code: 'BOARD_SNAPSHOT_PROJECTED_READ_ONLY' })

    const projectedReferenceCreate = await testApp.app.inject({
      method: 'POST',
      url: `/api/boards/${rootBoard.id}/references`,
      headers: { cookie: memberCookie },
      payload: {
        targetBoardId: publicBoard.id,
        shapeId: 'shape:member-public-reference',
        kind: 'embed',
        expectedRevision: rootBoard.revision,
      },
    })
    expect(projectedReferenceCreate.statusCode).toBe(403)
    expect(projectedReferenceCreate.json()).toEqual({ code: 'BOARD_SNAPSHOT_PROJECTED_READ_ONLY' })
    expect(JSON.stringify(boards.get(rootBoard.id)?.tldrawSnapshot)).toContain(privateBoard.id)

    const ownerAggregate = await testApp.app.inject({
      method: 'GET', url: `/api/projects/${projectId}`, headers: { cookie: ownerCookie },
    })
    const ownerPrivatePlaceholder = ownerAggregate.json().boards.find((board: { id: string }) => board.id === privateBoard.id)
    expect(ownerPrivatePlaceholder).toMatchObject({ snapshotAccess: 'redacted', tldrawSnapshot: { store: {} } })
    expect(JSON.stringify(ownerAggregate.json())).not.toContain(secret)

    const memberAggregate = await testApp.app.inject({
      method: 'GET', url: `/api/projects/${projectId}`, headers: { cookie: memberCookie },
    })
    expect(memberAggregate.statusCode).toBe(200)
    expect(JSON.stringify(memberAggregate.json())).not.toContain('心态')
    expect(JSON.stringify(memberAggregate.json())).not.toContain(secret)
    expect(memberAggregate.json().boards.map((board: { id: string }) => board.id)).toContain(publicBoard.id)

    const memberProjectList = await testApp.app.inject({
      method: 'GET', url: '/api/projects', headers: { cookie: memberCookie },
    })
    expect(JSON.stringify(memberProjectList.json())).not.toContain('心态')
    expect((await testApp.app.inject({
      method: 'GET', url: `/api/boards/${publicBoard.id}`, headers: { cookie: memberCookie },
    })).statusCode).toBe(200)

    for (const url of [
      `/api/boards/${privateBoard.id}`,
      `/api/boards/${privateBoard.id}/snapshot`,
      `/api/boards/${privateBoard.id}/comment-state`,
      `/api/boards/${privateBoard.id}/comments`,
    ]) {
      const response = await testApp.app.inject({ method: 'GET', url, headers: { cookie: memberCookie } })
      expect(response.statusCode, url).toBe(403)
      expect(response.json()).toMatchObject({ code: 'BOARD_ACCESS_DENIED' })
    }
    expect((await testApp.app.inject({
      method: 'POST', url: `/api/boards/${privateBoard.id}/export.pdf`, headers: { cookie: memberCookie },
    })).statusCode).toBe(403)

    const comment = await testApp.app.inject({
      method: 'POST',
      url: `/api/boards/${privateBoard.id}/comments`,
      headers: { cookie: ownerCookie },
      payload: { body: 'owner-only comment' },
    })
    expect(comment.statusCode).toBe(201)
    expect((await testApp.app.inject({
      method: 'GET',
      url: `/api/comment-threads/${comment.json().thread.id}/messages`,
      headers: { cookie: memberCookie },
    })).statusCode).toBe(403)

    const publicComment = await testApp.app.inject({
      method: 'POST',
      url: `/api/boards/${publicBoard.id}/comments`,
      headers: { cookie: ownerCookie },
      payload: { body: 'owner public comment' },
    })
    const memberDeletesOwnerThread = await testApp.app.inject({
      method: 'DELETE',
      url: `/api/comment-threads/${publicComment.json().thread.id}`,
      headers: { cookie: memberCookie },
    })
    expect(memberDeletesOwnerThread.statusCode).toBe(403)
    expect(memberDeletesOwnerThread.json()).toEqual({ code: 'COMMENT_THREAD_DELETE_FORBIDDEN' })
    expect((await testApp.app.inject({
      method: 'GET',
      url: `/api/audit?boardId=${privateBoard.id}`,
      headers: { cookie: memberCookie },
    })).statusCode).toBe(403)
    const memberAudit = await testApp.app.inject({
      method: 'GET', url: '/api/audit', headers: { cookie: memberCookie },
    })
    expect(JSON.stringify(memberAudit.json())).not.toContain(privateBoard.id)

    const storedAsset = new AssetRepository(testApp.database, assetDirectory).materializeForBoard({
      projectId,
      boardId: privateBoard.id,
      shapeId: 'shape:secret-asset',
      assetRecordId: 'asset:secret',
      bytes: createPngFixture(),
      mime: 'image/png',
      createdAt: new Date().toISOString(),
    })
    expect((await testApp.app.inject({
      method: 'GET', url: `/api/assets/${storedAsset.sha256}`, headers: { cookie: ownerCookie },
    })).statusCode).toBe(200)
    expect((await testApp.app.inject({
      method: 'GET', url: `/api/assets/${storedAsset.sha256}`, headers: { cookie: memberCookie },
    })).statusCode).toBe(403)

    const unboundUpload = await testApp.app.inject({
      method: 'POST',
      url: '/api/assets',
      headers: { cookie: ownerCookie },
      payload: { mime: 'image/png', base64: Buffer.from(createPngFixture(2, 1)).toString('base64') },
    })
    const unboundHash = unboundUpload.json().sha256 as string
    expect(unboundUpload.statusCode).toBe(201)
    expect((await testApp.app.inject({
      method: 'GET', url: `/api/assets/${unboundHash}`, headers: { cookie: ownerCookie },
    })).statusCode).toBe(200)
    expect((await testApp.app.inject({
      method: 'GET', url: `/api/assets/${unboundHash}`, headers: { cookie: memberCookie },
    })).statusCode).toBe(403)
    expect((await testApp.app.inject({
      method: 'DELETE', url: `/api/assets/${unboundHash}`, headers: { cookie: memberCookie },
    })).statusCode).toBe(403)
    expect((await testApp.app.inject({
      method: 'DELETE', url: `/api/assets/${unboundHash}`, headers: { cookie: ownerCookie },
    })).statusCode).toBe(204)

    const clipboard = await testApp.app.inject({
      method: 'POST',
      url: `/api/boards/${publicBoard.id}/clipboard/paste`,
      headers: { cookie: memberCookie },
      payload: {
        payload: {
          version: 1,
          sourceProjectId: projectId,
          sourceBoardId: privateBoard.id,
          shapes: [], bindings: [], references: [], assets: [],
          copiedAt: new Date().toISOString(),
        },
        expectedRevision: publicBoard.revision,
        sessionId: 'privacy-test-session',
        placement: { viewportCenter: true },
      },
    })
    expect(clipboard.statusCode).toBe(403)

    const memberReferences = await testApp.app.inject({
      method: 'GET',
      url: `/api/boards/${rootBoard.id}/references?direction=outbound`,
      headers: { cookie: memberCookie },
    })
    expect(memberReferences.statusCode).toBe(200)
    expect(memberReferences.json().map((reference: { targetBoardId: string }) => reference.targetBoardId))
      .not.toContain(privateBoard.id)
    const privateReference = created.json().references.find((reference: { targetBoardId: string }) => (
      reference.targetBoardId === privateBoard.id
    ))
    const memberDeletesPrivateReference = await testApp.app.inject({
      method: 'DELETE',
      url: `/api/references/${privateReference.id}`,
      headers: { cookie: memberCookie },
      payload: { expectedRevision: rootBoard.revision },
    })
    expect(memberDeletesPrivateReference.statusCode).toBe(403)
    expect(memberDeletesPrivateReference.json()).toEqual({ code: 'BOARD_ACCESS_DENIED' })

    for (const cookie of [ownerCookie, memberCookie]) {
      const exported = await testApp.app.inject({
        method: 'GET', url: `/api/projects/${projectId}/export.iboard`, headers: { cookie },
      })
      expect(exported.statusCode).toBe(200)
      const decoded = decodeIboard(new Uint8Array(exported.rawPayload))
      expect(decoded.boards.map((board) => board.id)).not.toContain(privateBoard.id)
      expect(JSON.stringify(decoded)).not.toContain(secret)
      expect(decoded.assets.map((asset) => asset.sha256)).not.toContain(storedAsset.sha256)
    }

    const memberWorkspace = await testApp.app.inject({
      method: 'PUT',
      url: '/api/bootstrap/personal-trading-workspace',
      headers: { cookie: memberCookie },
    })
    expect(memberWorkspace.statusCode).toBe(201)
    expect(memberWorkspace.json()).toMatchObject({
      status: 'created',
      project: { ownerOpenId: member.openId },
    })
    expect(memberWorkspace.json().project.id).not.toBe(projectId)
  })
})
