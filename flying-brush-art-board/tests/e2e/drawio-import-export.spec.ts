import { expect, test, type APIRequestContext, type Page } from './test.js'
import type { BoardReferenceRecord, StoredBoard } from '../../packages/board-core/src/index.js'

const API_BASE = 'http://localhost:8787'

interface ProjectState {
  boards: StoredBoard[]
  references: BoardReferenceRecord[]
}

async function readProject(request: APIRequestContext, projectId: string): Promise<ProjectState> {
  const response = await request.get(`${API_BASE}/api/projects/${encodeURIComponent(projectId)}`)
  expect(response.ok()).toBe(true)
  return response.json() as Promise<ProjectState>
}

function drawioXml(projectId: string, targetBoardId: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
  <mxfile><diagram><mxGraphModel><root>
    <mxCell id="0"/><mxCell id="1" parent="0"/>
    <mxCell id="normal" value="Decision" style="rhombus;fillColor=#fff2cc;" vertex="1" parent="1">
      <mxGeometry x="20" y="30" width="120" height="80" as="geometry"/>
    </mxCell>
    <mxCell id="reference-card" value="Target board" style="rounded=1;fillColor=#dae8fc;" vertex="1" parent="1"
      iboardReferenceId="reference-source" iboardTargetBoardId="${targetBoardId}"
      iboardReferenceKind="link" iboardProjectId="${projectId}"
      link="/projects/${projectId}/boards/${targetBoardId}">
      <mxGeometry x="180" y="30" width="280" height="140" as="geometry"/>
    </mxCell>
    <mxCell id="edge" edge="1" parent="1" source="normal" target="reference-card"
      style="edgeStyle=orthogonalEdgeStyle;exitX=1;exitY=0.5;entryX=0;entryY=0.5;">
      <mxGeometry relative="1" as="geometry"/>
    </mxCell>
  </root></mxGraphModel></diagram></mxfile>`
}

async function dropDrawio(
  page: Page,
  target: 'tab-strip' | 'canvas' | 'new-tab',
  fileName: string,
  xml: string,
): Promise<void> {
  if (target !== 'new-tab') {
    await page.evaluate(() => {
      const transfer = new DataTransfer()
      transfer.items.add(new File(['probe'], 'probe.drawio', { type: 'application/xml' }))
      window.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: transfer }))
    })
    await page.locator('.app-drop-overlay').waitFor({ state: 'visible' })
  }
  await page.evaluate(({ target, fileName, xml }) => {
    const transfer = new DataTransfer()
    transfer.items.add(new File([xml], fileName, { type: 'application/xml' }))
    const dropTarget = document.querySelector(`[data-drop-target="${target}"]`)
    if (!dropTarget) throw new Error(`Drop target ${target} was not rendered`)
    dropTarget.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }))
  }, { target, fileName, xml })
}

function snapshotStore(board: StoredBoard): Record<string, any> {
  const snapshot = board.tldrawSnapshot as {
    store?: Record<string, any>
    document?: { store?: Record<string, any> }
  }
  return snapshot.document?.store ?? snapshot.store ?? {}
}

test('imports draw.io into one new board from every structural drop target and exports current-board reference metadata', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000)
  const suffix = crypto.randomUUID()
  const projectId = `drawio-project-${suffix}`
  const rootBoardId = `drawio-root-${suffix}`
  const targetBoardId = `drawio-target-${suffix}`
  expect((await request.post(`${API_BASE}/api/projects`, {
    data: {
      id: projectId,
      title: 'Drawio project',
      rootBoard: { id: rootBoardId, title: 'Source board' },
    },
  })).ok()).toBe(true)
  expect((await request.post(`${API_BASE}/api/projects/${encodeURIComponent(projectId)}/boards`, {
    data: { id: targetBoardId, title: 'Target board' },
  })).ok()).toBe(true)

  const xml = drawioXml(projectId, targetBoardId)
  let exportedBoardId = ''
  for (const [index, target] of (['tab-strip', 'canvas', 'new-tab'] as const).entries()) {
    await page.goto(`/projects/${projectId}/boards/${rootBoardId}`)
    await expect(page.getByRole('heading', { name: 'Source board' })).toBeVisible()
    const before = await readProject(request, projectId)
    const importResponse = page.waitForResponse((response) =>
      response.url().endsWith(`/api/projects/${encodeURIComponent(projectId)}/boards/clipboard-import`)
      && response.request().method() === 'POST')
    await dropDrawio(page, target, `Architecture-${index + 1}.drawio`, xml)
    const response = await importResponse
    expect(response.status()).toBe(201)
    const importedResponse = await response.json() as {
      board: StoredBoard
      receipt: { createdReferenceIds: string[]; revision: number }
    }
    const created = importedResponse.board
    expect(importedResponse.receipt).toMatchObject({ revision: 1 })
    expect(importedResponse.receipt.createdReferenceIds).toHaveLength(1)
    await expect(page).toHaveURL(`/projects/${projectId}/boards/${encodeURIComponent(created.id)}`)

    const after = await readProject(request, projectId)
    expect(after.boards).toHaveLength(before.boards.length + 1)
    expect(after.references).toHaveLength(before.references.length + 1)
    const imported = after.boards.find((board) => board.id === created.id)!
    const outbound = after.references.filter((reference) => reference.sourceBoardId === imported.id)
    expect(outbound).toEqual([
      expect.objectContaining({ targetBoardId, kind: 'link' }),
    ])
    const records = Object.values(snapshotStore(imported))
    expect(records.filter((record) => record.typeName === 'shape' && record.type === 'board-reference')).toEqual([
      expect.objectContaining({
        props: expect.objectContaining({
          referenceId: outbound[0]!.id,
          targetBoardId,
          kind: 'link',
        }),
      }),
    ])
    expect(records).toEqual(expect.arrayContaining([
      expect.objectContaining({ typeName: 'shape', type: 'geo' }),
      expect.objectContaining({ typeName: 'shape', type: 'arrow' }),
    ]))
    if (index === 0) exportedBoardId = imported.id
  }

  await page.goto(`/projects/${projectId}/boards/${exportedBoardId}`)
  await expect(page.getByRole('heading', { name: 'Architecture-1' })).toBeVisible()
  const state = await readProject(request, projectId)
  const actualReference = state.references.find((reference) => reference.sourceBoardId === exportedBoardId)!
  await page.getByRole('button', { name: '导出', exact: true }).click()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: '导出 .drawio' }).click(),
  ])
  expect(download.suggestedFilename()).toBe('Architecture-1.drawio')
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  const exportedXml = Buffer.concat(chunks).toString('utf8')
  expect(exportedXml).toContain(`iboardReferenceId="${actualReference.id}"`)
  expect(exportedXml).toContain(`iboardTargetBoardId="${targetBoardId}"`)
  expect(exportedXml).toContain('iboardReferenceKind="link"')
  expect(exportedXml).toContain(`iboardProjectId="${projectId}"`)
  expect(exportedXml).toContain(`/projects/${projectId}/boards/${targetBoardId}`)
  expect(exportedXml).toContain('exitX=1')
  expect(exportedXml).toContain('entryY=0.5')
})
