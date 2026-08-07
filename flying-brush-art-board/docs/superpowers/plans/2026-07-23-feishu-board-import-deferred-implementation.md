# 飞书画板导入（延期）实施计划

> **执行提示：** 每个 Task 使用测试先行并经过复核。是否使用任何额外工作流或子智能体由执行模型自行判断；当执行模型为 GPT-5.6 时，不得使用 Superpowers，详见项目根目录 `AGENTS.md`。

**Status:** Deferred by user. Do not execute until the user explicitly starts this plan and provides any required Feishu authorization.

**Goal:** Safely import a Feishu whiteboard into a new local Board by using documented Feishu APIs, mock-first contracts, a compatibility report, and a separately gated real-account acceptance flow.

**Architecture:** The local Fastify API owns OAuth state, encrypted credentials, Feishu API requests, resource localization, and import transactions. `packages/interop` maps Feishu nodes to `InteropScene`; the Web wizard performs inspect → preview → explicit commit. Normal development uses the Task 3 mock provider exclusively; real Feishu requests are opt-in and serial.

**Tech Stack:** TypeScript strict mode, Fastify, Zod, SQLite/local content-addressed assets, React, Vitest, Playwright, existing `packages/interop` and `packages/test-fixtures`.

## Global Constraints

- This plan is deferred and must not run as part of the first-stage plan.
- Use only documented Feishu OpenAPI with `user_access_token`; do not use cookies, private endpoints, or browser-session scraping.
- Expected initial scopes: `board:whiteboard:node:read`, `docx:document:readonly`, `wiki:node:retrieve`, `docs:document.media:download`, `offline_access`.
- Tokens, App Secret, authorization code, raw responses, unredacted user content, and real preview images must not enter Git, logs, browser localStorage, or fixtures.
- Default `pnpm test`, `pnpm e2e`, CI, and `pnpm test:feishu` use mock contracts only and must not read `.env.local` or access Feishu network.
- Real calls require local `.env.local`, `FEISHU_REAL_SMOKE=1`, and explicit serial commands `pnpm smoke:feishu:real` / `pnpm e2e:feishu:real`; otherwise print `SKIPPED: awaiting user authorization` and exit successfully.
- Import creates one new Board by default and never reconstructs the local Project reference graph from ordinary Feishu links.
- All external input is Zod-validated; downloaded media is checked for MIME, byte length, and SHA-256.

---

### Task 1: OAuth v3 and encrypted local credential lifecycle

**Files:**

- Create: `apps/local-api/src/modules/feishu/oauth-routes.ts`
- Create: `apps/local-api/src/modules/feishu/oauth-service.ts`
- Create: `apps/local-api/src/modules/feishu/credential-store.ts`
- Create: `apps/web/src/features/feishu/FeishuConnectionPanel.tsx`
- Test: `apps/local-api/src/modules/feishu/oauth-service.test.ts`
- Test: `tests/e2e/feishu-oauth.spec.ts`

**Interfaces:**

```ts
GET    /auth/feishu/import/start
GET    /auth/feishu/import/callback
GET    /api/integrations/feishu/status
POST   /api/integrations/feishu/refresh
DELETE /api/integrations/feishu/account
```

> Route isolation: these import-connection endpoints deliberately avoid the
> unscoped future phase-2 identity-login `/auth/feishu/start` and callback routes.

- [ ] Write mock-provider tests for successful approval, denial, invalid state, expired state, revocation, refresh rotation, and redacted logs.
- [ ] Confirm the tests fail because the OAuth service and routes do not exist.
- [ ] Implement random state, Confidential Client loopback callback, encrypted local credential storage, and atomic refresh-token rotation. Do not send PKCE parameters for the developer-created Feishu app; retain RFC 7636 S256 only as an explicit future Public Client option.
- [ ] Implement the connection panel without putting credentials in browser storage.
- [ ] Run focused tests, `pnpm typecheck`, and mock OAuth E2E; commit `feat: add Feishu OAuth connection`.

### Task 2: Feishu URL resolution and documented Board API client

**Files:**

- Create: `apps/local-api/src/modules/feishu/url-resolver.ts`
- Create: `apps/local-api/src/modules/feishu/board-client.ts`
- Create: `apps/local-api/src/modules/feishu/wiki-docx-client.ts`
- Test: `apps/local-api/src/modules/feishu/url-resolver.test.ts`
- Test: `apps/local-api/src/modules/feishu/board-client.test.ts`

**Interfaces:**

```ts
resolveWhiteboardToken(url: string, client: WikiDocxClient): Promise<string>
listWhiteboardNodes(token: string): Promise<unknown>
getWhiteboardTheme(token: string): Promise<unknown>
downloadWhiteboardPreview(token: string): Promise<Uint8Array>
downloadMedia(mediaToken: string): Promise<{ bytes: Uint8Array; mime: string; sha256: string }>
```

- [ ] Write mock-only tests for bare token, Board URL, Wiki/Docx `blockToken`, cancellation, timeout/retry, scope denial, MIME/size/hash failures, and rate-limit guidance.
- [ ] Confirm the tests fail before client implementation.
- [ ] Implement documented API client with cancellable requests, timeouts, exponential backoff, and explicit scope repair messages; do not auto-expand scopes.
- [ ] Run focused tests and typecheck; commit `feat: add Feishu board API client`.

### Task 3: Node mapping, local resource materialization, and compatibility preview

**Files:**

- Create: `packages/interop/src/feishu/node-schema.ts`
- Create: `packages/interop/src/feishu/map-nodes.ts`
- Create: `packages/interop/src/feishu/theme-map.ts`
- Create: `apps/local-api/src/modules/feishu/import-feishu-service.ts`
- Test: `packages/interop/src/feishu/map-nodes.test.ts`
- Test: `apps/local-api/src/modules/feishu/import-feishu-service.test.ts`

**Interfaces:**

```ts
mapFeishuNodes(nodes: unknown): ImportResult<InteropScene>
importFeishuBoard(input: { whiteboardToken: string; projectId?: string }): Promise<ImportPreview>
```

- [ ] Write fixtures for shapes, text, sticky notes, images, connectors, sections, tables, freehand, SVG, and mind maps; include editable, downgraded, rasterized, unsupported, and resource-download-failure outcomes.
- [ ] Confirm tests fail before schemas and mapper exist.
- [ ] Map only validated nodes to `InteropScene`; preserve unsupported source payload and actionable compatibility report entries.
- [ ] Materialize downloaded assets into the existing content-addressed store; preserve failed media source payload/report without creating a partial Board.
- [ ] Use anonymous mock preview baselines for dimensions, bounding boxes, and key colors. Keep real visual comparison outside default tests.
- [ ] Run focused tests and typecheck; commit `feat: map Feishu whiteboard nodes`.

### Task 4: Inspect/commit wizard, mock acceptance, and real authorization gate

**Files:**

- Create: `apps/web/src/features/feishu/FeishuImportWizard.tsx`
- Create: `apps/local-api/src/modules/feishu/import-routes.ts`
- Create: `tests/e2e/feishu-import.spec.ts`
- Create: `tests/e2e/feishu-import.real.spec.ts`
- Create: `docs/feishu-import-troubleshooting.md`
- Modify: `docs/adr/0002-feishu-scopes.md`

**Interfaces:**

```text
POST /api/import/feishu/inspect
POST /api/import/feishu/commit
```

- [ ] Write mock E2E for link input, authorization, node fetch, preview, compatibility report, target-project selection, cancellation, timeout, resource failure, inspect zero writes, and commit creating one new Board.
- [ ] Confirm it fails before wizard/routes exist.
- [ ] Implement inspect → preview → explicit commit; use temporary resources/session cleanup on cancel, timeout, and failure.
- [ ] Ensure ordinary Feishu links never silently create local `board_references`.
- [ ] Add troubleshooting covering scopes, tenant approval, authorization failure, media failure, and downgrade categories.
- [ ] Run mock tests: `pnpm test:feishu`, Feishu mock E2E, full default test/typecheck/build/e2e; commit `feat: add Feishu whiteboard import wizard`.

### Task 5: User-authorized real API and visual acceptance

**Precondition:** The user supplies App ID/App Secret locally in `.env.local`, authorizes the app, and explicitly requests real acceptance. Do not ask them to send credentials in chat.

- [ ] Enable `FEISHU_REAL_SMOKE=1` locally and complete OAuth against the authorized target Board.
- [ ] Run `pnpm smoke:feishu:real`; verify nodes, theme, preview, and media download serially.
- [ ] Convert responses to anonymized fixtures, manually inspect them, and only then add approved fixtures to tests.
- [ ] Run `pnpm e2e:feishu:real`; compare import output to the official preview.
- [ ] Update `docs/adr/0002-feishu-scopes.md` from `pending-user-authorization` to `verified` only after all real checks pass.
- [ ] Record any failure as blocking only the claim “Feishu real import accepted”; it must not roll back local Board, reference, clipboard, or file-import capabilities.

## Acceptance Checklist

- [ ] Mock OAuth/API/import tests do not contact Feishu network.
- [ ] Inspect leaves Project, Board, reference, and asset usage unchanged.
- [ ] Commit creates exactly one new Board with a compatibility report and no inferred local reference graph.
- [ ] Tokens and raw user data never appear in repository, logs, or browser storage.
- [ ] Real commands skip cleanly until user authorization is available.
- [ ] Real Feishu acceptance is separately recorded as pending or verified.
