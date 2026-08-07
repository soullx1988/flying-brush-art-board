# 飞书式无限画板 Implementation Plan

> **执行提示：** 按测试先行、实现、验证、复核的顺序完成每个 Task。是否使用任何额外工作流或子智能体由执行模型自行判断；当执行模型为 GPT-5.6 时，不得使用 Superpowers，详见项目根目录 `AGENTS.md`。

**Status:** 已按多对多画板引用、顶部标签、跨 Board 剪贴板、开发环境先行和飞书真实授权延期门禁修订
**Design Spec:** [飞书式无限画板设计规格](../specs/2026-07-22-feishu-style-infinite-whiteboard-design.md)

**Goal:** 构建一个个人本地使用的飞书式无限画板，支持基础编辑、Board 之间的多对多 `embed`/`link` 引用、应用内浏览器式 Board 标签、同一 Board 多标签的单写租约、跨 Board 原子复制粘贴、本地文件拖拽创建 Board、沿实际访问路径返回、`.iboard` 完整 merge 当前 Project、draw.io 与视觉格式导入导出，以及飞书 Board OpenAPI 结构化导入。跨 Project 的引用粘贴必须降级为普通视觉卡片。

**Architecture:** 使用 React + tldraw 作为编辑器，Fastify 作为只监听 loopback 的本地服务，SQLite 和本地内容寻址目录保存数据。tldraw snapshot 是画布几何、样式和视觉内容的持久化真源；`board_references` 是 Board 关系语义的唯一真源；引用记录与来源 snapshot 中的 `board-reference` Shape 通过事务保持一一对应。应用内标签是独立导航会话，每个窗口只挂载一个活动 editor，并在首次可变更输入前取得 `(projectId, boardId)` 写租约。所有跨 Board paste/undo/redo 通过服务端命令原子维护 snapshot、资源关系和可选引用 edge；跨 Project 引用只生成清除结构字段的视觉卡片。剪贴板和标签草稿是非持久化会话状态。所有 Board 直接属于 Project，`rootBoardId` 只表示项目默认入口。InteropScene 只用于导入导出。

**Tech Stack:** Node.js `>=22.13 <23`、pnpm `11.9.0`、TypeScript `5.9.3`、React/ReactDOM `19.2.1`、Vite `8.1.5`、tldraw `5.2.5`、Fastify `5.10.0`、SQLite、better-sqlite3 `13.0.1`、Drizzle ORM `0.45.2`、Drizzle Kit `0.31.10`、Zod `4.4.3`、Vitest `4.1.10`、React Testing Library `16.3.2`、Playwright `1.61.1`、fast-xml-parser `5.10.1`、fflate `0.8.3`、pdfjs-dist `6.1.200`、PDFKit `0.19.1`、SVG-to-PDFKit `0.1.8`。

## Public Contracts

```ts
export type BoardReferenceKind = 'embed' | 'link'

export interface ProjectRecord {
  id: string
  title: string
  rootBoardId: string
  formatVersion: number
  createdAt: string
  updatedAt: string
}

export interface StoredBoard {
  id: string
  projectId: string
  title: string
  tldrawSnapshot: unknown
  sourceMetadata?: ImportSource
  revision: number
  createdAt: string
  updatedAt: string
}

export interface BoardReferenceRecord {
  id: string
  projectId: string
  sourceBoardId: string
  targetBoardId: string
  shapeId: string
  kind: 'embed' | 'link'
  createdAt: string
  updatedAt: string
}

export interface BoardHistoryEntry {
  entryId: string
  projectId: string
  boardId: string
  via?: {
    referenceId: string
    sourceBoardId: string
    targetBoardId: string
    shapeId: string
    kind: 'embed' | 'link'
  }
  viewState: {
    camera: unknown
    selectedShapeIds: string[]
    currentToolId: string
  }
}

export interface BoardTabSession {
  tabId: string
  projectId: string
  history: BoardHistoryEntry[]
  historyIndex: number
  lastKnownRevision: number
  pendingSnapshot?: unknown
  status: 'loading' | 'clean' | 'dirty' | 'saving' | 'error'
}

export interface BoardClipboardPayload {
  version: 1
  sourceProjectId: string
  sourceBoardId: string
  shapes: unknown[]
  bindings: unknown[]
  references: CopiedBoardReference[]
  assets: ClipboardAsset[]
  copiedAt: string
}

export interface CopiedBoardReference {
  shapeId: string
  referenceId: string
  targetBoardId: string
  kind: 'embed' | 'link'
}

export interface ClipboardAsset {
  assetRecordId: string
  sha256: string
  mime: string
  size: number
  /** Serialized tldraw asset record required to recreate this resource. */
  record: Record<string, unknown>
  sourceUrl?: string
}

export interface BoardEditingLease {
  projectId: string
  boardId: string
  holderTabId: string
}

export interface ClipboardCommandResult {
  commandId: string
  boardId: string
  revision: number
  snapshot: unknown
  idMap: Record<string, string>
  createdReferenceIds: string[]
}

export interface ClipboardPasteRequest {
  payload: BoardClipboardPayload
  expectedRevision: number
  placement: { x: number; y: number } | { viewportCenter: true }
}

export interface ClipboardCommandReplayRequest {
  expectedRevision: number
}

export interface IboardMergeCommitRequest {
  sessionId: string
  targetProjectId: string
  mode: 'merge'
  openImportedRootInNewTab: true
}

export interface IboardMergeCommitResult {
  targetProjectId: string
  importedRootBoardId: string
  importedBoardIds: string[]
  importedReferenceIds: string[]
  importedBoardCount: number
  importedReferenceCount: number
}
```

引用 HTTP API：

```text
POST   /api/boards/:sourceBoardId/references
GET    /api/boards/:boardId/references?direction=inbound|outbound
PATCH  /api/references/:referenceId
DELETE /api/references/:referenceId
POST   /api/boards/:boardId/clipboard/paste
POST   /api/boards/:boardId/clipboard/pastes/:commandId/undo
POST   /api/boards/:boardId/clipboard/pastes/:commandId/redo
```

删除存在入站引用的 Board 返回 HTTP 409：

```ts
{
  code: 'BOARD_REFERENCED'
  inboundReferences: BoardReferenceRecord[]
}
```

直接删除当前默认入口 Board 返回 HTTP 409：

```ts
{
  code: 'ROOT_BOARD_DELETE_FORBIDDEN'
  projectId: string
  rootBoardId: string
}
```

稳定错误码至少包括：`BOARD_REFERENCED`、`ROOT_BOARD_DELETE_FORBIDDEN`、`BOARD_EDIT_LEASED`、`REVISION_CONFLICT`、`BOARD_REFERENCE_COMMAND_REQUIRED`、`CLIPBOARD_FORMAT_UNSUPPORTED`、`CLIPBOARD_REFERENCE_INVALID`、`CLIPBOARD_COMMAND_EXPIRED`、`STALE_CLIPBOARD_COMMAND`、`ASSET_HASH_METADATA_MISMATCH`、`NO_ACTIVE_BOARD`、`DROP_TARGET_UNSUPPORTED`、`TLDR_SCHEMA_UNSUPPORTED` 和 `IBOARD_MERGE_FAILED`。

## Reference Graph Invariants

1. 每个 Board 直接属于一个 Project；引用的 `projectId`、来源 Board 和目标 Board 必须属于同一 Project。
2. `rootBoardId` 只是默认入口，可以有入站引用；它不表示引用图的唯一根节点。
3. `embed` 子图必须是 DAG。最长路径最多包含 10 个 Board 节点，即最多 9 条连续 `embed` edge；形成第 11 个 Board 层级时拒绝。
4. `link` 不参与嵌套目录、cycle check 或深度计算，允许重复、允许自引用，也允许任意循环。
5. 同一来源和目标之间允许存在多条引用；引用 ID 必须唯一，`(sourceBoardId, shapeId)` 必须唯一。
6. 每条 `board_references` 记录在来源 snapshot 中恰好对应一个同 `shapeId` 的 `board-reference` Shape；`referenceId`、`targetBoardId` 和 `kind` 必须一致。
7. 普通 autosave 可以保存 Shape 的位置、尺寸和视觉样式，但不能新增、删除引用，不能改写 `referenceId`、`targetBoardId` 或 `kind`。
8. 删除引用只删除 edge 和对应 Shape，不删除目标 Board。
9. Board 存在任意 `embed` 或 `link` 入站引用时拒绝删除。删除无入站引用的非默认入口 Board 时，只级联清理它的出站引用记录；目标 Board 保留。
10. 当前 `rootBoardId` 不可直接删除；必须先选择另一个默认入口。
11. 项目整体删除是显式操作，可以在同一事务中删除项目内全部 Board、引用和资源关系。
12. 标签 ID 与 Board ID 相互独立；同一 Board 只有显式“在新标签打开”才创建第二个会话实例。
13. 每个标签拥有独立 history、视口和草稿；任何时刻只挂载活动标签的 tldraw editor。
14. 标签在首次可能修改 Board 的输入生效前原子取得应用内编辑租约；未持有租约的同 Board 标签只读，revision CAS 仍是跨窗口和异常恢复的最终防线。
15. 普通元素跨 Board 粘贴生成新 Shape/asset/binding ID；所有跨 Board paste/undo/redo 经过服务端原子命令，引用 Shape 额外原子维护 reference row。
16. `.iboard` merge 始终重映射全部输入 ID，完整导入 Board、引用和资源，并保持目标 Project 的 `rootBoardId` 不变。

## Global Constraints

- 首期只支持单人本地使用，不实现 WebSocket、Yjs、CRDT、在线分享或用户权限系统。
- Fastify 只监听 `127.0.0.1:8787`。
- 开发和 CI 固定使用 Node.js `>=22.13 <23` 与 pnpm `11.9.0`；关键框架版本按 Tech Stack 锁定，升级必须单独验证。
- tldraw 固定为 `5.2.5`；升级必须单独执行 snapshot 迁移和回归测试。
- tldraw 先在 localhost 开发；Hobby License 申请并行进行。在正式日常使用或生产化前必须取得适用的 Hobby、Trial、Commercial License 或书面许可结论。
- 飞书导入使用 `user_access_token` 和官方 OpenAPI，不使用 Cookie 或私有接口。
- 飞书首期 scope：`board:whiteboard:node:read`、`docx:document:readonly`、`wiki:node:retrieve`、`docs:document.media:download`、`offline_access`。
- 飞书真实授权状态在用户完成账号授权前记录为 `pending-user-authorization`；该状态不阻塞 Task 4–24 的开发、构建、mock 合同测试和常规回归。
- 默认 `pnpm test`、`pnpm e2e` 和 CI 不读取真实飞书凭据，也不得访问飞书网络；mock/合同测试由 `pnpm test:feishu` 运行。
- 真实飞书 smoke 与 E2E 只允许在本机串行执行，并分别由 `pnpm smoke:feishu:real`、`pnpm e2e:feishu:real` 启动。只有 `FEISHU_REAL_SMOKE=1` 且本机 `.env.local` 凭据齐全时才访问真实 API；否则输出 `SKIPPED: awaiting user authorization` 并以成功状态退出。
- 真实响应、token、用户内容和未匿名化预览不得进入 Git；只有经过人工检查的匿名 fixture 才能提交。
- `.iboard` 是唯一承诺 100% 无损往返的工程格式；首个未发布格式直接定义为 `formatVersion: 1`。
- `.tldr` 只作为单 Board 结构化导入格式，不承诺保存项目引用图；由于没有项目级引用表，所有引用 Shape 必须清除结构字段并降级，不能按同 ID 猜测恢复。
- `.iboard` 原始 ZIP 上传上限为 256 MiB；解压上限为 1000 个文件、512 MiB 总大小、100 MiB 单文件。768 MiB 明确定义为“已创建且持久保留的 import sessions 逻辑 payload 聚合额度”：每个兼容 session 按 `原始 archive 字节 + ZIP central directory 声明的 uncompressed 字节` 计费。每次 inspect 必须先按该逻辑占用清理或淘汰旧 session、确认额度后再执行一次实际解包与解码，不得用巨大 `JSON.stringify` 临时副本事后计量。该数字不是 Node 进程 RSS 或峰值工作集硬上限，不包含 Fastify 请求体进入 store 前的缓冲、解压/UTF-8/`JSON.parse` 瞬时工作集及 V8 对象开销；部署时进程或容器 memory limit 必须高于 768 MiB 并为解析留出余量。超大文件若要获得真正固定的峰值上限，需要未来实现流式接收与逐 entry 解析，不属于 Task 15。`embed` 图最多 10 个 Board 节点深度，`link` 循环不触发深度错误。
- 第一版不做 PostgreSQL、Redis、S3、独立 Worker、Electron/Tauri、评论、模板中心、Mermaid、PlantUML 和飞书写回。
- 所有 TypeScript 开启 `strict`，所有外部输入通过 Zod 或明确解析器校验。
- 所有关系变更只通过引用事务 API 完成；普通 snapshot 保存是最终防线。
- 标签栏是应用内会话 UI，不使用浏览器原生多窗口代替；标签切换不得创建多个隐藏 tldraw store。
- 跨 Board 剪贴板只使用公开 tldraw/浏览器能力和应用内 payload，不实现飞书私有剪贴板协议。
- 标签在首次可变更输入前必须取得 `(projectId, boardId)` 写租约；跨 Project 的 `board-reference` 必须清除结构字段并降级，不能产生 edge。
- `.iboard` 导入只采用 `mode: 'merge'` 合并当前 Project；拖放只能先 inspect，显式确认后才能 commit，且不得覆盖目标 `rootBoardId`。
- 每个任务执行测试先行；项目在 Task 1 初始化 Git `main` 分支，随后按 Task 独立提交。

---

## 阶段总览

| 阶段 | 交付物 | 估算 |
|---|---|---:|
| 0 | 开发环境、tldraw 许可 ADR、飞书 mock 合同和延期授权门禁 | 4–6 人日 |
| 1 | 引用图/剪贴板领域模型、SQLite 和本地 API | 5–9 人日 |
| 2 | 多 Board 标签、自动保存和跨 Board 普通元素剪贴板 | 11–16 人日 |
| 3 | 画板引用、原子引用粘贴、路径导航与视口恢复 | 9–14 人日 |
| 4 | `.iboard` 引用图无损往返与 merge | 8–11 人日 |
| 5 | `.tldr`、draw.io、拖拽视觉导入和 PNG/SVG/PDF 导出 | 12–19 人日 |
| 6 | 飞书 OAuth 与结构化导入 | 9–13 人日 |
| 7 | 备份、性能、安全和发布文档 | 5–8 人日 |

总估算：63–96 人日，单人全职约 13–20 周。

## 目标文件结构

```text
apps/
  web/
    src/
      app/
      features/canvas/
      features/boards/
      features/board-tabs/
      features/board-references/
      features/clipboard/
      features/import-export/
      features/feishu/
      lib/
  local-api/
    src/
      db/
      modules/projects/
      modules/boards/
      modules/board-references/
      modules/clipboard/
      modules/assets/
      modules/feishu/
      modules/files/
packages/
  board-core/
  tldraw-adapter/
  interop/
  test-fixtures/
tests/
  e2e/
docs/
  adr/
  superpowers/
```

## 执行约定

- 每个 Task 先写失败测试，再完成最小实现，最后运行相关包测试、`pnpm typecheck` 和必要的 E2E。
- 引用图校验函数在领域层保持纯函数；HTTP、SQLite、tldraw 操作只做编排。
- 所有 ID 重映射、文件解压和外部 API 响应都在提交数据库前完成预检。
- 涉及 snapshot 与引用记录的写入必须使用同一个 SQLite transaction 和来源 Board revision CAS。
- 含引用的剪贴板 paste/undo/redo 是应用级结构命令，不得只操作 tldraw 本地 undo stack。
- `.iboard` merge 在预检后一次性提交到目标 Project，当前默认入口不可被导入包覆盖。
- 任务完成条件以“测试通过且退出条件满足”为准，不能用手工演示替代自动化验证。

---

# 阶段 0：开发环境与延期授权门禁

### Task 1: 初始化 Git、pnpm workspace 和应用骨架

**Files**

- Create: `package.json`、`pnpm-workspace.yaml`、`tsconfig.base.json`、`tsconfig.tests.json`、`vitest.config.ts`、`playwright.config.ts`
- Create: `apps/web/*`、`apps/local-api/*`
- Create: `packages/board-core/*`、`packages/tldraw-adapter/*`、`packages/interop/*`、`packages/test-fixtures/*`
- Create: `tests/preflight/*`、`tests/e2e/*`、`scripts/feishu-real-smoke.ts`
- Create: `.gitignore`、`.env.example`、`README.md`

**Interfaces**

- Produces: `pnpm dev`、`pnpm test`、`pnpm test:feishu`、`pnpm smoke:feishu:real`、`pnpm typecheck`、`pnpm build`、`pnpm e2e`、`pnpm e2e:feishu:real`。
- Produces: React/Vite 最小页面、Fastify `GET /health` 和只在显式开启时运行的飞书真实测试门禁。

**Tests first**

- [ ] React 页面可渲染，Fastify injection 返回健康状态。
- [ ] better-sqlite3 内存数据库可创建表并读写；React、tldraw、Fastify、Drizzle ORM 和 PDF.js 可在测试进程加载。
- [ ] Playwright 同时启动 Web/API，并验证页面与 `GET /health`。
- [ ] 默认飞书测试状态为 `SKIPPED: awaiting user authorization`，且测试不读取真实凭据、不访问飞书网络。

**Implementation**

- [ ] 执行 `git init -b main`，创建凭据、数据库、资源、构建产物、Playwright 产物和本地备份忽略规则。
- [ ] 固定 Node.js `>=22.13 <23`、pnpm `11.9.0` 和 Tech Stack 中的关键版本；pnpm `allowBuilds` 显式允许 esbuild，并显式禁止 better-sqlite3 的冗余 node-gyp 构建，因为 13.0.1 已内置目标平台预编译二进制，必须由 SQLite 加载测试验证。
- [ ] 创建严格 TypeScript、Vite、Vitest projects 与 Playwright 配置，以及四个 package 骨架。
- [ ] 创建 React/Vite 页面、Fastify health route 和本地 loopback 启动入口。
- [ ] `.env.example` 只列出 `VITE_TLDRAW_LICENSE_KEY`、`FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`FEISHU_REAL_SMOKE=0`，不写入真实值。
- [ ] tldraw 仅以 localhost 开发方式加载；许可证决策由 Task 2 记录。

**Verification**

```bash
pnpm install
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
pnpm e2e
pnpm smoke:feishu:real
pnpm e2e:feishu:real
```

默认飞书命令必须明确输出 `SKIPPED: awaiting user authorization`。环境验证通过后提交 `chore: bootstrap development workspace`，并暂停，等待目标模式从 Task 2 继续。

### Task 2: 记录画布内核和许可证决策

**Files**

- Create: `docs/adr/0001-canvas-engine-and-license.md`
- Modify: `.env.example`
- Test: `docs/adr/0001-canvas-engine-and-license.test.ts`

**Interfaces**

- Produces: Hobby、Trial、Commercial 或 Excalidraw 回退结论。
- Produces: `VITE_TLDRAW_LICENSE_KEY` 的本地配置约定。

**Steps**

- [ ] 写文档测试，要求 ADR 包含许可证类型、允许的运行方式、到期处理、品牌标识和回退触发条件。
- [ ] 对照 tldraw 5.2.5 许可证与当前自用场景填写 ADR；法律条款接受和付款仍由用户完成。
- [ ] 保持 localhost 开发可继续，Hobby License 申请并行进行；不把尚未取得 License Key 作为 Task 3–24 的开发阻塞项。
- [ ] 运行文档测试并人工复核链接有效性。

**Exit**

- ADR 可处于 `pending-user-license`，但必须明确：未取得可接受许可结论时禁止正式日常使用或生产化，并执行 ADR 中的 Excalidraw 回退决策。

### Task 3: 建立飞书 mock 合同与延期授权门禁

**Files**

- Create: `scripts/feishu-real-smoke.ts`
- Create: `packages/test-fixtures/src/feishu/mock/*`
- Create: `docs/adr/0002-feishu-scopes.md`
- Test: `scripts/feishu-real-smoke.test.ts`
- Test: `packages/test-fixtures/src/feishu/mock-contracts.test.ts`

**Interfaces**

- Produces: mock token、nodes、theme、preview、media download 合同和 `pending-user-authorization` 状态。
- Produces: `pnpm test:feishu`、`pnpm smoke:feishu:real`、`pnpm e2e:feishu:real` 的门禁约定。

**Tests first**

- [ ] mock provider 覆盖 token、nodes、theme、preview 与 media download 的成功、权限不足、过期和资源失败合同。
- [ ] `FEISHU_REAL_SMOKE` 缺失或不为 `1` 时，真实命令输出 `SKIPPED: awaiting user authorization` 并成功退出。
- [ ] 默认 `pnpm test`、`pnpm e2e` 和 CI 即使进程环境存在凭据也不读取凭据、不访问飞书网络。

**Implementation**

- [ ] ADR 记录预计 scope、mock 合同、真实验收步骤和状态 `pending-user-authorization`。
- [ ] 真实脚本只从本机 `.env.local` 读取 App ID、App Secret 和授权结果；不得回显或持久化敏感值。
- [ ] 真实 smoke 仅在 `FEISHU_REAL_SMOKE=1` 且凭据齐全时串行访问官方 API；节点、主题、预览和媒体响应必须先匿名化并人工检查。
- [ ] 不在本 Task 创建真实 fixture；授权后才允许新增 `real-board.anonymized.json` 与经检查的视觉基准。

**Exit**

- mock/合同测试全部通过，ADR 状态为 `pending-user-authorization`。未取得真实授权不阻塞 Task 4–24；真实失败只阻塞“飞书真实导入已验收”的声明。

---

# 阶段 1：本地基础设施与引用图

### Task 4: 定义 Project、Board 和引用图领域模型

**Files**

- Create: `packages/board-core/src/project.ts`
- Create: `packages/board-core/src/board.ts`
- Create: `packages/board-core/src/board-reference.ts`
- Create: `packages/board-core/src/board-reference-graph.ts`
- Create: `packages/board-core/src/clipboard.ts`
- Create: `packages/board-core/src/board-command.ts`
- Test: `packages/board-core/src/board-reference-graph.test.ts`
- Modify: `packages/board-core/src/index.ts`

**Interfaces**

- Produces: `ProjectRecord`、`StoredBoard`、`BoardReferenceRecord`。
- Produces: `assertBoardReferenceGraphValid(boards, references): void`。
- Produces: `assertCanCreateBoardReference(boards, references, candidate): void`。
- Produces: `getInboundBoardReferences(references, boardId)`。
- Produces: `getOutboundBoardReferences(references, boardId)`。
- Produces: `getMaxEmbedBoardLevels(boards, references): number`。
- Produces: `stableTopologicalBoardOrder(project, boards, references): string[]`。
- Produces: `assertBoardCanBeDeleted(project, references, boardId): void`，默认入口失败码固定为 `ROOT_BOARD_DELETE_FORBIDDEN`。
- Produces: `BoardClipboardPayload`、`CopiedBoardReference`、`ClipboardPasteRequest`、`ClipboardCommandReplayRequest`、`MaterializedClipboardPatch`、`ClipboardDowngradeReport` 和稳定剪贴板错误码；bindings 与引用候选不得隐式塞进 `shapes`。

**Materialized patch contract**

```ts
interface MaterializedClipboardPatch {
  nextSnapshot: unknown
  idMap: Record<string, string>
  assetBlobs: Array<{
    sha256: string
    mime: string
    size: number
    bytes: Uint8Array
  }>
  assetUsages: Array<{
    shapeId: string
    assetRecordId: string
    sha256: string
  }>
  referenceCandidates: CopiedBoardReference[]
}
```

**Tests first**

- [ ] A、B 同时 `embed` 指向 C 合法。
- [ ] 同一来源和目标可用不同引用 ID 与 Shape ID 建立多条引用。
- [ ] 缺失来源、缺失目标、跨项目、重复引用 ID、重复 `(sourceBoardId, shapeId)` 被拒绝。
- [ ] `embed` 自环和 A→B→A 环路被拒绝。
- [ ] 10 个 Board 节点的 `embed` 路径通过，加入第 11 个节点被拒绝。
- [ ] `link` 重复、自环、A→B→A 和更长循环均通过。
- [ ] `link` 不影响 `getMaxEmbedBoardLevels` 和拓扑排序。
- [ ] 稳定拓扑排序以 `rootBoardId` 为首选入口，同级按 Board ID，未连通 Board 也只出现一次。
- [ ] 同 Project 引用候选产生新 reference/Shape ID；跨 Project 候选生成视觉卡片降级计划且不产生 edge。
- [ ] 当前 `rootBoardId` 即使没有入站引用也返回 `ROOT_BOARD_DELETE_FORBIDDEN`；非默认入口再按入站引用规则判断。

**Implementation**

- [ ] 采用邻接表与 Kahn/DFS 实现 cycle、深度和稳定拓扑逻辑。
- [ ] 所有错误返回稳定错误码和可定位的 reference/board ID。
- [ ] 对 100 Board、1000 edge 建立领域层性能基线。

**Verification**

```bash
pnpm --filter @infinite-board/board-core test -- board-reference-graph.test.ts
pnpm --filter @infinite-board/board-core typecheck
```

### Task 5: 建立 SQLite schema 和 repository

**Files**

- Create: `apps/local-api/src/db/schema.ts`
- Create: `apps/local-api/src/db/migrations/0001_initial.sql`
- Create: `apps/local-api/src/modules/projects/project-repository.ts`
- Create: `apps/local-api/src/modules/boards/board-repository.ts`
- Create: `apps/local-api/src/modules/board-references/board-reference-repository.ts`
- Create: `apps/local-api/src/modules/assets/asset-repository.ts`
- Test: `apps/local-api/src/db/repositories.test.ts`

**Schema**

```sql
CREATE TABLE board_references (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  source_board_id TEXT NOT NULL,
  target_board_id TEXT NOT NULL,
  shape_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('embed', 'link')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (source_board_id, shape_id),
  FOREIGN KEY (project_id, source_board_id)
    REFERENCES boards(project_id, id) ON DELETE CASCADE,
  FOREIGN KEY (project_id, target_board_id)
    REFERENCES boards(project_id, id) ON DELETE RESTRICT
);
```

`boards` 同时声明 `UNIQUE(project_id, id)`，供复合外键保证同项目引用。建立：

- `idx_board_references_source` on `source_board_id`
- `idx_board_references_target` on `target_board_id`
- `idx_board_references_project_kind` on `(project_id, kind)`

`assets` 以 SHA-256 唯一保存 blob 元数据；`asset_usages` 保存 Project、Board、Shape、tldraw asset record ID 与 hash 的使用关系，并为 `(project_id, board_id)` 和 `sha256` 建索引。

**Interfaces**

- Produces: `ProjectRepository`、`BoardRepository`、`BoardReferenceRepository`。
- Produces: `AssetRepository.putByHash(bytes, metadata)` 和 `AssetUsageRepository`。
- Produces: `listByProject`、`listInbound`、`listOutbound`、`create`、`update`、`remove`、`hasInbound`。
- Produces: `saveSnapshot(boardId, expectedRevision, snapshot)` 和 `RevisionConflictError.currentRevision`。
- Produces: 按 SHA-256 幂等 materialize 资源、为目标 Project 建立资源关系并重映射 asset ID 的 repository 方法。

**Tests first**

- [ ] Project、Board、reference CRUD 和 revision CAS。
- [ ] 复合外键拒绝跨项目引用；target 外键拒绝 dangling。
- [ ] 删除来源 Board 会删除其出站引用记录，不删除目标 Board。
- [ ] 删除存在入站引用的 Board 被 service/repository transaction 拒绝。
- [ ] 当前默认入口不可直接删除并返回 `ROOT_BOARD_DELETE_FORBIDDEN`；切换默认入口后可按普通规则删除。
- [ ] 项目整体删除清理 Board 与 reference，不残留资源关系。
- [ ] 同一 hash 的跨 Board/跨 Project 资源只落一份内容文件；关系写入失败不留下可见半成品。

**Verification**

```bash
pnpm --filter @infinite-board/local-api test -- repositories.test.ts
pnpm --filter @infinite-board/local-api typecheck
```

### Task 6: 实现 Project、Board、引用查询、资源 API 和事务基座

**Files**

- Create: `apps/local-api/src/app.ts`
- Create: `apps/local-api/src/modules/projects/project-routes.ts`
- Create: `apps/local-api/src/modules/boards/board-routes.ts`
- Create: `apps/local-api/src/modules/board-references/board-reference-routes.ts`
- Create: `apps/local-api/src/modules/board-references/board-reference-contracts.ts`
- Create: `apps/local-api/src/modules/board-references/board-reference-service.ts`
- Create: `apps/local-api/src/modules/clipboard/clipboard-command-service.ts`
- Create: `apps/local-api/src/modules/assets/asset-routes.ts`
- Test: `apps/local-api/src/app.test.ts`
- Test: `apps/local-api/src/modules/board-references/board-reference-routes.test.ts`
- Test: `apps/local-api/src/modules/clipboard/clipboard-command-service.test.ts`

**Interfaces**

- Produces: `buildApp(config): Promise<FastifyInstance>`。
- Produces: Project、Board、snapshot、asset API 和只读引用查询 API。
- Produces: Public Contracts 中引用 mutation 与剪贴板请求/响应的 Zod contracts，但本 Task 不注册依赖 tldraw snapshot 操作的 mutation 路由。
- Produces: `applyMaterializedClipboardCommand(boardId, expectedRevision, patch)`、undo/redo receipt、CAS 和普通 Shape/binding/asset 的原子事务基座；输入是已由 adapter materialize 的 patch，不在本 Task 解析 `BoardClipboardPayload`。
- `GET /api/projects/:projectId` 返回 `{ project, boards, references }`。
- `POST /api/projects/:projectId/boards` 只创建属于项目的 Board，不接受关系字段。

**API contracts and transaction base**

- `GET /api/boards/:boardId/references` 必须校验 `direction` 并返回完整 `BoardReferenceRecord[]`。
- `POST/PATCH/DELETE` 引用请求在本 Task 只完成 schema、错误响应和 service port 定义；Task 11 在 `board-reference` snapshot operations 可用后注册实际路由。
- Board 删除 API 对入站引用返回 `BOARD_REFERENCED`，对当前默认入口返回 `ROOT_BOARD_DELETE_FORBIDDEN`，两者均使用 Public Contracts 中的响应体。
- materialized clipboard service 根据 receipt 原子应用、逆用和重用 snapshot patch 与资源关系；receipt 仅服务当前应用会话，过期时返回 `CLIPBOARD_COMMAND_EXPIRED`。Task 9 接入普通 payload 路由，Task 11 再加入引用 Shape 与 edge。

**Tests first**

- [ ] 查询 inbound/outbound 可区分方向并包含 A、B→C 的两条记录。
- [ ] 删除有入站引用的 Board 返回准确的 `BOARD_REFERENCED` 响应体。
- [ ] 删除当前默认入口返回准确的 `ROOT_BOARD_DELETE_FORBIDDEN`、`projectId` 和 `rootBoardId`；切换默认入口后可按普通规则删除原入口。
- [ ] 使用合成的已 materialize patch 验证普通 Shape、binding 和 asset 的 apply/undo/redo 在 snapshot、asset relation 和 revision 上全部原子一致。
- [ ] `expectedRevision` 缺失或过期时拒绝命令，不覆盖较新 snapshot。
- [ ] patch、CAS 或资源写入失败时不留下部分事务结果。
- [ ] 非 loopback Host、非法 Zod 输入和超限资源上传被拒绝。

**Verification**

```bash
pnpm --filter @infinite-board/local-api test -- app.test.ts board-reference-routes.test.ts clipboard-command-service.test.ts
pnpm --filter @infinite-board/local-api typecheck
```

---

# 阶段 2：多 Board 标签与编辑 MVP

### Task 7: 集成 tldraw 并实现 snapshot 适配器

**Files**

- Create: `packages/tldraw-adapter/src/store.ts`
- Create: `packages/tldraw-adapter/src/snapshot.ts`
- Create: `packages/tldraw-adapter/src/migrations.ts`
- Create: `packages/tldraw-adapter/src/clipboard.ts`
- Create: `packages/tldraw-adapter/src/tldr-file.ts`
- Create: `apps/web/src/features/canvas/CanvasEditor.tsx`
- Test: `packages/tldraw-adapter/src/snapshot.test.ts`
- Test: `packages/tldraw-adapter/src/clipboard.test.ts`
- Test: `packages/tldraw-adapter/src/tldr-file.test.ts`
- Test: `apps/web/src/features/canvas/CanvasEditor.test.tsx`

**Interfaces**

- Produces: `loadSnapshotIntoStore(store, snapshot): void`。
- Produces: `getStoreSnapshot(store): unknown`。
- Produces: `createBoardStore(options?): TLStore`。
- Produces: `getTldrawLicenseKey(): string | undefined`。
- Produces: `collectClipboardPayload(editor, selectedShapeIds): BoardClipboardPayload`。
- Produces: `materializeClipboardPayload(payload, targetContext): MaterializedClipboardPatch`。
- Produces: `decodeTldrFile(bytes): TLEditorSnapshot`。

**Steps**

- [ ] 用空 snapshot、基础 Shape、资源与迁移 fixture 写失败测试。
- [ ] 注册固定 tldraw schema 与项目自定义 Shape migration。
- [ ] 实现加载、序列化和未知记录的明确失败策略。
- [ ] 计算复制选择的 Shape、Asset 和 Binding 闭包；仅当 binding 两端都被复制时保留，集合外 binding 断开并进入报告。
- [ ] 粘贴 materialization 为所有 Shape、Asset 和 Binding 生成目标作用域的新 ID，并保持集合内部引用一致。
- [ ] `.tldr` 使用固定 tldraw 5.2.5 schema 和 migration 解析；由于文件没有项目级引用表，任何 `board-reference` 都清除结构字段并降级为普通视觉卡片，不能按碰巧相同的 ID 恢复 edge。
- [ ] 将许可证 key 通过环境变量注入，不写入日志。
- [ ] 验证同一 snapshot 保存和重载后 record 集合一致。

### Task 8: 实现自动保存和版本冲突处理

**Files**

- Create: `apps/web/src/features/boards/board-session.ts`
- Create: `apps/web/src/features/boards/use-board-session.ts`
- Create: `apps/web/src/features/boards/SaveStatus.tsx`
- Create: `apps/web/src/features/board-tabs/workspace-tabs.ts`
- Create: `apps/web/src/features/board-tabs/editing-lease.ts`
- Create: `apps/web/src/features/board-tabs/use-workspace-tabs.ts`
- Test: `apps/web/src/features/boards/board-session.test.ts`
- Test: `apps/web/src/features/board-tabs/workspace-tabs.test.ts`
- Test: `apps/web/src/features/board-tabs/editing-lease.test.ts`
- Test: `tests/e2e/autosave.spec.ts`

**Interfaces**

- Produces: `BoardSession.mount(tabId, boardId, editor)`。
- Produces: `BoardSession.flush()`。
- Produces: `BoardSession.adoptServerCommit(snapshot, revision)`。
- Produces: `BoardSession.status`。
- Produces: `openBoardInCurrentTab(boardId)`、`openBoardInNewTab(boardId, source?)`、`activateTab(tabId)`、`closeTab(tabId)`。
- Produces: `acquireEditingLease(projectId, boardId, tabId)` 和 `releaseEditingLease(...)`；第一次可能修改 Board 的输入必须在应用到 editor 前调用 acquire。

**Tests first**

- [ ] 编辑后 800ms 防抖保存。
- [ ] 切换路由、关闭页面和进入引用目标前 flush。
- [ ] revision 冲突不覆盖服务器内容，提供重载或复制恢复路径。
- [ ] 离线失败保留内存 snapshot 并可重试。
- [ ] 引用 Shape 仅改变位置、尺寸或视觉样式时可自动保存。
- [ ] 标签切换时捕获 history/view、flush、序列化草稿并卸载旧 editor；DOM 中任何时刻只有一个 CanvasEditor。
- [ ] 非活动标签保留 `BoardTabSession` 和必要 snapshot，不保留隐藏 tldraw store。
- [ ] 同一 Board 的两个标签同时发起首次编辑时，只有一个能在输入生效前取得租约；失败者的输入不落入 editor，并立即只读且展示持有者。
- [ ] 激活同一 Board 的另一个标签前拉取 revision：clean 会话发现变化时丢弃旧 snapshot、adopt 权威 snapshot 后恢复 view；dirty owner 只允许 expected-revision flush，CAS 失败保留恢复副本。
- [ ] 关闭脏标签时提供保存、恢复副本和明确放弃，不静默丢弃 `pendingSnapshot`。

### Task 9: 完成多 Board 标签、基础编辑和拖放框架

**Files**

- Create: `apps/web/src/app/router.tsx`
- Create: `apps/web/src/features/boards/ProjectHomePage.tsx`
- Create: `apps/web/src/features/boards/BoardPage.tsx`
- Create: `apps/web/src/features/boards/BoardList.tsx`
- Create: `apps/web/src/features/boards/CreateBoardDialog.tsx`
- Create: `apps/web/src/features/board-tabs/WorkspaceShell.tsx`
- Create: `apps/web/src/features/board-tabs/BoardTabStrip.tsx`
- Create: `apps/web/src/features/board-tabs/TabOverflowMenu.tsx`
- Create: `apps/web/src/features/boards/AllBoardsPanel.tsx`
- Create: `apps/web/src/features/import-export/AppDropOverlay.tsx`
- Create: `apps/web/src/features/clipboard/clipboard-service.ts`
- Create: `apps/local-api/src/modules/clipboard/clipboard-command-routes.ts`
- Modify: `apps/local-api/src/app.ts`
- Test: `apps/web/src/features/boards/ProjectHomePage.test.tsx`
- Test: `apps/web/src/features/board-tabs/BoardTabStrip.test.tsx`
- Test: `apps/web/src/features/clipboard/clipboard-service.test.ts`
- Test: `apps/local-api/src/modules/clipboard/clipboard-command-routes.test.ts`
- Test: `tests/e2e/basic-editing.spec.ts`
- Test: `tests/e2e/board-tabs.spec.ts`
- Test: `tests/e2e/cross-board-clipboard.spec.ts`

**Interfaces**

- Produces: `/projects/:projectId` 和 `/projects/:projectId/boards/:boardId`。
- Produces: 基础图形、文字、便签、连线、手绘、图片、撤销和重做。
- Produces: “新建画板”“设为默认入口”“导入”入口。
- Produces: 顶部应用内 Board 标签栏、项目首页和“全部画板”面板。
- Produces: `Ctrl+Tab`、`Ctrl+Shift+Tab`、`Ctrl+W`、中键关闭、拖动排序和溢出菜单。
- Produces: 标签栏/“＋”与当前画布的不同文件投放目标。
- Produces: Public Contracts 中的 clipboard paste/undo/redo HTTP 路由；本 Task 接受 `references: []` 的普通跨 Board payload，Task 11 扩展同一路由处理引用候选。

**Steps**

- [ ] 项目首页列出全部 Board、默认入口标记和入站/出站引用数量，不渲染成单一路径目录。
- [ ] 顶部只展示已打开会话；普通打开复用当前标签，“在新标签打开”显式允许同一 Board 多实例。
- [ ] 每个标签独立显示标题、dirty/saving/error/read-only 状态；关闭最后一个 Board 标签返回项目首页。
- [ ] 剪贴板服务在 Board 标签切换后保留 `BoardClipboardPayload`，并在浏览器允许时同步系统剪贴板。
- [ ] 使用 Task 7 materialization 把普通 Shape 跨 Board payload 转为已 materialize patch，生成新 ID、保持内部分组/连接/binding 并复用同 hash 资源；Public API 再调用 Task 6 的事务基座完成 paste/undo/redo，来源 Board 不改变。
- [ ] 普通 clipboard route 的集成测试覆盖 payload schema、placement、revision CAS、资源去重和原子失败；`references` 非空时先返回 `BOARD_REFERENCE_COMMAND_REQUIRED` 且零修改，Task 11 再扩展同一分支并替换为引用事务测试。
- [ ] 拖入文件时显示标签栏与画布两个投放区域；本 Task 只建立 dispatcher/临时进度标签，格式解析由 Task 15–18 接入。
- [ ] 新建 Board 后可留在项目首页或打开该 Board。
- [ ] 默认入口切换使用事务 API，并影响项目首页的“进入默认画板”按钮。
- [ ] 完成键盘可达性、空状态、加载状态和保存状态。
- [ ] E2E 覆盖创建项目、创建 Board、绘制、刷新和恢复。

---

# 阶段 3：画板引用、路径导航与视口恢复

### Task 10: 实现引用图的纯领域变更规则

**Files**

- Create: `packages/board-core/src/commands/plan-create-board-reference.ts`
- Create: `packages/board-core/src/commands/plan-create-embedded-board.ts`
- Create: `packages/board-core/src/commands/plan-update-board-reference.ts`
- Create: `packages/board-core/src/commands/plan-remove-board-reference.ts`
- Create: `packages/board-core/src/commands/plan-delete-board.ts`
- Create: `packages/board-core/src/commands/plan-paste-board-clipboard.ts`
- Create: `packages/board-core/src/commands/plan-undo-board-command.ts`
- Create: `packages/board-core/src/commands/plan-redo-board-command.ts`
- Test: `packages/board-core/src/commands/board-reference-commands.test.ts`

**Interfaces**

- Produces: `planCreateBoardReference(input): CreateBoardReferencePlan`。
- Produces: `planCreateEmbeddedBoard(input): CreateEmbeddedBoardPlan`。
- Produces: `planUpdateBoardReference(input): UpdateBoardReferencePlan`。
- Produces: `planRemoveBoardReference(input): RemoveBoardReferencePlan`。
- Produces: `planDeleteBoard(input): DeleteBoardPlan`。
- Produces: `planPasteBoardClipboard(input): PasteBoardClipboardPlan`。
- Produces: `planUndoBoardCommand(input): UndoBoardCommandPlan` 和 `planRedoBoardCommand(input): RedoBoardCommandPlan`。

**Tests first**

- [ ] 多个来源可引用同一目标，同一来源和目标也可存在多条不同 edge。
- [ ] 创建或改为 `embed` 时执行 cycle 与 10 Board 节点限制。
- [ ] 创建或改为 `link` 时允许重复、自环和循环。
- [ ] 移除引用的计划只包含 edge 与 Shape 删除，不包含目标 Board 删除。
- [ ] 删除 Board 时，任意入站引用都生成 `BOARD_REFERENCED`；默认入口生成含 `projectId/rootBoardId` 的 `ROOT_BOARD_DELETE_FORBIDDEN`。
- [ ] 删除无入站引用的非默认入口 Board 只清理其出站 edge，所有目标 Board 保留。
- [ ] 同 Project 引用粘贴生成新的 reference/Shape ID 并复用原 target；跨 Project 产出视觉卡片降级计划。
- [ ] 任一 `embed` 候选成环或超深时整个 paste plan 失败，不返回部分 mutation；改为 `link` 后可重新规划。
- [ ] undo/redo 计划精确覆盖同一命令创建的普通 Shape、引用 Shape、edge 和资源关系。

**Implementation**

- [ ] 领域计划只描述预期变更和校验结果，不访问数据库或 tldraw。
- [ ] 所有命令复用 Task 4 的图校验器，避免 HTTP、导入器和 UI 各自实现一套规则。
- [ ] 错误码、消息和关联 ID 可直接映射为 API 响应与导入报告。

### Task 11: 实现 `board-reference` Shape、右键菜单和引用事务

**Files**

- Create: `packages/tldraw-adapter/src/shapes/board-reference/BoardReferenceShapeUtil.tsx`
- Create: `packages/tldraw-adapter/src/shapes/board-reference/schema.ts`
- Create: `packages/tldraw-adapter/src/shapes/board-reference/migrations.ts`
- Create: `packages/tldraw-adapter/src/board-reference-snapshot-operations.ts`
- Create: `packages/tldraw-adapter/src/board-reference-consistency.ts`
- Create: `packages/tldraw-adapter/src/clipboard-command-operations.ts`
- Create: `apps/web/src/features/board-references/BoardReferenceMenu.tsx`
- Create: `apps/web/src/features/board-references/CreateBoardReferenceDialog.tsx`
- Create: `apps/web/src/features/clipboard/clipboard-command-client.ts`
- Modify: `apps/local-api/src/modules/board-references/board-reference-routes.ts`
- Modify: `apps/local-api/src/modules/board-references/board-reference-service.ts`
- Modify: `apps/local-api/src/modules/clipboard/clipboard-command-routes.ts`
- Modify: `apps/local-api/src/modules/clipboard/clipboard-command-service.ts`
- Modify: `apps/local-api/src/app.ts`
- Test: `packages/tldraw-adapter/src/board-reference-consistency.test.ts`
- Test: `packages/tldraw-adapter/src/clipboard-command-operations.test.ts`
- Test: `apps/local-api/src/modules/board-references/board-reference-routes.test.ts`
- Test: `apps/local-api/src/modules/board-references/board-reference-service.test.ts`
- Test: `apps/local-api/src/modules/clipboard/clipboard-command-service.test.ts`
- Test: `tests/e2e/board-reference-menu.spec.ts`

**Shape props**

```ts
interface BoardReferenceProps {
  referenceId: string
  targetBoardId: string
  kind: 'embed' | 'link'
  titleFallback: string
  thumbnailAssetId?: string
}
```

**Menu actions**

- 进入画板。
- 新标签页打开。
- 重命名目标 Board。
- 切换 `embed`/`link`。
- 移除引用；文案明确“目标画板会保留”。

**Transaction rules**

- [ ] 注册 Task 6 已定义合同的 `POST /api/boards/:sourceBoardId/references`、`PATCH /api/references/:referenceId` 和 `DELETE /api/references/:referenceId`；所有请求携带来源 revision/CAS 所需字段并返回权威 snapshot/revision。
- [ ] 创建已有目标的引用：CAS 更新来源 snapshot，同时插入 `board_references`。
- [ ] 新建目标并引用：同一事务创建 Board、插入 edge、插入 Shape、更新来源 revision；任一步失败全部回滚。
- [ ] 修改目标或类型：先验证候选图，再同时更新 edge 与 Shape props。
- [ ] 删除引用：同时删除 edge 与来源 Shape；不触碰目标 Board。
- [ ] Board 标题是真源；引用卡片实时查询标题，`titleFallback` 允许过期，不批量改写所有来源 snapshot。
- [ ] 一致性校验器验证 edge/Shape 双射和语义字段相等。
- [ ] 普通 `PUT /api/boards/:boardId/snapshot` 比较旧、新引用语义集合；结构或语义变化返回 `BOARD_REFERENCE_COMMAND_REQUIRED`，纯几何与视觉变化继续保存。
- [ ] 扩展 Task 6 的剪贴板命令 service：含引用选择的 paste 先完成全部 ID remap 和图校验，再在一个事务中写入普通 Shape、引用 Shape、资源关系、reference row 和来源 revision。
- [ ] 服务端为 paste 返回 session-scoped `commandId`、权威 snapshot/revision、ID map 和引用 ID；前端通过 `adoptServerCommit` 更新活动 tab。
- [ ] undo/redo 重新进入服务端事务并批量逆用/重用同一 command receipt，不依赖 tldraw 本地 history 单独删除引用 Shape。
- [ ] 跨 Project 引用转换为矩形、标题和原 Board URL 组成的普通视觉卡片，同时返回降级报告。

**Tests first**

- [ ] 创建、修改类型、修改目标、删除引用均执行同项目、DAG、深度和 CAS 校验；`link` 循环成功，`embed` 环路和第 11 个 Board 层级返回 409。
- [ ] A、B 分别创建指向 C 的引用，C 只有一个 Board 记录。
- [ ] edge 写入失败、snapshot CAS 失败和新 Board 写入失败都不留下半成品。
- [ ] 普通 autosave 无法新增、删除或改写引用目标与类型。
- [ ] 删除一条引用后 C 仍存在，另一来源引用仍可用。
- [ ] Shape 与 edge 任一侧悬空或字段不一致时校验失败。
- [ ] 一次含普通 Shape、图片和引用的粘贴只产生一个应用命令；一次撤销全部移除，一次重做全部恢复。
- [ ] 资源写入、edge 写入、snapshot CAS、undo 或 redo 任一故障均不留下部分可见结果。
- [ ] 无效 `embed` 整批拒绝，用户选择转换为 `link` 后整批提交成功。
- [ ] 跨 Project 引用粘贴只产生清除结构字段的视觉卡片和降级报告，不产生 dangling reference。

### Task 12: 实现访问历史、动态面包屑、深链来源和视口恢复

**Files**

- Create: `apps/web/src/features/board-references/navigation-state.ts`
- Create: `apps/web/src/features/board-references/use-board-navigation.ts`
- Create: `apps/web/src/features/board-references/HistoryBreadcrumbs.tsx`
- Create: `apps/web/src/features/board-references/InboundReferenceList.tsx`
- Modify: `apps/web/src/features/board-tabs/workspace-tabs.ts`
- Test: `apps/web/src/features/board-references/navigation-state.test.ts`
- Test: `tests/e2e/board-reference-navigation.spec.ts`

**Interfaces**

- Produces: `enterReference(tabId, reference: BoardReferenceRecord, mode: 'current' | 'new-tab')`。
- Produces: `goBackAlongHistoryPath(tabId)`。
- Produces: `goToHistoryEntry(tabId, index: number)`。
- Produces: 每次访问的相机、选区、工具和引用入口快照。

**History entry**

使用 Public Contracts 中的 `BoardHistoryEntry`；同一标签内重复访问同一 Board 也必须生成新的 `entryId`，不能用 `boardId` 覆盖旧 entry。

**Behavior**

- [ ] 进入目标前 flush 来源 snapshot，并将来源视口与选区写入当前 history entry。
- [ ] history、historyIndex、面包屑和视口严格按 `tabId` 隔离；不能用 `boardId` 作为会话主键。
- [ ] “在新标签打开”用来源 entry 和目标 entry 初始化新标签，因此新标签内仍可沿实际来源返回。
- [ ] 面包屑只展示本次实际访问路径；`link` 循环可使同一 Board 在路径中重复出现。
- [ ] 返回按钮、浏览器 back、`Alt+Left` 和鼠标侧键都沿 history 返回并恢复来源状态。
- [ ] 点击历史面包屑跳到对应 history entry，不通过入站引用猜测路径。
- [ ] 裸 Board URL 或新标签页没有来源路径：页面显示全部入站引用位置；应用内返回按钮进入项目首页，项目首页可进入 `rootBoardId`。
- [ ] 可分享的路径参数必须逐 edge 校验；无效路径降级为裸深链，不伪造来源。
- [ ] 浏览器 history 只反映当前活动标签的当前导航；纯标签切换不把另一个标签的路径合并进来。
- [ ] `window.history.state` 只投影 `{ tabId, entryId, projectId, boardId }`；应用标签栈仍是权威 history。

**E2E**

- [ ] A→C 返回 A，B→C 返回 B，各自相机和选择准确恢复。
- [ ] 裸深链打开 C 展示 A、B 两个来源。
- [ ] `link` A→B→A 可导航和逐步返回。
- [ ] 10 个 Board 节点的 `embed` 路径可逐步进入，第 11 个层级在创建时被拒绝。
- [ ] 同一 Board 在两个标签中的 history、camera 和 selection 相互独立；只有活动标签存在 editor DOM。
- [ ] 一个标签保存失败并持有租约时，另一个同 Board 标签只读；恢复或放弃后可重新取得租约并加载最新 revision。

---

# 阶段 4：`.iboard` 无损工程包

### Task 13: 定义 `.iboard` v1 manifest、`references.json` 和导出器

**Files**

- Create: `packages/interop/src/iboard/schema-v1.ts`
- Create: `packages/interop/src/iboard/export-project.ts`
- Create: `packages/interop/src/iboard/archive-writer.ts`
- Create: `packages/test-fixtures/src/iboard/reference-graph-project.ts`
- Test: `packages/interop/src/iboard/export-project.test.ts`

**Archive**

```text
manifest.json
boards/{boardId}.json
references.json
assets/{sha256}
```

`manifest.json` 至少包含 `format`、`formatVersion: 1`、`projectId`、`title`、`rootBoardId`、`boards`、`referencesPath` 和 `assets`。每个 Board JSON 只保存标题、revision、sourceMetadata 和原始 tldraw snapshot；`references.json` 保存完整 `BoardReferenceRecord[]`。

**Steps**

- [ ] 用 A、B→C、`embed` 菱形图和 `link` 循环 fixture 写导出测试。
- [ ] 明确 `.iboard` 不导出 `BoardTabSession`、history、view、应用 undo/redo receipt、编辑租约或 `pendingSnapshot`。
- [ ] 导出前验证同项目、引用 ID、`(sourceBoardId, shapeId)`、edge/Shape 双射、`embed` DAG 和 10 Board 节点上限。
- [ ] 对 Board、reference 和 asset 使用稳定排序，保证相同项目重复导出的逻辑内容一致。
- [ ] 所有资源以 SHA-256 内容地址写入；manifest 记录大小、MIME 和 hash。
- [ ] `link` 重复、自环与循环按原样写出，不参与 DAG 错误。

**Verification**

```bash
pnpm --filter @infinite-board/interop test -- export-project.test.ts
```

### Task 14: 实现安全导入、图校验和 ID 重映射

**Files**

- Create: `packages/interop/src/iboard/archive-reader.ts`
- Create: `packages/interop/src/iboard/inspect-iboard.ts`
- Create: `packages/interop/src/iboard/id-remap.ts`
- Create: `packages/interop/src/iboard/migrations.ts`
- Create: `apps/local-api/src/modules/files/import-iboard-service.ts`
- Test: `packages/interop/src/iboard/import-iboard.test.ts`
- Test: `apps/local-api/src/modules/files/import-iboard-service.test.ts`

**Interfaces**

- Produces: `inspectIboard(bytes): ImportInspection`。
- Produces: `decodeIboard(bytes): DecodedIboardProject`。
- Produces: `commitIboardMerge(decoded, request: IboardMergeCommitRequest): Promise<IboardMergeCommitResult>`。

**Preflight**

- [ ] 拒绝 ZIP 路径穿越、文件数/大小超限、非法 manifest、hash 不符和未知强制字段。
- [ ] 校验所有 Board、reference、asset 存在性及 edge/Shape 双射。
- [ ] 拒绝 dangling、跨项目、重复引用 ID、重复 `(sourceBoardId, shapeId)`、`embed` 环和第 11 个 Board 层级。
- [ ] 接受 `link` 重复、自环和循环。
- [ ] 首个发布格式为 v1；迁移框架保留接口，但不为任何未发布的原型格式编写迁移。
- [ ] 先按源 manifest 校验源包内部同项目关系，再把整套图映射到目标 Project；源 Project ID 与目标 Project ID 不同不是错误。

**ID remap**

- [ ] 每次 merge 无条件重映射 Project、Board、reference、Page、Shape、Binding 和 tldraw asset record ID，即使当前不存在冲突。
- [ ] 同步重写 `references.json` 的 `projectId`、`sourceBoardId`、`targetBoardId`、`shapeId`。
- [ ] 同步重写 snapshot 中 `board-reference.props.referenceId`、`targetBoardId` 及 Shape ID。
- [ ] 对所有 schema-owned 指针执行类型感知重映射；SHA-256 内容 hash、外部来源 token 和 opaque `sourcePayload` 不做字符串替换。
- [ ] 重映射后再次运行与 Task 11 相同的双射校验器和 Task 4 图校验器。

**Commit**

- [ ] 目标 Project 必须已存在；保持其 `id`、`title`、`rootBoardId` 和 `formatVersion` 不变，把所有导入 Board 映射为目标 Project 成员。
- [ ] 先把资产写入幂等内容地址，再在单个 SQLite transaction 中写 Board、references 和 asset usage；相同 hash 复用已有 blob。
- [ ] 任意 Board/reference 写入失败时回滚数据库；未引用资产由安全清理任务回收。
- [ ] 故障注入覆盖资源 materialize、ID remap、第三个 Board、reference 和数据库 commit/CAS/约束失败，断言当前 Project、默认入口和可见 Board 均无变化。
- [ ] 同一 `.iboard` 连续 merge 两次产生两套独立 remap 图，不与第一次导入按源 ID 合并。
- [ ] merge 成功返回映射后的 `importedRootBoardId`；不自动从当前 Board 创建引用。

### Task 15: 完成 `.iboard` UI 和多来源往返 E2E

**Files**

- Create: `apps/web/src/features/import-export/IboardExportButton.tsx`
- Create: `apps/web/src/features/import-export/IboardImportWizard.tsx`
- Create: `apps/local-api/src/modules/files/iboard-routes.ts`
- Create: `apps/web/src/features/import-export/TemporaryImportTab.tsx`
- Create: `apps/web/src/features/import-export/DropImportController.ts`
- Create: `tests/e2e/iboard-roundtrip.spec.ts`
- Create: `tests/helpers/reference-graph-fixture.ts`

**Interfaces**

- Produces: `GET /api/projects/:projectId/export.iboard`。
- Produces: `POST /api/import/iboard/inspect`。
- Produces: `POST /api/import/iboard/commit`。
- Produces: `DELETE /api/import/sessions/:sessionId`。

`POST /api/import/iboard/commit` 接收：

```ts
{
  sessionId: string
  targetProjectId: string
  mode: 'merge'
  openImportedRootInNewTab: true
}
```

**Steps**

- [ ] 预检 UI 显示 Board 数、引用数、`embed` 最长 Board 层级、资源大小和兼容错误。
- [ ] `.iboard` 拖放状态机固定为 `drop → inspect session → 显示当前目标 Project 与兼容报告 → 用户显式确认 → commit`；确认前不写 Board、reference 或 `asset_usages`，取消、Escape 或关闭临时标签只清理 session。
- [ ] E2E fixture 至少包含 A、B→C、`embed` 菱形图、`link` A↔B、重复 source-target edge 和资源。
- [ ] 导出 fixture 后创建一个已存在的目标 Project，再以 `mode: 'merge'` 导入；排除目标原有 Board 后，按 ID map 比较导入子图的 Board 数、reference 数、每条 edge/Shape、目标、类型、资源 hash 和 snapshot 语义。
- [ ] 验证共享 Board 不因多条引用而复制。
- [ ] `.iboard` 拖到标签栏、画布或全局投放层都只启动同一 inspect/merge 管线；临时标签在确认前显示 inspect 结果，确认后才显示 commit 进度。
- [ ] merge 成功后保持当前 `rootBoardId`，用返回的 `importedRootBoardId` 显式创建新 `BoardTabSession`；其他 Board 只出现在“全部画板”。
- [ ] 打开导入入口标签失败不回滚已成功数据 merge，UI 提供“重新打开导入入口”；数据 commit 失败则不创建真实标签。
- [ ] E2E 强制制造全部源 ID 与当前 Project 冲突，验证全量 remap、引用双射、资源去重和当前标题/默认入口不变。
- [ ] E2E 连续导入同一包两次，验证两套独立图和两个导入入口标签。
- [ ] E2E 验证拖放后未确认时数据库零新增；取消不改变当前 Project，确认成功后才创建导入入口标签。

---

# 阶段 5：通用导入导出

### Task 16: 定义 InteropScene 和 tldraw 转换

**Files**

- Create: `packages/interop/src/scene/schema.ts`
- Create: `packages/interop/src/scene/compatibility-report.ts`
- Create: `packages/tldraw-adapter/src/interop/to-snapshot.ts`
- Create: `packages/tldraw-adapter/src/interop/from-snapshot.ts`
- Create: `packages/interop/src/tldraw/import-tldr.ts`
- Modify: `apps/web/src/features/import-export/DropImportController.ts`
- Test: `packages/tldraw-adapter/src/interop/roundtrip.test.ts`
- Test: `packages/interop/src/tldraw/import-tldr.test.ts`

**Interfaces**

- Produces: `InteropScene`、`ImportCompatibilityReport`、`ImportResult<T>`。
- Produces: `interopSceneToSnapshot(scene, context)`。
- Produces: `snapshotToInteropScene(snapshot)`。
- Produces: `importTldr(bytes): ImportResult<TLEditorSnapshot>`；解析器保持纯函数，返回已清除结构引用字段的单 Board snapshot 和兼容性报告。

**Board reference element**

```ts
interface BoardReferenceElement {
  id: string
  type: 'board-reference'
  referenceId: string
  targetBoardId: string
  kind: 'embed' | 'link'
  titleFallback: string
  geometry: InteropGeometry
}
```

**Tests first**

- [ ] 基础图形、文本、便签、连接线、分区、表格、图片、SVG 和引用卡片往返。
- [ ] 引用元素保留 `referenceId`、`targetBoardId` 和 `kind`。
- [ ] 普通单 Board 文件中无法解析的目标只保留为降级视觉卡片，不创建 dangling reference。
- [ ] 未支持元素保留 `sourcePayload` 并进入兼容性报告。
- [ ] 图元容器关系与 Board 引用图使用不同字段和校验器。
- [ ] `.tldr` 校验 schema/version、执行受控 migration、重映射全部 records，并为一个文件创建恰好一个 Board。
- [ ] `.tldr` 没有项目级引用表，所有 `board-reference` 一律清除 `referenceId`、`targetBoardId`、`kind` 等结构字段并降级为普通视觉卡片；不能查询当前 Project 后按同 ID 猜测恢复。
- [ ] 将 `.tldr` 注册到统一 drop dispatcher；无论投到标签栏、“＋”或画布，每个文件都创建且只创建一个新 Board。

### Task 17: 实现 draw.io 导入和导出

**Files**

- Create: `packages/interop/src/drawio/import-drawio.ts`
- Create: `packages/interop/src/drawio/export-drawio.ts`
- Create: `packages/interop/src/drawio/style-map.ts`
- Create: `apps/web/src/features/import-export/DrawioImportDialog.tsx`
- Create: `apps/web/src/features/import-export/DrawioExportButton.tsx`
- Modify: `apps/web/src/features/import-export/DropImportController.ts`
- Test: `packages/interop/src/drawio/drawio-roundtrip.test.ts`
- Test: `tests/e2e/drawio-import-export.spec.ts`

**Interfaces**

- Produces: `importDrawio(xml): ImportResult<InteropScene>`。
- Produces: `exportDrawio(scene): string`。

**Reference metadata**

```xml
<mxCell
  iboardReferenceId="reference-id"
  iboardTargetBoardId="target-board-id"
  iboardReferenceKind="embed"
  iboardProjectId="project-id"
/>
```

**Steps**

- [ ] 禁用 XML 外部实体和危险扩展，限制节点数与字符串大小。
- [ ] 映射 vertex、edge、geometry、style、group/section、图片和文本。
- [ ] 引用卡片导出为普通节点、内部 URL 和四个自定义属性。
- [ ] 重新导入本项目时，只有目标 Board 存在且属于同一 Project 才恢复结构引用；否则保留视觉卡片并报告降级。
- [ ] 测试 `embed`、`link` 属性、未知 stencil、连接点和往返视觉差异。
- [ ] `.drawio` 导入始终创建恰好一个新 Board 并打开新标签；不把整份文件直接合并进当前 snapshot。导出仍针对当前 Board。
- [ ] `.drawio` 中可恢复的引用批量交给 Task 11 剪贴板命令事务；不完整、跨 Project 或无目标元数据的节点降级。
- [ ] 拖到画布、标签栏或“＋”区域都采用同一“创建新 Board”语义。

### Task 18: 实现 PNG/JPEG/WebP/SVG/PDF 视觉导入与 PNG/SVG/PDF 导出

**Files**

- Create: `apps/web/src/features/import-export/visual-import.ts`
- Create: `packages/interop/src/visual/sanitize-svg.ts`
- Create: `packages/interop/src/pdf/project-pdf.ts`
- Create: `apps/local-api/src/modules/files/pdf-routes.ts`
- Modify: `apps/web/src/features/import-export/DropImportController.ts`
- Test: `packages/interop/src/visual/sanitize-svg.test.ts`
- Test: `packages/interop/src/pdf/project-pdf.test.ts`
- Test: `tests/e2e/visual-import-export.spec.ts`

**Interfaces**

- Produces: `VisualImportInput = { file, target: { kind: 'new-board'; projectId: string } | { kind: 'current-board'; boardId: string; dropPoint: { x: number; y: number } } }`。
- Produces: `importVisualFile(input: VisualImportInput)`。
- Produces: `exportBoardAsPng(editor, selectionOnly)`。
- Produces: `exportBoardAsSvg(editor, selectionOnly)`。
- Produces: `renderSnapshotToSvg(snapshot, assets)`。
- Produces: `POST /api/boards/:boardId/export.pdf`。
- Produces: `POST /api/projects/:projectId/export.pdf`。
- Produces: `dispatchDroppedFiles(files, dropTarget, activeTab): Promise<FileImportResult[]>`。

**PDF rules**

- [ ] 使用 Task 4 的稳定 `embed` DAG 拓扑顺序；`rootBoardId` 优先，同级按 Board ID，未连通 Board 追加。
- [ ] 不生成额外目录页；PDF 页数严格等于项目 Board 数，每个 Board 恰好一页。
- [ ] 先建立唯一 `boardId -> pageNo` 映射，再渲染页面。
- [ ] 所有 `embed` 和 `link` Shape 都按 `targetBoardId` 生成内部跳转；多个引用跳到同一页。
- [ ] PDF 大纲只反映 `embed` 目录；`link` 不改变大纲，循环也不会重复输出页面。
- [ ] 测试 A、B→C 时 C 只出现一次，两个链接都命中 C 的页码。

**Visual safety**

- [ ] `dispatchDroppedFiles` 是唯一 drop dispatcher，并显式注册 `.iboard` → Task 15 inspect/merge、`.tldr` → Task 16 单 Board、`.drawio` → Task 17 单 Board、PNG/JPEG/WebP/SVG/PDF → 本 Task 视觉导入；MIME 与扩展名双重校验。
- [ ] PNG/JPEG/WebP/SVG/PDF 导入限制 MIME、尺寸、页数和总像素。
- [ ] SVG 清理脚本、事件属性、外部资源和危险 URL。
- [ ] PDF 视觉导入逐页栅格化并标记 `rasterized`，不承诺结构恢复。
- [ ] PNG/JPEG/WebP/SVG/PDF 拖到标签栏或“＋”区域时每个文件各创建一个新 Board；拖到活动画布时插入当前 Board。
- [ ] 多页 PDF 无论从哪个入口都只对应一个 Board/一次插入批次，页面按页码自上而下稳定排列；第一页左上角对齐 drop point 或新 Board 原点。
- [ ] PDF 任一页渲染失败时整份 PDF 不提交，不能生成半个 Board。
- [ ] 无活动 Board 时画布投放返回 `NO_ACTIVE_BOARD`；非法 MIME/扩展名、超限和不支持落点不修改任何 Board。
- [ ] 多文件 drop 按用户文件顺序逐文件独立事务处理；创建新 Board 的成功项按顺序建立标签并让最后一个成功新标签成为活动标签，投到当前画布的视觉文件只形成独立插入批次且保持当前标签，单文件失败不回滚其他已成功文件。
- [ ] E2E 按 PNG、JPEG、WebP、SVG、单页 PDF、多页 PDF 分别验证资源落盘、标签栏/画布落点、稳定布局和失败回滚；结构化格式另验证画布落点仍不会合并当前 snapshot。

---

# 阶段 6：飞书结构化导入（已抽离，暂不执行）

> **Execution status:** Task 19–22 已抽离至[飞书画板导入延期实施计划](2026-07-23-feishu-board-import-deferred-implementation.md)。在用户另行启动该计划前，第一阶段不得执行这四项；Task 23–24 继续只验收本地、mock 与非飞书能力。以下内容保留为历史来源，避免改变原始需求记录。

### Task 19: 实现飞书 OAuth v3

**Files**

- Create: `apps/local-api/src/modules/feishu/oauth-routes.ts`
- Create: `apps/local-api/src/modules/feishu/oauth-service.ts`
- Create: `apps/local-api/src/modules/feishu/credential-store.ts`
- Create: `apps/web/src/features/feishu/FeishuConnectionPanel.tsx`
- Test: `apps/local-api/src/modules/feishu/oauth-service.test.ts`
- Test: `tests/e2e/feishu-oauth.spec.ts`

**Interfaces**

- Produces: `GET /auth/feishu/start`、`GET /auth/feishu/callback`、`GET /auth/feishu/status`。
- Produces: `POST /auth/feishu/refresh`、`DELETE /auth/feishu/account`。

**Steps**

- [ ] 使用随机 `state`、PKCE S256 和 loopback callback。
- [ ] token 只保存在本地 API 的加密凭据存储中，不进入前端 localStorage。
- [ ] refresh token 每次刷新后原子轮换。
- [ ] 日志脱敏 App Secret、token、code 和 URL 敏感参数。
- [ ] 默认只连接 Task 3 的 mock provider，覆盖成功、拒绝、state 不匹配、过期和撤销；常规测试不得读取 `.env.local`。
- [ ] 真实 OAuth E2E 只由 `pnpm e2e:feishu:real` 显式开启，未授权时保持跳过。

### Task 20: 实现飞书链接解析和 Board API 客户端

**Files**

- Create: `apps/local-api/src/modules/feishu/url-resolver.ts`
- Create: `apps/local-api/src/modules/feishu/board-client.ts`
- Create: `apps/local-api/src/modules/feishu/wiki-docx-client.ts`
- Test: `apps/local-api/src/modules/feishu/url-resolver.test.ts`
- Test: `apps/local-api/src/modules/feishu/board-client.test.ts`

**Interfaces**

- Produces: `resolveWhiteboardToken(url, client)`。
- Produces: `listWhiteboardNodes(whiteboardToken)`。
- Produces: `getWhiteboardTheme(whiteboardToken)`。
- Produces: `downloadWhiteboardPreview(whiteboardToken)`。
- Produces: `downloadMedia(mediaToken)`。

**Steps**

- [ ] 支持裸 token、Board URL、带 `blockToken` 的 Wiki/Docx URL。
- [ ] 使用官方 API、超时、指数退避、速率限制提示和可取消请求。
- [ ] 权限不足时返回缺失 scope 与用户可执行的修复说明，不自动扩大权限。
- [ ] 对资源下载校验 MIME、长度和 hash。
- [ ] nodes、theme、preview 和 media download 的默认合同测试全部使用 Task 3 mock provider；只有真实 smoke 命令可以选择官方网络 provider。

### Task 21: 实现飞书节点映射、资源本地化和兼容报告

**Files**

- Create: `packages/interop/src/feishu/node-schema.ts`
- Create: `packages/interop/src/feishu/map-nodes.ts`
- Create: `packages/interop/src/feishu/theme-map.ts`
- Create: `apps/local-api/src/modules/feishu/import-feishu-service.ts`
- Test: `packages/interop/src/feishu/map-nodes.test.ts`
- Test: `apps/local-api/src/modules/feishu/import-feishu-service.test.ts`

**Interfaces**

- Produces: `mapFeishuNodes(nodes): ImportResult<InteropScene>`。
- Produces: `importFeishuBoard(input): Promise<ImportPreview>`。

**Tests first**

- [ ] 基础图形、文字、便签、图片、连接线、分区、表格、手绘、SVG 和思维导图 fixture。
- [ ] 可编辑、降级、栅格化和不支持四类兼容结果。
- [ ] 下载资源写入内容地址目录，失败资源保留原始 payload 和报告项。
- [ ] 默认使用匿名 mock 预览基准做尺寸、包围盒和关键颜色比较；授权后再补真实官方预览视觉对比。
- [ ] 飞书导入默认创建一个新 Board，不根据画布内普通链接自动构造项目引用图。

### Task 22: 实现飞书导入向导、mock E2E 和延期真实验收

**Files**

- Create: `apps/web/src/features/feishu/FeishuImportWizard.tsx`
- Create: `apps/local-api/src/modules/feishu/import-routes.ts`
- Create: `tests/e2e/feishu-import.spec.ts`
- Create: `tests/e2e/feishu-import.real.spec.ts`
- Create: `docs/feishu-import-troubleshooting.md`

**Interfaces**

- Produces: `POST /api/import/feishu/inspect`。
- Produces: `POST /api/import/feishu/commit`。

**Steps**

- [ ] 向导覆盖链接输入、授权、拉取、预览、兼容报告、目标项目选择和提交。
- [ ] inspect 阶段不修改项目；commit 创建新项目或当前项目中的新 Board。
- [ ] 取消、超时和失败清理临时资源。
- [ ] 常规 E2E 只使用 mock provider，覆盖 OAuth、节点拉取、预览、资源下载、错误处理和导入提交。
- [ ] 真实 smoke 与真实导入 E2E 使用 Task 3 的延期门禁；未设置 `FEISHU_REAL_SMOKE=1` 或缺少凭据时输出 `SKIPPED: awaiting user authorization`，不算失败。
- [ ] 获得授权后串行运行真实 nodes、theme、preview、media download 和导入 E2E，与官方预览做视觉对比，并把 `docs/adr/0002-feishu-scopes.md` 从 `pending-user-authorization` 更新为 `verified`。
- [ ] 文档说明 scope、租户审批、无权限、资源下载失败和降级内容。

**Exit**

- mock provider 的导入链路通过即可完成 Task 22。真实授权验收保留为外部待办；失败只阻塞“飞书真实导入已验收”的声明，不回滚或阻塞本地画板能力。

---

# 阶段 7：日常使用加固

### Task 23: 增加备份、恢复和启动脚本

**Files**

- Create: `scripts/start-local.ps1`
- Create: `scripts/backup.ps1`
- Create: `scripts/restore.ps1`
- Create: `apps/local-api/src/modules/files/backup-service.ts`
- Create: `docs/backup-and-restore.md`
- Test: `apps/local-api/src/modules/files/backup-service.test.ts`

**Interfaces**

- Produces: 一键启动本地应用。
- Produces: SQLite 一致性备份和全项目 `.iboard` 备份。

**Steps**

- [ ] 启动脚本检查 Node、pnpm、端口、数据库迁移和应用数据目录。
- [ ] SQLite 备份使用官方 backup API 或安全 checkpoint，不复制活动 WAL 的不一致组合。
- [ ] 全项目备份逐项目调用已验证的 `.iboard` 导出器，因此包含 `references.json`。
- [ ] 备份和恢复不保存或恢复旧的 Board 标签、history、编辑租约、应用 undo/redo receipt 或脏草稿；恢复后从项目首页重新打开 Board。
- [ ] 恢复前自动创建恢复点；恢复后运行数据库完整性、引用图和 edge/Shape 双射检查。
- [ ] PowerShell 脚本使用参数数组和明确路径，避免复杂字符串二次解析。

### Task 24: 安全、性能和完整回归

**Files**

- Create: `tests/e2e/full-regression.spec.ts`
- Create: `tests/performance/large-board.bench.ts`
- Create: `tests/performance/reference-graph.bench.ts`
- Create: `tests/security/import-security.test.ts`
- Create: `docs/user-guide.md`
- Create: `docs/security-and-privacy.md`
- Modify: `README.md`

**Performance baselines**

- [ ] 5000 普通图元下平移、缩放和 autosave 可用。
- [ ] 2000 图元 Board 本地首次打开小于 2 秒。
- [ ] 缓存命中时引用进入和 history 返回小于 200ms。
- [ ] 100 Board、1000 edge 的 inbound/outbound 查询、cycle check、深度和拓扑排序有记录基线。
- [ ] fixture 包含多来源共享目标、`embed` 菱形图、`link` 自环与循环，不能只测线性图。
- [ ] 打开 20 个标签时 instrumentation 证明每个应用窗口始终只有一个 tldraw Editor/store 挂载；非活动标签不渲染、不 autosave。
- [ ] 500 元素跨 Board 粘贴建立记录基线；已有资源 hash 不重复写入字节。
- [ ] `.iboard` merge 对 100 Board、1000 edge 和共享资源建立预检、ID remap 与提交基线。

**Security regressions**

- [ ] ZIP 路径穿越、ZIP bomb、XML 外部实体、危险 SVG、超限图片和恶意 PDF 被拒绝。
- [ ] 篡改 `references.json`、引用/Shape 不一致、dangling、跨项目、重复引用 ID、重复 `(sourceBoardId, shapeId)`、`embed` 环和第 11 个 Board 层级被拒绝。
- [ ] `link` 重复、自环和循环不被误报。
- [ ] `.tldr` 与剪贴板 JSON 作为不可信输入执行 schema 校验；跨 Project 视觉卡不保留可执行 URL 或可恢复为结构引用的隐藏字段。
- [ ] 凭据不进入前端 bundle、日志、Git 或浏览器 localStorage。

**Reference graph regressions**

- [ ] A、B 同时引用 C，分别进入后按实际路径返回各自来源并恢复视口。
- [ ] 裸深链打开 C 显示 A、B 两个入站来源，并可返回项目首页。
- [ ] 删除一条引用不删除 C；存在任意入站引用时删除 C 返回 `BOARD_REFERENCED`。
- [ ] 当前默认入口无论是否有入站引用都返回 `ROOT_BOARD_DELETE_FORBIDDEN`；切换默认入口后原 Board 才可按普通规则删除。
- [ ] 普通 autosave 不能新增、删除引用或改写 `targetBoardId`/`kind`。
- [ ] `.iboard` 多来源引用往返一致，ID 重映射后仍满足双射。
- [ ] PDF 页数等于 Board 数，共享 Board 只输出一页，所有引用跳转正确。
- [ ] 默认入口删除返回 `ROOT_BOARD_DELETE_FORBIDDEN` 与准确 `projectId/rootBoardId`；切换默认入口后的正常删除通过。

**Tabs and clipboard regressions**

- [ ] 同一 Board 显式打开两个标签，history/camera/selection 独立，普通打开不会意外创建重复标签。
- [ ] 同一 Board 的标签 A、B 同时发起首次编辑时只有一个在输入生效前取得租约；失败者输入不落盘、立即只读并可定位 owner。owner 保存或明确放弃后，另一标签拉取最新 revision 再取得租约。
- [ ] 保存失败、离线、revision 冲突和关闭 owner 标签的恢复分支不丢 `pendingSnapshot`。
- [ ] 普通 Shape、图片、分组、内部 binding 和连接线跨 Board 粘贴后 ID 全部重映射；集合外 binding 断开并保持画布坐标。
- [ ] 同 Project 引用卡 paste/undo/redo 同时创建、删除、恢复 Shape 与 edge；任一失败零部分提交。
- [ ] 跨 Project 引用只产生视觉卡和降级报告，`board_references` 无新增记录。

**Drag and merge regressions**

- [ ] 统一 dispatcher 覆盖 `.iboard`、`.tldr`、`.drawio`、PNG、JPEG、WebP、SVG、单页 PDF 和多页 PDF；`.tldr`、`.drawio` 各创建一个新 Board，visual 文件投放标签栏创建 Board、投放画布只插入当前 Board。
- [ ] `.tldr` 内的引用字段始终降级；多页 PDF 只创建一个 Board/一次插入批次，页码和布局稳定，单页故障导致整份回滚。
- [ ] `.iboard` merge 完整 remap schema-owned ID，hash 和外部 token 不变，当前 Project id/title/root 不变。
- [ ] `.iboard` drop 后未确认时 Board/reference/asset usage 零新增；确认后导入入口新标签打开、其他 Board 可从“全部画板”访问，同包重复 merge 互不引用。
- [ ] 对资源 materialize、ID remap、第三个 Board、reference 和数据库 commit 分别注入失败，当前 Project、默认入口与可见 Board 均保持不变。

**Documentation**

- [ ] 用户指南说明 `embed`、`link`、右键进入、访问路径返回、深链来源列表、移除引用不删除 Board，以及删除 Board 前必须清除所有入站引用。
- [ ] 用户指南说明顶部会话标签、同 Board 多标签只读租约、跨 Board 剪贴板、引用降级、拖放落点和 `.iboard` merge 语义。
- [ ] 安全文档说明本地数据目录、OAuth 凭据、备份、导入风险和许可证边界。
- [ ] README 给出安装、启动、测试、导入导出与故障排查入口。

**Verification**

```bash
pnpm test
pnpm test:feishu
pnpm typecheck
pnpm build
pnpm e2e
pnpm --filter @infinite-board/interop test
pnpm --filter @infinite-board/local-api test
```

默认验证必须明确显示真实飞书测试已跳过，且不得访问飞书网络。获得用户授权后再额外运行 `pnpm smoke:feishu:real` 与 `pnpm e2e:feishu:real`。

---

## 最终验收清单

- [ ] 可以创建、编辑、自动保存和恢复基础画板。
- [ ] 顶部标签栏支持切换、显式重复打开、快捷键、关闭、拖动排序和溢出；每个应用窗口只挂载一个活动 editor。
- [ ] 同一 Board 的各标签 history/view 独立；首次可变更输入前只能有一个标签取得写租约，其他实例只读，释放后加载最新 revision。
- [ ] 普通元素可跨 Board 粘贴，所有 Shape/Asset/Binding ID 正确重映射，内部绑定保留、外部绑定断开、相同 hash 资源复用。
- [ ] 同 Project 引用 paste/undo/redo 原子维护 Shape 与 edge；跨 Project 引用只生成普通视觉卡。
- [ ] 可以创建 `embed`/`link` 引用，通过右键进入目标 Board，并引用项目内已有 Board。
- [ ] A、B 可同时引用 C；从不同入口进入 C 后，返回时分别恢复 A、B 的相机和选择状态。
- [ ] 面包屑表示本次访问路径；裸深链展示全部入站来源并返回项目首页。
- [ ] `rootBoardId` 只作为默认入口，可被引用；切换默认入口前删除返回 `ROOT_BOARD_DELETE_FORBIDDEN`。
- [ ] `embed` 最多 10 个 Board 节点，环路与第 11 个层级被拒绝。
- [ ] `link` 的重复、自引用和循环被允许，且不进入嵌套目录与深度计算。
- [ ] 每条 reference row 与来源 snapshot Shape 一一对应；目标 Board 可有 0 到任意多条入站引用。
- [ ] 删除引用只删除 edge 与 Shape；删除有入站引用的 Board 返回 `BOARD_REFERENCED`。
- [ ] 普通 autosave 不能更改引用集合、目标或类型。
- [ ] `.iboard` 包含 `references.json`，多来源引用、资源和 snapshot 可无损往返。
- [ ] `.iboard` 拖放先 inspect 并等待显式确认；完整 merge 到当前 Project 时全量 schema-owned ID remap，当前 Project `id`、`title` 和 `rootBoardId` 不变，导入入口新标签打开，取消或失败零可见残留。
- [ ] dangling、跨项目、重复 ID、重复来源 Shape、`embed` 成环与超深导入被拒绝。
- [ ] draw.io 自定义属性包含 reference ID、target Board ID、kind 和 project ID。
- [ ] 统一 dispatcher 接入 `.iboard`、`.tldr`、`.drawio`、PNG/JPEG/WebP/SVG/PDF；`.tldr` 与 `.drawio` 各创建一个新 Board，visual 文件按投放到标签栏或画布分别创建 Board 或插入当前 Board。
- [ ] 多页 PDF 只创建一个 Board并按页码稳定排列，任一页失败不提交部分结果。
- [ ] PNG/JPEG/WebP/SVG/PDF 可视觉导入，PNG/SVG/单 Board PDF 可导出。
- [ ] 项目 PDF 每个 Board 恰好一页，全部引用跳转到唯一目标页。
- [ ] mock provider 下的飞书 OAuth、Board API、导入向导、错误处理和兼容性报告全部通过。
- [ ] `docs/adr/0002-feishu-scopes.md` 在未授权阶段保持 `pending-user-authorization`；默认测试明确跳过真实飞书且不读取凭据、不访问飞书网络。
- [ ] 用户授权后，可通过真实飞书 OAuth 和官方 Board API 导入有权限的画板，完成 nodes/theme/preview/media smoke、视觉对比和真实导入 E2E，并将 ADR 状态更新为 `verified`。此项是延期外部验收，不阻塞其他最终验收项。
- [ ] 不支持的飞书节点保留原始 payload，不静默丢失。
- [ ] 5000 图元和 1000 引用 edge 达到记录的性能基线。
- [ ] OAuth token、App Secret 和本地数据不会进入不安全位置。
- [ ] 备份、恢复和完整回归通过。

## 执行顺序

1. Task 1 初始化 Git、开发环境、workspace、最小 Web/API 骨架和默认飞书跳过门禁；验证并提交后暂停。
2. Task 2 记录 tldraw 许可 ADR；localhost 开发可继续，正式使用仍受许可证结论约束。
3. Task 3 完成飞书 mock 合同和 `pending-user-authorization` 延期门禁，真实授权不阻塞后续开发。
4. Task 4–6 建立引用图领域模型、数据库、基础引用 API 和普通跨 Board 剪贴板事务基座。
5. Task 7–9 交付标签会话、编辑租约、普通元素跨 Board 剪贴板和多 Board 编辑 MVP。
6. Task 10–12 完成引用 paste/undo/redo 事务和每标签访问路径导航。
7. Task 13–15 完成 `.iboard` 图结构无损往返与当前 Project merge。
8. Task 16–18 完成 `.tldr`、draw.io、文件拖放、视觉导入导出和唯一页 PDF。
9. Task 19–22 使用 mock provider 完成飞书官方结构化导入；真实 OAuth、API 和视觉验收保持延期。
10. Task 23–24 完成备份、安全、性能和最终验收。

依赖关系：Task 1 提供所有后续任务使用的 workspace 和测试基座；Task 2/3 只建立许可与飞书延期门禁，不阻塞 Task 4–24 的常规实现。Task 4/5 先定义引用、剪贴板、资源和 ID 模型；Task 6 只完成只读引用 API、mutation contracts 和接收已 materialize patch 的事务基座。Task 7 提供 tldraw record/asset/binding materialization，Task 8 提供标签与租约基座，Task 9 才注册普通 clipboard payload 的公开 paste/undo/redo 路由。Task 10 生成引用 mutation 与粘贴计划，Task 11 再注册引用 mutation 路由并扩展 Task 9 的 clipboard 路由/service，完成引用 paste/undo/redo 的 edge/Shape 原子事务；Task 12 最后把导航绑定到 `tabId`。Task 14 merge 复用 Task 4 图校验、Task 5 资源写入、Task 11 双射和 Task 13 archive；Task 15 依赖 Task 8 tab manager 与 Task 14 返回的 `importedRootBoardId`。Task 18 的统一 drop dispatcher 汇总 Task 15 `.iboard`、Task 16 `.tldr`、Task 17 draw.io 与本 Task 视觉导入器；Task 19–22 默认依赖 Task 3 mock provider，只有延期真实验收才访问飞书；Task 24 最终覆盖全部横切场景。
