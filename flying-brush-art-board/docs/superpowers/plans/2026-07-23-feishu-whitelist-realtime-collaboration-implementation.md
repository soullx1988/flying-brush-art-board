# 飞书白名单登录与局域网实时共编 Implementation Plan

> **执行提示：** 按 Task 顺序和复选框跟踪执行。是否使用任何额外工作流或子智能体由执行模型自行判断；当执行模型为 GPT-5.6 时，不得使用 Superpowers，详见项目根目录 `AGENTS.md`。

**Goal:** 在第一阶段完成并验收后，为 Infinite Board 增加飞书白名单登录、局域网多人实时共编、仅本机保存的锚点评论和操作审计。

**Architecture:** 单台局域网服务器通过 Caddy 暴露同源 HTTPS，Fastify 继续只监听 127.0.0.1:8787。PostgreSQL 的 "User" 表仅作只读登录白名单；SQLite 继续保存所有画板、实时房间、会话、评论和审计数据。每个 Board 使用 tldraw 官方同步房间，所有结构化 Board 命令统一经过服务端协调器，避免实时更新与引用事务互相覆盖。

**Tech Stack:** Node.js >=22.13 <23、pnpm 11.9.0、TypeScript 5.9.3、React 19.2.1、Vite 8.1.5、tldraw/@tldraw/sync 5.2.5、Fastify 5.10.0、@fastify/websocket 11.3.0、@fastify/cookie 11.1.2、PostgreSQL pg 8.22.0、SQLite/better-sqlite3 13.0.1、Zod 4.4.3、Vitest 4.1.10、Playwright 1.61.1、Caddy。

## Global Constraints

- 本计划在第一阶段完成并验收前不得执行。
- 第一阶段门禁为：全部非外部门禁任务完成，pnpm smoke 通过，工作区变更已由用户确认；真实飞书导入仍可按第一阶段规格保持 pending-user-authorization。
- 执行时必须从第一阶段验收提交重新创建或变基 feature/phase2-collaboration，不能直接在当前旧基线上实现。
- 主应用、SQLite 和资源目录只运行在一台局域网服务器；不引入 PostgreSQL 业务存储、Redis、对象存储或横向扩容。
- Fastify 只监听 127.0.0.1 或 ::1；局域网只开放 Caddy 的 HTTPS 入口。
- PostgreSQL "User" 表和其中 Token 字段绝不写入；连接账号只授予目标表 SELECT 权限。
- 飞书 OAuth token 只在回调期间用于获取 open_id，随后立即丢弃，不写 SQLite、PostgreSQL、浏览器存储或日志。
- 本应用与共享 "User" 表必须使用同一飞书 App ID；否则执行前必须把匹配键改为 union_id 并更新本计划。
- "User" 表中存在对应 open_id 的所有人员拥有相同权限，包括项目和 Board 的创建、编辑、删除、恢复、评论和审计查看。
- 评论、审计、在线状态和实时内容都不写入飞书文档、任务、消息或原生画板。
- tldraw License 必须覆盖局域网团队使用和官方同步包；未通过授权门禁不得发布团队版本。
- 默认测试、CI 和 pnpm e2e 不读取真实飞书或 PostgreSQL 凭据；真实联调必须显式运行专用命令。
- 所有新功能采用测试先行：测试必须先因能力缺失而失败，再写最小实现使其通过。
- 不修改或删除第一阶段的 .iboard 内容格式、引用语义、资源哈希规则和导入事务保证。

## Execution Checklist

- [ ] Gate 0：第一阶段完成、验收、提交，并确定第二阶段基线提交。
- [ ] Task 1：依赖、运行配置、Caddy 和部署门禁。
- [ ] Task 2：SQLite 协作表与迁移。
- [ ] Task 3：PostgreSQL 只读白名单适配器。
- [ ] Task 4：飞书 OAuth、本地会话和全局鉴权。
- [ ] Task 5：Web 登录门禁和当前用户界面。
- [ ] Task 6：tldraw 实时房间和 SQLite 持久化。
- [ ] Task 7：Web 实时 Store、结构命令协调和旧租约退役。
- [ ] Task 8：本地锚点评论。
- [ ] Task 9：本地操作审计、健康检查和备份。
- [ ] Task 10：端到端、并发、恢复和安全验收。

---

### Gate 0: Confirm Phase-One Acceptance and Rebase the Worktree

**Files:**

- Read: docs/superpowers/plans/2026-07-22-feishu-style-infinite-whiteboard-implementation.md
- Read: docs/superpowers/specs/2026-07-22-feishu-style-infinite-whiteboard-design.md
- Use: .worktrees/phase2-collaboration

**Interfaces:**

- Consumes: 第一阶段最终验收提交 FIRST_PHASE_SHA。
- Produces: 从 FIRST_PHASE_SHA 开始、无未提交变更的 feature/phase2-collaboration 工作树。

- [ ] **Step 1: Verify the first-stage checklist**

逐项检查第一阶段计划中的非外部门禁条目均已完成。真实飞书网络验收可以继续保持显式延期，但必须记录为第一阶段已接受的外部门禁。

- [ ] **Step 2: Run the first-stage acceptance suite**

Run:

~~~powershell
pnpm smoke
~~~

Expected: 单元测试、类型检查、构建和默认 E2E 全部 exit 0；真实飞书用例明确显示跳过。

- [ ] **Step 3: Record the accepted commit**

Run:

~~~powershell
git rev-parse HEAD
git status --short
~~~

Expected: 得到 FIRST_PHASE_SHA；用户确认第一阶段工作区内容已提交或明确作为验收基线处理。

- [ ] **Step 4: Recreate or rebase the phase-two worktree**

如果现有 .worktrees/phase2-collaboration 仍指向旧基线，先保留其中任何有效提交，再从 FIRST_PHASE_SHA 重建或变基。不得覆盖主工作区的未提交文件。

- [ ] **Step 5: Verify the phase-two baseline**

Run:

~~~powershell
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm typecheck
~~~

Expected: 所有命令 exit 0。

---

### Task 1: Dependencies, Runtime Configuration, and LAN Deployment

**Files:**

- Modify: package.json
- Modify: apps/local-api/package.json
- Modify: apps/web/package.json
- Modify: .env.example
- Create: apps/local-api/src/config/runtime-config.ts
- Create: apps/local-api/src/config/runtime-config.test.ts
- Create: tests/preflight/phase2-dependencies.test.ts
- Create: deploy/Caddyfile.example
- Create: docs/deployment/lan-collaboration-server.md

**Interfaces:**

- Produces: RuntimeConfig、loadRuntimeConfig(environment)、正式依赖版本、同源 HTTPS/WS 部署说明。

~~~ts
export interface RuntimeConfig {
  appOrigin: URL
  dataDirectory: string
  feishu: {
    appId: string
    appSecret: string
    redirectUri: URL
  }
  sessionSecret: string
  userDatabase: {
    host: string
    port: number
    database: string
    user: string
    password: string
    sslMode: 'disable' | 'prefer' | 'require'
    schema: string
    table: string
    openIdColumn: string
    nameColumn: string
    departmentColumn: string
    positionColumn: string
  }
  auditRetentionDays: number
}

export function loadRuntimeConfig(environment: NodeJS.ProcessEnv): RuntimeConfig
~~~

- [ ] **Step 1: Write dependency and configuration tests**

在 tests/preflight/phase2-dependencies.test.ts 断言以下精确依赖存在：

~~~ts
expect(localApi.dependencies).toMatchObject({
  '@fastify/cookie': '11.1.2',
  '@fastify/websocket': '11.3.0',
  '@tldraw/sync': '5.2.5',
  '@tldraw/sync-core': '5.2.5',
  pg: '8.22.0',
})
expect(root.devDependencies).toMatchObject({
  '@types/pg': '8.20.0',
})
~~~

在 runtime-config.test.ts 覆盖完整配置、缺失秘密、非 HTTPS APP_ORIGIN、非 loopback API 约束、非法 SQL 标识符和端口范围。

- [ ] **Step 2: Run tests and verify RED**

Run:

~~~powershell
pnpm exec vitest run --project unit tests/preflight/phase2-dependencies.test.ts apps/local-api/src/config/runtime-config.test.ts
~~~

Expected: FAIL，因为依赖和 loadRuntimeConfig 尚不存在。

- [ ] **Step 3: Add exact dependencies**

Run:

~~~powershell
pnpm add -w -D @types/pg@8.20.0
pnpm --filter @infinite-board/local-api add @fastify/cookie@11.1.2 @fastify/websocket@11.3.0 @tldraw/sync@5.2.5 @tldraw/sync-core@5.2.5 pg@8.22.0
pnpm --filter @infinite-board/web add @tldraw/sync@5.2.5
~~~

- [ ] **Step 4: Implement strict runtime configuration**

loadRuntimeConfig 必须：

- 要求 APP_ORIGIN 为 https URL。
- 要求 FEISHU_REDIRECT_URI 与 APP_ORIGIN 同源且路径为 /auth/feishu/callback。
- 要求 SESSION_SECRET 至少 32 字节。
- 只允许 USER_DB_SSLMODE 为 disable、prefer 或 require。
- 对 schema/table/column 名应用 /^[A-Za-z_][A-Za-z0-9_]*$/。
- 不读取 User 表 Token 列配置。
- 使用 INFINITE_BOARD_DATA_DIR 覆盖现有默认数据目录。

- [ ] **Step 5: Add environment and Caddy templates**

.env.example 只添加变量名与安全默认值，不包含凭据。deploy/Caddyfile.example 固定为同源反代：

~~~caddy
{$APP_DOMAIN} {
  encode zstd gzip
  reverse_proxy 127.0.0.1:8787
}
~~~

部署文档明确：服务器防火墙只开放 443；8787 不对局域网开放；正式子域名解析到局域网地址；OAuth 回调登记为 https://域名/auth/feishu/callback。

- [ ] **Step 6: Run tests and verify GREEN**

Run:

~~~powershell
pnpm exec vitest run --project unit tests/preflight/phase2-dependencies.test.ts apps/local-api/src/config/runtime-config.test.ts
pnpm typecheck
~~~

Expected: PASS。

- [ ] **Step 7: Commit**

~~~powershell
git add package.json pnpm-lock.yaml apps/local-api/package.json apps/web/package.json .env.example apps/local-api/src/config tests/preflight/phase2-dependencies.test.ts deploy/Caddyfile.example docs/deployment/lan-collaboration-server.md
git commit -m "chore: prepare phase two collaboration runtime"
~~~

---

### Task 2: SQLite Collaboration Schema and Migrations

**Files:**

- Modify: apps/local-api/src/db/schema.ts
- Create: apps/local-api/src/db/migrations/0002_collaboration.sql
- Create: apps/local-api/src/db/collaboration-schema.test.ts

**Interfaces:**

- Produces: OAuth state、应用会话、实时房间、评论、审计和检查点所需表。

新增表及关键约束：

~~~text
oauth_states(state_hash PK, verifier_ciphertext, return_to, expires_at, created_at)
app_sessions(session_hash PK, open_id, name, department, position,
             created_at, last_seen_at, expires_at, absolute_expires_at)
realtime_room_snapshots(board_id PK/FK, room_version, snapshot_json,
                        update_count, compacted_at, updated_at)
realtime_room_updates(board_id, sequence, payload, actor_open_id, created_at,
                      PK(board_id, sequence))
board_checkpoints(id PK, board_id FK, snapshot_json, reason, actor_open_id, created_at)
comment_threads(id PK, project_id FK, board_id FK, shape_id, x, y,
                status, created_by, created_at, updated_at)
comment_messages(id PK, thread_id FK, author_open_id, body, created_at, deleted_at)
audit_events(id PK, actor_open_id, project_id, board_id, action,
             summary_json, created_at)
~~~

- [ ] **Step 1: Write migration tests**

测试必须验证：

- createDatabase(:memory:) 后所有新表存在。
- realtime_room_updates 的 sequence 在同一 board 内唯一。
- 删除 Board 级联删除房间数据和评论，审计事件保留但 board_id 允许置空。
- 评论状态只允许 open 或 resolved。
- app_sessions 不存在 access_token 或 refresh_token 列。

- [ ] **Step 2: Run tests and verify RED**

Run:

~~~powershell
pnpm exec vitest run --project unit apps/local-api/src/db/collaboration-schema.test.ts
~~~

Expected: FAIL，因为新表不存在。

- [ ] **Step 3: Add migration and Drizzle declarations**

0002_collaboration.sql 使用 CREATE TABLE IF NOT EXISTS 和明确索引：

~~~sql
CREATE INDEX IF NOT EXISTS idx_sessions_open_id ON app_sessions(open_id);
CREATE INDEX IF NOT EXISTS idx_room_updates_board_sequence
  ON realtime_room_updates(board_id, sequence);
CREATE INDEX IF NOT EXISTS idx_comments_board_status
  ON comment_threads(board_id, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_audit_project_created
  ON audit_events(project_id, created_at DESC);
~~~

createDatabase 必须顺序执行 0001 和 0002 等价 SQL，并继续启用 foreign_keys、WAL 和 busy_timeout=5000。

- [ ] **Step 4: Run tests and verify GREEN**

Run:

~~~powershell
pnpm exec vitest run --project unit apps/local-api/src/db/collaboration-schema.test.ts apps/local-api/src/db/repositories.test.ts
~~~

Expected: PASS。

- [ ] **Step 5: Commit**

~~~powershell
git add apps/local-api/src/db
git commit -m "feat: add collaboration persistence schema"
~~~

---

### Task 3: Read-Only PostgreSQL User Allowlist

**Files:**

- Create: apps/local-api/src/modules/auth/allowed-user-directory.ts
- Create: apps/local-api/src/modules/auth/postgres-allowed-user-directory.ts
- Create: apps/local-api/src/modules/auth/postgres-allowed-user-directory.test.ts
- Create: apps/local-api/src/modules/auth/user-directory-cache.ts
- Create: apps/local-api/src/modules/auth/user-directory-cache.test.ts

**Interfaces:**

~~~ts
export interface AllowedUser {
  openId: string
  name: string
  department?: string
  position?: string
}

export interface AllowedUserDirectory {
  findByOpenId(openId: string): Promise<AllowedUser | undefined>
  checkHealth(): Promise<'ok' | 'error'>
  close(): Promise<void>
}

export interface UserDirectoryCache {
  requireAllowed(openId: string): Promise<AllowedUser>
  invalidate(openId: string): void
}
~~~

- [ ] **Step 1: Write allowlist tests**

使用 pg 的注入式 QueryExecutor，不连接真实数据库。测试必须断言：

- 查询只包含 SELECT。
- SQL 精确引用配置的 schema、table 和列名。
- SQL 不包含 Token 列、INSERT、UPDATE 或 DELETE。
- open_id 通过 $1 参数传递，不拼接值。
- 无记录返回 undefined。
- PostgreSQL 失败映射为 USER_DIRECTORY_UNAVAILABLE。
- 缓存 5 分钟后重新查询；删除用户后下一次检查返回 USER_NOT_ALLOWED。

- [ ] **Step 2: Run tests and verify RED**

Run:

~~~powershell
pnpm exec vitest run --project unit apps/local-api/src/modules/auth/postgres-allowed-user-directory.test.ts apps/local-api/src/modules/auth/user-directory-cache.test.ts
~~~

Expected: FAIL，因为接口与适配器尚不存在。

- [ ] **Step 3: Implement the read-only adapter**

查询形状固定为：

~~~sql
SELECT
  "<openIdColumn>" AS open_id,
  "<nameColumn>" AS name,
  "<departmentColumn>" AS department,
  "<positionColumn>" AS position
FROM "<schema>"."<table>"
WHERE "<openIdColumn>" = $1
LIMIT 1
~~~

标识符只允许来自 Task 1 已校验的配置。Pool 最大连接数设为 5，statement_timeout 设为 3000ms，application_name 设为 infinite-board-user-directory。

- [ ] **Step 4: Implement five-minute authorization caching**

缓存只保存 AllowedUser 和验证时间，不保存飞书 token。数据库故障时不得把未知用户视为允许；已有缓存只能使用到 5 分钟 TTL 到期。

- [ ] **Step 5: Run tests and verify GREEN**

Run:

~~~powershell
pnpm exec vitest run --project unit apps/local-api/src/modules/auth/postgres-allowed-user-directory.test.ts apps/local-api/src/modules/auth/user-directory-cache.test.ts
pnpm typecheck
~~~

Expected: PASS。

- [ ] **Step 6: Commit**

~~~powershell
git add apps/local-api/src/modules/auth
git commit -m "feat: add read only Feishu user allowlist"
~~~

---

### Task 4: Feishu OAuth, Local Sessions, and Global Authorization

**Files:**

- Create: apps/local-api/src/modules/auth/feishu-oauth-provider.ts
- Create: apps/local-api/src/modules/auth/feishu-oauth-provider.test.ts
- Create: apps/local-api/src/modules/auth/oauth-state-repository.ts
- Create: apps/local-api/src/modules/auth/session-repository.ts
- Create: apps/local-api/src/modules/auth/session-repository.test.ts
- Create: apps/local-api/src/modules/auth/auth-plugin.ts
- Create: apps/local-api/src/modules/auth/auth-routes.ts
- Create: apps/local-api/src/modules/auth/auth-routes.test.ts
- Modify: apps/local-api/src/app.ts
- Modify: apps/local-api/src/server.ts
- Create: tests/helpers/build-test-app.ts
- Modify: existing local-api tests to use buildTestApp where authentication is not under test

**Interfaces:**

~~~ts
export interface FeishuLoginIdentity {
  openId: string
  name?: string
}

export interface FeishuOAuthProvider {
  createAuthorizationUrl(input: {
    state: string
    codeChallenge: string
    redirectUri: string
  }): URL
  exchangeCode(input: {
    code: string
    codeVerifier: string
    redirectUri: string
  }): Promise<FeishuLoginIdentity>
}

export interface AuthenticatedRequestUser extends AllowedUser {
  sessionId: string
}
~~~

公开接口：

~~~text
GET  /auth/feishu/start?returnTo=/projects/...
GET  /auth/feishu/callback?code=...&state=...
GET  /api/me
POST /api/auth/logout
~~~

- [ ] **Step 1: Write OAuth provider and session tests**

覆盖：

- state 为 32 字节随机值并只保存 SHA-256。
- PKCE verifier 为 32 字节随机值，challenge 使用 S256。
- returnTo 只允许本站以 / 开头的相对路径。
- token 响应只在函数内存中使用；返回值只包含 identity。
- session cookie 存随机 32 字节 token，SQLite 只存 SHA-256。
- idle 12 小时、absolute 7 天。
- Secure、HttpOnly、SameSite=Lax、Path=/。

- [ ] **Step 2: Run tests and verify RED**

Run:

~~~powershell
pnpm exec vitest run --project unit apps/local-api/src/modules/auth/feishu-oauth-provider.test.ts apps/local-api/src/modules/auth/session-repository.test.ts apps/local-api/src/modules/auth/auth-routes.test.ts
~~~

Expected: FAIL，因为 OAuth、会话和路由尚不存在。

- [ ] **Step 3: Implement OAuth start and callback**

授权端点使用：

~~~text
GET  https://accounts.feishu.cn/open-apis/authen/v1/authorize
POST https://accounts.feishu.cn/oauth/v3/token
GET  https://open.feishu.cn/open-apis/authen/v1/user_info
~~~

回调顺序固定为：校验 state/过期时间 → 换 token → 获取 open_id → requireAllowed(open_id) → 创建本地 session → 清除 OAuth state → 重定向 returnTo。任何日志都不得包含 code、token、state 原文或用户文档内容。

- [ ] **Step 4: Implement global authentication**

auth-plugin 为 /api/* 和 /realtime/* 提供 request.user。以下路径公开：

~~~text
/health
/auth/feishu/start
/auth/feishu/callback
~~~

未登录返回 401 SESSION_EXPIRED；不在白名单返回 403 USER_NOT_ALLOWED；用户目录不可用返回 503 USER_DIRECTORY_UNAVAILABLE。

server.ts 必须加载真实 RuntimeConfig 和 PostgreSQL directory。buildApp 的测试配置必须显式注入测试身份，禁止生产调用者省略鉴权配置。

- [ ] **Step 5: Update existing API tests through a shared helper**

tests/helpers/build-test-app.ts 提供固定测试用户：

~~~ts
export const TEST_USER: AllowedUser = {
  openId: 'ou_test_allowed',
  name: 'Test User',
  department: 'Product',
  position: 'Editor',
}
~~~

buildTestApp 自动注入内存 SQLite、mock OAuth、allow-all directory，并给 inject 请求附带有效测试 session cookie。生产代码中不得存在 x-test-user 或环境变量绕过鉴权的路径。

- [ ] **Step 6: Run tests and verify GREEN**

Run:

~~~powershell
pnpm exec vitest run --project unit apps/local-api/src/modules/auth apps/local-api/src/app.test.ts
pnpm test
~~~

Expected: PASS，且真实网络调用次数为 0。

- [ ] **Step 7: Commit**

~~~powershell
git add apps/local-api/src apps/local-api/src/modules/auth tests/helpers
git commit -m "feat: require Feishu allowlist authentication"
~~~

---

### Task 5: Web Login Gate and Current User UI

**Files:**

- Create: apps/web/src/features/auth/auth-client.ts
- Create: apps/web/src/features/auth/AuthGate.tsx
- Create: apps/web/src/features/auth/LoginPage.tsx
- Create: apps/web/src/features/auth/AuthGate.test.tsx
- Modify: apps/web/src/App.tsx
- Modify: apps/web/src/app/router.tsx
- Modify: apps/web/src/styles.css

**Interfaces:**

~~~ts
export interface CurrentUser {
  openId: string
  name: string
  department?: string
  position?: string
}

export interface AuthClient {
  getCurrentUser(): Promise<CurrentUser | undefined>
  logout(): Promise<void>
  loginUrl(returnTo: string): string
}
~~~

- [ ] **Step 1: Write AuthGate tests**

覆盖 loading、未登录、已登录、USER_NOT_ALLOWED、USER_DIRECTORY_UNAVAILABLE、退出登录和 returnTo 保留。未登录页面只显示“使用飞书登录”，不得渲染任何项目或 Board 内容。

- [ ] **Step 2: Run tests and verify RED**

Run:

~~~powershell
pnpm exec vitest run --project web apps/web/src/features/auth/AuthGate.test.tsx
~~~

Expected: FAIL，因为 AuthGate 尚不存在。

- [ ] **Step 3: Implement auth client and gate**

GET /api/me 的 401 映射为 undefined，其余错误保留 code。登录按钮导航到：

~~~text
/auth/feishu/start?returnTo=<当前 pathname+search>
~~~

已登录后在应用顶栏显示姓名、部门、职位和退出按钮；不显示或缓存 token/open_id 之外的秘密。

- [ ] **Step 4: Run tests and verify GREEN**

Run:

~~~powershell
pnpm exec vitest run --project web apps/web/src/features/auth/AuthGate.test.tsx apps/web/src/App.test.tsx
pnpm typecheck
~~~

Expected: PASS。

- [ ] **Step 5: Commit**

~~~powershell
git add apps/web/src
git commit -m "feat: add Feishu login gate"
~~~

---

### Task 6: tldraw Realtime Rooms and SQLite Persistence

**Files:**

- Create: apps/local-api/src/modules/realtime/room-persistence.ts
- Create: apps/local-api/src/modules/realtime/room-persistence.test.ts
- Create: apps/local-api/src/modules/realtime/board-room-manager.ts
- Create: apps/local-api/src/modules/realtime/board-room-manager.test.ts
- Create: apps/local-api/src/modules/realtime/realtime-routes.ts
- Create: apps/local-api/src/modules/realtime/realtime-routes.test.ts
- Modify: apps/local-api/src/app.ts

**Interfaces:**

~~~ts
export interface DurableRoomUpdate {
  boardId: string
  sequence: number
  payload: Uint8Array
  actorOpenId: string
  createdAt: string
}

export interface BoardRoomPersistence {
  load(boardId: string): Promise<{
    snapshot: unknown
    roomVersion: number
    updates: DurableRoomUpdate[]
  }>
  append(update: Omit<DurableRoomUpdate, 'sequence'>): Promise<number>
  compact(input: {
    boardId: string
    snapshot: unknown
    roomVersion: number
    throughSequence: number
  }): Promise<void>
  checkpoint(input: {
    boardId: string
    snapshot: unknown
    actorOpenId: string
    reason: 'interval' | 'before-destructive-command' | 'manual'
  }): Promise<string>
}

export interface BoardRoomManager {
  handleSocket(boardId: string, user: AllowedUser, socket: WebSocket): Promise<void>
  getAuthoritativeSnapshot(boardId: string): Promise<unknown>
  replaceAuthoritativeSnapshot(boardId: string, snapshot: unknown, actorOpenId: string): Promise<void>
  close(): Promise<void>
}
~~~

- [ ] **Step 1: Write persistence tests**

覆盖冷启动从 boards.tldraw_snapshot 建立房间、更新 sequence 单调递增、服务器重启后 snapshot+updates 重放、每 500 次更新或 5 分钟压缩、压缩事务删除旧增量、检查点保留。

- [ ] **Step 2: Run persistence tests and verify RED**

Run:

~~~powershell
pnpm exec vitest run --project unit apps/local-api/src/modules/realtime/room-persistence.test.ts
~~~

Expected: FAIL，因为持久化适配器尚不存在。

- [ ] **Step 3: Implement SQLite room persistence**

同一 Board 的 append、compact 和 checkpoint 必须经过串行队列。SQLite 提交成功后才允许同步层确认持久化；失败时关闭对应连接并返回 ROOM_UNAVAILABLE，不得静默仅保存在内存。

- [ ] **Step 4: Write room manager and socket route tests**

使用内存 WebSocket 或 @fastify/websocket 注入覆盖：

- 未登录连接被拒绝。
- Board 不存在返回 BOARD_NOT_FOUND。
- 两个允许用户收到彼此的文档更新和 presence。
- presence 不写 realtime_room_updates。
- 用户目录缓存过期并移除用户后，连接在 5 分钟内关闭。
- manager.close 刷新所有房间。

- [ ] **Step 5: Run room tests and verify RED**

Run:

~~~powershell
pnpm exec vitest run --project unit apps/local-api/src/modules/realtime/board-room-manager.test.ts apps/local-api/src/modules/realtime/realtime-routes.test.ts
~~~

Expected: FAIL，因为 room manager 和路由尚不存在。

- [ ] **Step 6: Implement official tldraw sync rooms**

每个 boardId 只创建一个 TLSocketRoom。房间 schema 必须使用现有 tldraw-adapter 的 board-reference shape schema。WebSocket 路径固定为：

~~~text
/realtime/boards/:boardId
~~~

用户 presence 至少包含 openId、name、department、position、color、cursor 和 selectedShapeIds；presence 不落库。

- [ ] **Step 7: Run tests and verify GREEN**

Run:

~~~powershell
pnpm exec vitest run --project unit apps/local-api/src/modules/realtime
pnpm typecheck
~~~

Expected: PASS。

- [ ] **Step 8: Commit**

~~~powershell
git add apps/local-api/src/modules/realtime apps/local-api/src/app.ts
git commit -m "feat: add durable realtime board rooms"
~~~

---

### Task 7: Realtime Web Store and Authoritative Board Commands

**Files:**

- Create: apps/web/src/features/realtime/use-realtime-board-store.ts
- Create: apps/web/src/features/realtime/use-realtime-board-store.test.tsx
- Create: apps/web/src/features/realtime/CollaborationStatus.tsx
- Create: apps/local-api/src/modules/realtime/board-document-coordinator.ts
- Create: apps/local-api/src/modules/realtime/board-document-coordinator.test.ts
- Modify: apps/web/src/features/canvas/CanvasEditor.tsx
- Modify: apps/web/src/features/boards/BoardPage.tsx
- Modify: apps/web/src/features/board-tabs/WorkspaceShell.tsx
- Modify: apps/web/src/features/board-tabs/workspace-tabs.ts
- Modify: apps/local-api/src/modules/boards/board-routes.ts
- Modify: apps/local-api/src/modules/board-references/board-reference-routes.ts
- Modify: apps/local-api/src/modules/clipboard/clipboard-command-routes.ts

**Interfaces:**

~~~ts
export interface CollaborationConnectionState {
  status: 'connecting' | 'online' | 'reconnecting' | 'offline' | 'error'
  collaborators: readonly AllowedUser[]
  recoverySnapshot?: unknown
}

export interface BoardDocumentCoordinator {
  read(boardId: string): Promise<{ snapshot: unknown; revision: number }>
  runCommand<T>(input: {
    boardId: string
    actorOpenId: string
    reason: string
    mutate(snapshot: unknown): Promise<{ snapshot: unknown; result: T }>
  }): Promise<{ snapshot: unknown; revision: number; result: T }>
}
~~~

- [ ] **Step 1: Write coordinator tests**

验证实时房间打开和关闭时都能运行结构命令；命令前创建 checkpoint；SQLite 引用事务失败时房间状态不变；成功后所有连接收到权威快照；同一 Board 命令串行执行。

- [ ] **Step 2: Run coordinator tests and verify RED**

Run:

~~~powershell
pnpm exec vitest run --project unit apps/local-api/src/modules/realtime/board-document-coordinator.test.ts
~~~

Expected: FAIL，因为协调器尚不存在。

- [ ] **Step 3: Implement the coordinator and migrate structural routes**

Board 引用、跨 Board 粘贴、删除、恢复和服务端导入不得直接绕过协调器改写活动 Board。原子事务继续维护 references、assets、asset_usages 和 revision；成功后用 replaceAuthoritativeSnapshot 广播。

- [ ] **Step 4: Write web realtime store tests**

覆盖：

- URL 使用当前 origin 的 ws/wss 与编码后的 boardId。
- 正常连接返回 tldraw store。
- connecting/reconnecting/online 状态准确。
- 断线期间显示“正在重新连接”。
- 无法恢复时保存 recoverySnapshot 并显示下载入口。
- 同一用户多个标签是独立 clientId，不再因本地编辑租约只读。

- [ ] **Step 5: Run web tests and verify RED**

Run:

~~~powershell
pnpm exec vitest run --project web apps/web/src/features/realtime/use-realtime-board-store.test.tsx
~~~

Expected: FAIL，因为 realtime hook 尚不存在。

- [ ] **Step 6: Integrate useSync and retire collaborative autosave leases**

活动 Board 由 @tldraw/sync 的 useSync store 驱动。BoardSession 不再为画布普通更新 PUT 全量 snapshot；旧 CAS 保存只保留给不经过实时房间的导入/迁移测试路径。editing-lease 不再阻止任何已登录协作者或同一用户的其他设备。

BoardPage 顶部显示连接状态和在线头像；CanvasEditor 继续使用 boardReferenceShapeUtils 和现有 licenseKey。

- [ ] **Step 7: Run tests and verify GREEN**

Run:

~~~powershell
pnpm exec vitest run --project unit apps/local-api/src/modules/realtime/board-document-coordinator.test.ts
pnpm exec vitest run --project web apps/web/src/features/realtime apps/web/src/features/canvas/CanvasEditor.test.tsx apps/web/src/features/board-tabs
pnpm typecheck
~~~

Expected: PASS。

- [ ] **Step 8: Commit**

~~~powershell
git add apps/local-api/src apps/web/src
git commit -m "feat: connect workspace to realtime board rooms"
~~~

---

### Task 8: Local Anchored Comments

**Files:**

- Create: apps/local-api/src/modules/comments/comment-repository.ts
- Create: apps/local-api/src/modules/comments/comment-repository.test.ts
- Create: apps/local-api/src/modules/comments/comment-routes.ts
- Create: apps/local-api/src/modules/comments/comment-routes.test.ts
- Create: apps/web/src/features/comments/comment-client.ts
- Create: apps/web/src/features/comments/CommentSidebar.tsx
- Create: apps/web/src/features/comments/CommentSidebar.test.tsx
- Create: apps/web/src/features/comments/CommentPins.tsx
- Create: apps/web/src/features/comments/CommentPins.test.tsx
- Modify: apps/web/src/features/boards/BoardPage.tsx
- Modify: apps/web/src/features/board-tabs/WorkspaceShell.tsx
- Modify: apps/local-api/src/app.ts

**Interfaces:**

~~~ts
export interface CommentAnchor {
  boardId: string
  shapeId?: string
  x?: number
  y?: number
}

export type CommentStatus = 'open' | 'resolved'

export interface CommentThread {
  id: string
  projectId: string
  anchor: CommentAnchor
  status: CommentStatus
  messages: readonly {
    id: string
    authorOpenId: string
    body: string
    createdAt: string
    deletedAt?: string
  }[]
  createdAt: string
  updatedAt: string
}
~~~

接口：

~~~text
GET    /api/boards/:boardId/comments
POST   /api/boards/:boardId/comments
POST   /api/comments/:commentId/replies
PATCH  /api/comments/:commentId
DELETE /api/comments/:commentId
~~~

- [ ] **Step 1: Write repository and route tests**

覆盖 shape 锚点、坐标锚点、正文 1..5000 字、回复、resolve/reopen、软删除消息、删除线程、Board 不存在、shapeId 消失后线程仍返回且标记 anchorMissing。

- [ ] **Step 2: Run API tests and verify RED**

Run:

~~~powershell
pnpm exec vitest run --project unit apps/local-api/src/modules/comments
~~~

Expected: FAIL，因为评论模块尚不存在。

- [ ] **Step 3: Implement repository and routes**

所有写操作从 request.user.openId 获取作者，忽略客户端提交的作者字段。评论接口只写 SQLite，并通过 BoardRoomManager 的元事件 comment.changed 通知同 Board 客户端重新获取。

- [ ] **Step 4: Write UI tests**

覆盖添加评论模式、点击 Shape 自动选择 shapeId、空白处保存 x/y、线程回复、解决/重新打开、锚点缺失提示和实时刷新事件。

- [ ] **Step 5: Run UI tests and verify RED**

Run:

~~~powershell
pnpm exec vitest run --project web apps/web/src/features/comments
~~~

Expected: FAIL，因为评论 UI 尚不存在。

- [ ] **Step 6: Implement comment sidebar and pins**

评论 pin 是 UI overlay，不写入 tldraw store。CommentPins 使用 Editor 的 pageToScreen 和 camera/shape 变化订阅定位；点击 pin 打开对应线程。所有用户具有同等评论、解决和删除权限。

- [ ] **Step 7: Run tests and verify GREEN**

Run:

~~~powershell
pnpm exec vitest run --project unit apps/local-api/src/modules/comments
pnpm exec vitest run --project web apps/web/src/features/comments apps/web/src/features/boards/BoardPage.test.tsx
pnpm typecheck
~~~

Expected: PASS。

- [ ] **Step 8: Commit**

~~~powershell
git add apps/local-api/src/modules/comments apps/local-api/src/app.ts apps/web/src/features/comments apps/web/src/features/boards apps/web/src/features/board-tabs
git commit -m "feat: add local anchored comments"
~~~

---

### Task 9: Local Audit, Health, and Backups

**Files:**

- Create: apps/local-api/src/modules/audit/audit-repository.ts
- Create: apps/local-api/src/modules/audit/audit-repository.test.ts
- Create: apps/local-api/src/modules/audit/audit-service.ts
- Create: apps/local-api/src/modules/audit/audit-routes.ts
- Create: apps/local-api/src/modules/audit/audit-routes.test.ts
- Create: apps/web/src/features/audit/AuditPanel.tsx
- Create: apps/web/src/features/audit/AuditPanel.test.tsx
- Create: scripts/backup-local-data.ts
- Create: scripts/backup-local-data.test.ts
- Modify: apps/local-api/src/app.ts
- Modify: apps/local-api/src/modules/projects/project-routes.ts
- Modify: apps/local-api/src/modules/boards/board-routes.ts
- Modify: apps/local-api/src/modules/board-references/board-reference-routes.ts
- Modify: apps/local-api/src/modules/files/iboard-routes.ts
- Modify: package.json

**Interfaces:**

~~~ts
export interface AuditEvent {
  id: string
  actorOpenId: string
  projectId?: string
  boardId?: string
  action:
    | 'auth.login'
    | 'auth.logout'
    | 'project.create'
    | 'board.create'
    | 'board.rename'
    | 'board.delete'
    | 'board.restore'
    | 'board.edit'
    | 'reference.create'
    | 'reference.update'
    | 'reference.delete'
    | 'import.commit'
    | 'export.complete'
    | 'comment.create'
    | 'comment.reply'
    | 'comment.resolve'
    | 'comment.reopen'
    | 'comment.delete'
  summary: Record<string, unknown>
  createdAt: string
}
~~~

接口：

~~~text
GET /api/audit?projectId=&boardId=&actorOpenId=&cursor=&limit=
GET /health
~~~

- [ ] **Step 1: Write audit tests**

覆盖不可变 append、cursor 分页、limit 1..100、180 天清理、Board 删除后事件保留、summary 不含 snapshot/token/code/state/comment 正文。实时编辑按用户和 Board 的 5 秒窗口合并为 board.edit，summary 只含 createdCount、updatedCount、deletedCount 和 shapeIds。

- [ ] **Step 2: Run audit tests and verify RED**

Run:

~~~powershell
pnpm exec vitest run --project unit apps/local-api/src/modules/audit
~~~

Expected: FAIL，因为审计模块尚不存在。

- [ ] **Step 3: Implement audit service and instrument semantic actions**

审计由服务端在成功提交后写入；失败或回滚的命令不写成功事件。所有现有领域路由通过 AuditService 记录，不允许客户端直接 POST 审计事件。

- [ ] **Step 4: Write backup and health tests**

备份测试覆盖：

- SQLite backup API 生成一致副本。
- assets 使用 hash 路径复制。
- 临时目录完成后原子改名。
- 保留 7 个日备份和 4 个周备份。
- 失败不删除最近成功备份。

health 测试覆盖 sqlite、userDirectory、realtime 三项状态，且不泄露连接字符串。

- [ ] **Step 5: Run tests and verify RED**

Run:

~~~powershell
pnpm exec vitest run --project unit scripts/backup-local-data.test.ts apps/local-api/src/app.test.ts
~~~

Expected: FAIL，因为备份和扩展 health 尚不存在。

- [ ] **Step 6: Implement backup command and health checks**

根 package.json 新增：

~~~json
{
  "scripts": {
    "backup": "node --env-file-if-exists=.env --import tsx scripts/backup-local-data.ts"
  }
}
~~~

备份目录固定为 INFINITE_BOARD_DATA_DIR/backups。Windows 计划任务每天调用 pnpm backup；部署文档给出创建任务和恢复步骤。

- [ ] **Step 7: Implement the audit panel**

AuditPanel 支持按 Board、人员和动作筛选，使用 cursor 加载更多。所有白名单用户都可查看。

- [ ] **Step 8: Run tests and verify GREEN**

Run:

~~~powershell
pnpm exec vitest run --project unit apps/local-api/src/modules/audit scripts/backup-local-data.test.ts apps/local-api/src/app.test.ts
pnpm exec vitest run --project web apps/web/src/features/audit
pnpm typecheck
~~~

Expected: PASS。

- [ ] **Step 9: Commit**

~~~powershell
git add apps/local-api/src apps/web/src/features/audit scripts package.json docs/deployment/lan-collaboration-server.md
git commit -m "feat: add local audit and backup operations"
~~~

---

### Task 10: End-to-End, Concurrency, Recovery, and Security Acceptance

**Files:**

- Create: tests/e2e/feishu-login.spec.ts
- Create: tests/e2e/realtime-collaboration.spec.ts
- Create: tests/e2e/comments-audit.spec.ts
- Create: tests/e2e/realtime-recovery.spec.ts
- Create: tests/performance/realtime-room-load.test.ts
- Create: scripts/start-e2e-api.ts
- Modify: playwright.config.ts
- Modify: package.json
- Modify: README.md
- Modify: docs/deployment/lan-collaboration-server.md

**Interfaces:**

- Produces: 默认完全离线的 mock OAuth/PostgreSQL E2E、显式真实登录 smoke、并发和恢复验收命令。

新增脚本：

~~~json
{
  "scripts": {
    "dev:api:e2e": "tsx scripts/start-e2e-api.ts",
    "test:realtime:load": "vitest run tests/performance/realtime-room-load.test.ts",
    "e2e:feishu-login:real": "node --env-file-if-exists=.env --import tsx scripts/feishu-login-real-smoke.ts"
  }
}
~~~

- [ ] **Step 1: Write authentication E2E**

覆盖允许用户登录、非白名单拒绝、退出、returnTo、会话过期、User 表删除后 5 分钟内断开。默认 E2E 使用内存 AllowedUserDirectory 和 mock OAuth，不访问真实飞书或 PostgreSQL。

- [ ] **Step 2: Write collaboration E2E**

两个浏览器上下文进入同一 Board，验证 Shape 创建、移动和删除最终一致；光标与选区可见；同一用户两个标签均可编辑；评论在另一客户端出现；操作记录显示两位用户。

- [ ] **Step 3: Write recovery E2E**

测试 API 进程重启后房间从 SQLite 恢复；30 秒网络中断后 5 秒内重连；无法恢复时出现 recoverySnapshot 下载入口；已确认更新零丢失。

- [ ] **Step 4: Write load test**

在单机测试环境创建 10 个活跃编辑连接和 40 个空闲连接，对 2000 Shape Board 执行随机更新。验收：

~~~text
document update p95 <= 300ms
presence update p95 <= 200ms
停止操作后 2s 内所有客户端 snapshot hash 一致
100 轮并发随机测试全部收敛
~~~

- [ ] **Step 5: Run new tests and verify RED**

Run:

~~~powershell
pnpm e2e --grep "Feishu login|realtime collaboration|comments audit|realtime recovery"
pnpm test:realtime:load
~~~

Expected: 在对应能力尚未完整连通时 FAIL；不得通过跳过或放宽断言变绿。

- [ ] **Step 6: Complete mock server and Playwright wiring**

scripts/start-e2e-api.ts 必须显式注入 mock OAuth、内存白名单和临时 SQLite；生产 server.ts 不读取 E2E 配置。playwright.config.ts 使用 dev:api:e2e。

- [ ] **Step 7: Run focused acceptance**

Run:

~~~powershell
pnpm e2e --grep "Feishu login|realtime collaboration|comments audit|realtime recovery"
pnpm test:realtime:load
~~~

Expected: PASS。

- [ ] **Step 8: Run full verification**

Run:

~~~powershell
pnpm test
pnpm test:feishu
pnpm typecheck
pnpm build
pnpm e2e
pnpm test:realtime:load
~~~

Expected: 全部 exit 0；默认命令明确不访问真实飞书和 PostgreSQL。

- [ ] **Step 9: Run security verification**

验证：

- 局域网地址无法连接 8787。
- Caddy HTTPS 和 WebSocket 可用。
- Cookie 包含 Secure、HttpOnly、SameSite=Lax。
- 数据库只读账号执行 INSERT/UPDATE/DELETE 被 PostgreSQL 拒绝。
- SQLite schema、浏览器存储和日志中不存在 access_token、refresh_token、FEISHU_APP_SECRET、USER_DB_PASSWORD。
- 登录完成后没有飞书文档、任务、消息或 Board API 请求。

- [ ] **Step 10: Update documentation and commit**

README 记录登录、实时协作、本地评论、审计、备份和显式真实登录 smoke。部署文档记录 Caddy、Windows 服务、计划备份、恢复和 PostgreSQL 只读授权。

~~~powershell
git add tests scripts playwright.config.ts package.json README.md docs/deployment/lan-collaboration-server.md
git commit -m "test: verify LAN realtime collaboration"
~~~

---

## Final Acceptance Checklist

- [ ] 第一阶段已完成并验收，第二阶段分支基于验收提交。
- [ ] 飞书 OAuth 登录成功，token 只在回调内存中短暂存在。
- [ ] PostgreSQL "User" 表只发生 SELECT，Token 字段完全不读取、不更新。
- [ ] 非白名单用户无法读取、写入或加入实时 Board。
- [ ] 白名单用户拥有相同的项目、Board、评论和审计权限。
- [ ] Fastify 仍只监听 loopback，局域网通过 Caddy HTTPS/WS 访问。
- [ ] 10 名活跃编辑和 40 个连接客户端满足延迟与收敛目标。
- [ ] SQLite 重启恢复、房间压缩、检查点和备份恢复通过。
- [ ] Board 引用、剪贴板、导入和删除事务不会覆盖实时编辑。
- [ ] 锚点评论、回复、解决、删除和缺失锚点提示通过。
- [ ] 操作审计只记录脱敏摘要，保留策略生效。
- [ ] 默认测试与 E2E 不访问真实飞书或 PostgreSQL。
- [ ] pnpm test、pnpm test:feishu、pnpm typecheck、pnpm build、pnpm e2e 和 pnpm test:realtime:load 全部通过。
- [ ] tldraw 团队使用和同步能力的授权门禁已通过。

## Execution Notes

- 按 Task 1–10 顺序执行，每个 Task 完成后做规格和代码质量复审。
- 在 Task 4、Task 7、Task 10 后设置人工检查点；额外工作流和子智能体并非前置条件，且 GPT-5.6 执行时不得使用 Superpowers。
- 不得在第一阶段尚未验收时提前勾选 Gate 0 或开始安装第二阶段依赖。
- 现有 .worktrees/phase2-collaboration 仅为空基线工作树；正式执行前必须确认它已对齐第一阶段验收提交。
