# 局域网协作服务器部署

Fastify 仅监听 `127.0.0.1:8787` 或 `::1:8787`。局域网用户只能通过 Vite 或 Caddy 提供的同源 HTTPS 和 WSS 入口访问；防火墙开放实际 HTTPS 端口，绝不开放 8787。

1. 为服务器分配稳定的内部 DNS 名称，例如 `board.example.internal`，并设置 `APP_DOMAIN`。
2. 在飞书开发者后台为同一 App ID 分别登记 `https://<局域网域名或 IP>:<端口>/auth/feishu/callback` 和 `https://<局域网域名或 IP>:<端口>/auth/feishu/import/callback`。
3. 按 `.env.example` 创建仅本机可读的 `.env.local`；`SESSION_SECRET` 至少 32 字节。必须显式开启飞书认证和用户白名单，白名单使用飞书 `open_id`，陌生身份在落库和签发会话前即被拒绝。
4. 用 Caddy 启动 [Caddyfile.example](../../deploy/Caddyfile.example)，再以 Windows 服务方式启动 `pnpm dev:api` 的生产等价命令。

## Vite HTTPS LAN 入口

Vite LAN 入口只用于受控的内网验收。在根目录 `.env.local` 至少配置：

```dotenv
LAN_EXPOSURE_ENABLED=true
FEISHU_AUTH_ENABLED=true
FEISHU_WHITELIST_ENABLED=true
FEISHU_ALLOWED_OPEN_IDS=ou_owner,ou_reviewer
FEISHU_APP_ID=cli_xxxxxxxxxxxxxxxx
FEISHU_APP_SECRET=替换为真实密钥
SESSION_SECRET=至少32字节的随机字符串

LAN_HTTPS_PFX=D:\InfiniteBoardSecrets\board.pfx
LAN_HTTPS_PFX_PASSPHRASE=替换为PFX密码
LAN_ALLOWED_HOSTS=board.example.internal,192.168.65.48
LAN_ALLOWED_ORIGINS=https://board.example.internal:4173,https://192.168.65.48:4173
```

分别启动 `pnpm dev:api` 和 `pnpm dev:lan:web`。LAN 配置在启动前验证显式暴露开关、证书、真实 OAuth/会话配置、用户 `open_id` 白名单、精确 Host 与 HTTPS Origin 白名单；任一缺失、通配符、HTTP Origin 或空 PFX 都会拒绝启动，不会降级为 HTTP。Fastify 还会再次校验反向代理传入的 `X-Forwarded-Host` / `X-Forwarded-Proto`；即使 Vite 或 Caddy 被误配为转发请求，未开启 LAN 模式、非 HTTPS 或白名单外入口仍会被 API 拒绝。普通 `pnpm dev` 和 `scripts\start-local.ps1` 仍只监听回环地址，不受此 LAN 配置影响。

## 远程 MCP

MCP 默认关闭。启用 v2 时至少设置：

```dotenv
MCP_ENABLED=true
MCP_PUBLIC_URL=https://board.example.internal:4173
MCP_ALLOWED_HOSTS=board.example.internal
MCP_ALLOWED_ORIGINS=https://board.example.internal:4173
```

`MCP_ALLOWED_HOSTS` 是逗号分隔的外部 Host 白名单；Caddy 会把原始 Host 通过 `X-Forwarded-Host` 传给 Fastify。`Origin` 允许缺省（多数桌面 MCP 客户端不会发送），一旦客户端发送 Origin，则必须命中 `MCP_ALLOWED_ORIGINS`。不要配置 `*`。

Caddy 在配置的 HTTPS 入口提供 `/mcp`、`/oauth/*` 和 `/.well-known/*`，并为 `/mcp` 关闭响应缓冲。Fastify 仍只监听回环地址，Windows 防火墙不得开放 8787。用户从“项目 → 集成 → MCP v2 接入”下载同源 ZIP 配置包，客户端首次连接时完成飞书 OAuth 授权，不创建个人令牌。

部署后可用独立官方 SDK 客户端探针验证：

```powershell
$env:MCP_SERVER_URL = 'https://board.example.internal:4173/mcp'
$env:MCP_OAUTH_ACCESS_TOKEN = '<仅当前 PowerShell 会话使用的短期 OAuth Access Token>'
pnpm smoke:mcp
Remove-Item Env:MCP_OAUTH_ACCESS_TOKEN
```

探针只输出工具名称和数量，不输出令牌、参数或画板 snapshot。管理员可通过登录后的 `/api/mcp/health` 查看调用数、失败数、限流数和 P95 延迟，不包含用户输入。

管理员日常操作：

- 开启或关闭：修改 `MCP_ENABLED` 后重启 API；设为 `false` 会停止 `/mcp`、OAuth 和下载票据服务，不影响 Web 编辑。
- 白名单：MCP 身份继续使用现有飞书用户和白名单校验。用户被移出白名单后，其已有 OAuth 授权立即不可用。
- 暂停或断开：用户可在“项目 → 集成 → MCP v2 接入”暂停、恢复或断开自己的客户端。断开会撤销整个令牌族。
- 审计：写入、导出、认证成功/失败、撤销和限流事件均记录关联的客户端、请求和操作 ID；不记录令牌原文或完整 snapshot。
- 回滚：v2 迁移会删除旧令牌表；必须同时恢复 v2 部署前的应用版本和数据库备份，不支持只回滚其中一项。

常见故障：

- `401`：OAuth 授权过期、已暂停、已断开，或对应用户已不在白名单；在客户端重新 Authenticate。
- OAuth `invalid_scope`：客户端请求了非固定 scope；升级或修复客户端配置，不提供 scope 选择。
- `MCP_HOST_REJECTED` / `MCP_ORIGIN_REJECTED`：检查 Caddy 传入的外部 Host 以及两个允许列表，禁止用 `*` 临时绕过。
- 客户端能连接但看不到新工具：重启客户端或重新加载 MCP 配置，并先调用 `system_get_capabilities`。
- 下载链接失败：下载票据只有 5 分钟有效，且必须由同一用户、同一 OAuth Grant 携带有效 Access Token 访问。

SQLite、资源、实时快照、评论、登录用户和审计均位于 `INFINITE_BOARD_DATA_DIR`（未设置时为 `%LOCALAPPDATA%\InfiniteBoard`）。不要把 `.env`、飞书 secret、会话密钥或数据目录加入 Git、浏览器存储和日志。

## 备份计划任务

在服务账号的 PowerShell 中每天运行一次 `scripts\backup.ps1`。该脚本使用 SQLite backup API 创建一致性备份，并在成功后保留最近 7 个日备份和 4 个更早周备份。示例（请将路径替换为实际仓库路径）：

```powershell
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -ExecutionPolicy Bypass -File "G:\work\策划\无限画布\scripts\backup.ps1"'
$trigger = New-ScheduledTaskTrigger -Daily -At 02:00
Register-ScheduledTask -TaskName 'InfiniteBoardBackup' -Action $action -Trigger $trigger -RunLevel Highest
```

还原前必须停止本地 API；完整还原和恢复点流程见[备份与恢复](../backup-and-restore.md)。
