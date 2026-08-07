# Feishu whiteboard import troubleshooting

Normal tests and E2E use local mock contracts only. They do not read `.env.local` or contact Feishu. Real acceptance remains pending until the separately gated Task 5 flow is explicitly authorized.

## Connection, tenant, and scopes

- **Connection required / authorization denied:** reconnect from the import panel. Never put App Secret, authorization codes, or tokens in browser storage, logs, Git, fixtures, or chat.
- **Tenant approval required:** an organization administrator may need to publish and approve the app. Approval in one tenant does not grant access in another.
- **Wrong tenant/document:** connect an account that can open the source whiteboard and verify app approval in that tenant.
- Initial scopes are `board:whiteboard:node:read`, `docx:document:readonly`, `wiki:node:retrieve`, `docs:document.media:download`, and `offline_access`. Approve a reported missing scope and reconnect; scopes are never silently expanded.

## Media, cancellation, and timeout

- `FEISHU_MEDIA_DOWNLOAD_FAILED`: verify `docs:document.media:download`, source availability, MIME and size restrictions, then inspect again. Commit remains blocked and no partial Board or asset is retained.
- Timeout, cancellation, expiry, or closing the wizard invalidates temporary inspect data. Inspect again before confirming.
- Hash, MIME, and byte-length failures are resource failures. Inspect does not persist raw media or preview bytes.

## Compatibility categories

- **Editable:** native local shapes.
- **Downgraded:** editable with reduced Feishu-specific behavior or layout.
- **Rasterized:** visual preservation with reduced editability.
- **Unsupported:** a source-aware placeholder/report entry instead of a guessed conversion.

Ordinary Feishu links remain ordinary text/links; import never infers local `board_references`. Confirming creates exactly one new Board in the selected project, or one Board as the root of a new project.
