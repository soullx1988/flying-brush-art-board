# ADR 0002: Feishu scopes and deferred real authorization

- Status: `pending-user-authorization`
- Date: 2026-07-23
- Decision: implement Feishu import mock-first and do not access a real Feishu account before explicit user authorization.

## Initial scopes

The import uses user OAuth and requests only:

- `board:whiteboard:node:read`
- `docx:document:readonly`
- `wiki:node:retrieve`
- `docs:document.media:download`
- `offline_access`

The application never expands scopes automatically. Tenant approval and documented API errors determine any future revision.

## Mock contract

Default `pnpm test`, `pnpm test:feishu`, `pnpm e2e`, and CI cover mock token, nodes, theme, preview, and media download contracts. They do not read `.env.local`, select the real provider, or contact the Feishu network. Only anonymized, manually reviewed fixtures may enter Git.

## Inspect and commit boundary

`POST /api/import/feishu/inspect` is zero-write. Preview and media bytes remain in an expiring in-memory session and do not create Projects, Boards, assets, asset usages, or `board_references`. Cancellation, failure, timeout, expiry, and resource-validation failure discard temporary data.

`POST /api/import/feishu/commit` requires explicit confirmation and consumes the session once. It creates exactly one Board in a selected existing project, or exactly one root Board in a new project. Source and compatibility-report metadata are persisted. Ordinary Feishu links never derive local `board_references`.

## Real authorization gate

Real smoke/E2E requires local `.env.local`, `FEISHU_REAL_SMOKE=1`, and explicit commands:

```bash
pnpm smoke:feishu:real
pnpm e2e:feishu:real
```

The E2E marker is `@feishu-real`. Missing variables or authorization must print `SKIPPED: awaiting user authorization` and exit successfully. Task 4 creates only this gate; Task 5 owns real authorization acceptance and may change the ADR status to `verified`.

App Secret, OAuth token/code, raw API responses, user document URLs/content, preview images, and media content do not enter Git, normal logs, browser storage, fixtures, or chat. A real-acceptance failure blocks only the claim that real Feishu import has been accepted; local Board, references, clipboard, and file import remain unaffected.
