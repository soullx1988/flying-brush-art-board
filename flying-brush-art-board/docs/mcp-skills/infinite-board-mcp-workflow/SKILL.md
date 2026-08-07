---
name: infinite-board-mcp-workflow
description: Safely inspect and operate Infinite Board through the infinite_board MCP server. Use when the user asks to find, create, edit, arrange, comment on, reference, delete, export, or audit Infinite Board projects, boards, or canvas elements, especially when revision checks, atomic batches, idempotency, previews, or confirmation tokens are involved.
---

# Infinite Board MCP Workflow

Use the MCP tool schemas as the source of truth for current fields. Apply the workflow below instead of copying or guessing raw board snapshots.

## Start with context

1. Call `system_get_current_user` and `system_get_capabilities` when starting a new connection or diagnosing access.
2. Resolve names to IDs with `project_list`, `project_get`, `board_list`, and `board_get`.
3. Inspect only what is needed. Prefer `board_inspect`, `shape_list`, and `shape_get` over requesting large amounts of data.
4. If the target is ambiguous, present the matching projects or boards and ask the user to choose before writing.

## Read before writing

- Read the latest board revision immediately before any canvas or reference mutation.
- Use `shape_batch` for related multi-step canvas edits so the server commits one atomic revision.
- Use `shape_layout` for alignment, distribution, grid layout, and layer ordering instead of calculating many independent updates.
- Let the server generate Shape IDs. Do not invent IDs unless a tool schema explicitly requests a client reference.
- Modify board references only with `reference_*` tools, never with ordinary `shape_update` or `shape_delete`.
- When the user asks to insert or create a child board, use `board_create_embedded`. It atomically creates the blank target board and its `embed` reference through the same backend command as the web “插入子画板” tool. Do not emulate this with separate `board_create` and `reference_create` calls.
- Supply a stable `idempotencyKey` for each logical write. Reuse it only when retrying the exact same request with the exact same parameters.

## Handle destructive work

1. Require a clear user request before deleting data.
2. Call the matching `*_delete_preview` tool first.
3. Review the returned impact, target revision, and confirmation token.
4. If the user's request did not clearly authorize that exact impact, show the preview and ask for confirmation.
5. Call the matching confirm/delete tool promptly with the preview token and expected revision.
6. Never reuse or store confirmation tokens. Run preview again if the token expires or the target changes.

## Verify results

- Return created or changed project, board, shape, reference, comment, and operation IDs when available.
- For an asynchronous or uncertain write, call `operation_get` instead of submitting a duplicate request.
- After material canvas changes, inspect or list the affected shapes and report the resulting revision.
- Treat export URLs as short-lived. Give the URL to the user immediately and mention its expiry.
- Keep responses concise; do not expose OAuth credentials, confirmation tokens, internal snapshots, or unrelated audit data.

## Recover from errors

- `REVISION_CONFLICT`: reread the board and affected objects, replan against the new revision, and use a new idempotency key if parameters change.
- `MCP_OPERATION_IN_PROGRESS`: poll `operation_get`; do not issue a duplicate write.
- `MCP_IDEMPOTENCY_CONFLICT`: the key was reused with different parameters; generate a new key for the changed request.
- `MCP_PREVIOUS_OPERATION_FAILED`: inspect the failure, correct the request, and retry with a new key.
- `MCP_CONFIRMATION_INVALID`: rerun the matching preview and reconsider the latest impact.
- `BOARD_REFERENCED` or `ROOT_BOARD_DELETE_FORBIDDEN`: explain the dependency and resolve it only with explicit user approval.
- HTTP `401`: ask the user to re-authenticate or check whether the client was paused or disconnected.
- HTTP `429` or timeout: wait and retry safely; do not fan out additional writes.

## Common task patterns

- Explore: list projects → get project → list/get board → inspect/list shapes.
- Build a board: get latest revision → create related elements with `shape_batch` → apply `shape_layout` if needed → verify shapes.
- Insert a new child board: read the source revision → `board_create_embedded` → verify the returned board and outbound `embed` reference.
- Reference an existing board: get both boards → read source revision → `reference_create` → verify outbound references.
- Discuss work: list existing threads → create or reply → resolve/reopen as requested.
- Delete: preview → present impact when needed → confirm → verify absence.
- Export: verify target → call `export_board` or `export_project` → return the short-lived download URL.
