# 在其他 Windows 机器部署 Infinite Board

本文适用于 Windows 10/11 或 Windows Server，项目仅面向桌面端 Web 浏览器，最低支持宽度为 1024px。

远程仓库：`https://gitee.com/xiamenpipijiangwangluo/flying-brush-art-board.git`

## 1. 部署方式选择

项目有两种运行方式：

- **内网验收模式**：安装简单，使用固定本地用户，不需要飞书和 PostgreSQL。只适合可信内网或单机验收。
- **正式协作模式**：使用局域网 HTTP、飞书 OAuth、用户白名单、实时协作和审计。适合可信内网部署。

不要把内网验收模式直接暴露到公网。

## 2. 系统要求

- 64 位 Windows。
- Git。
- Node.js `>=22.13 <23`，推荐 Node.js 22 LTS。
- pnpm `11.9.0`。
- 至少 4 GB 可用内存。
- 建议为应用数据预留独立目录，例如 `D:\InfiniteBoardData`。
- 正式协作模式额外需要 Caddy、可用域名、PostgreSQL 用户表和飞书应用。

安装 Node.js 后，以管理员身份打开 PowerShell：

```powershell
corepack enable
corepack prepare pnpm@11.9.0 --activate
node --version
pnpm --version
```

## 3. 获取代码和安装依赖

```powershell
git clone https://gitee.com/xiamenpipijiangwangluo/flying-brush-art-board.git
Set-Location .\flying-brush-art-board
git checkout main
pnpm install --frozen-lockfile
```

必须使用 `--frozen-lockfile`，这样 tldraw 的项目补丁也会自动应用。

## 4. 内网验收模式

### 4.1 配置环境

复制环境变量模板：

```powershell
Copy-Item .env.example .env.local
```

编辑根目录 `.env.local`，至少确认以下内容：

```env
FEISHU_AUTH_ENABLED=false
FEISHU_WHITELIST_ENABLED=false
INFINITE_BOARD_DATA_DIR=D:\InfiniteBoardData
```

如已购买 tldraw 商业许可证，在 `apps\web\.env.local` 中配置：

```env
VITE_TLDRAW_LICENSE_KEY=你的许可证密钥
```

不要提交任何 `.env.local` 文件。

### 4.2 启动

```powershell
pnpm dev
```

默认地址：

- Web：`http://127.0.0.1:4173`
- API 健康检查：`http://127.0.0.1:8787/health`
- 局域网访问：`http://服务器IP:4173`

Web 服务监听局域网地址，API 只监听回环地址，并由 Vite 代理 `/api`、`/auth` 和 `/realtime`。

如果其他电脑无法访问，使用管理员 PowerShell 开放 Web 端口：

```powershell
New-NetFirewallRule -DisplayName 'Infinite Board Web 4173' -Direction Inbound -Protocol TCP -LocalPort 4173 -Action Allow
```

不要对局域网开放 8787 端口。

## 5. 正式协作模式

### 5.1 准备域名和飞书应用

1. 为服务器配置稳定的内部域名，例如 `board.example.internal`。
2. 将域名解析到服务器地址。
3. 在飞书开放平台创建应用。
4. 将 OAuth 回调地址设置为：

```text
http://192.168.65.48:4173/auth/feishu/callback
```

5. 配置应用所需的白板、文档、媒体读取权限。

### 5.2 登录用户记录

飞书用户首次登录后，项目会在本地 SQLite 的 `app_users` 表记录必要身份信息和最近登录时间。无需部署 PostgreSQL，且不会保存登录 access token。

### 5.3 配置正式环境变量

在项目根目录创建 `.env.local`：

```env
NODE_ENV=production
PORT=8787

FEISHU_REAL_SMOKE=1
FEISHU_AUTH_ENABLED=true
FEISHU_WHITELIST_ENABLED=false
FEISHU_APP_ID=cli_xxxxxxxxxxxxxxxx
FEISHU_APP_SECRET=替换为真实密钥

SESSION_SECRET=至少32字节的随机字符串

INFINITE_BOARD_DATA_DIR=D:\InfiniteBoardData

AUDIT_RETENTION_DAYS=80

MCP_ENABLED=false
MCP_PUBLIC_URL=http://192.168.65.48:4173
MCP_ALLOWED_HOSTS=192.168.65.48
MCP_ALLOWED_ORIGINS=http://192.168.65.48:4173
```

生成会话密钥示例：

```powershell
$bytes = New-Object byte[] 48
[Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
[Convert]::ToBase64String($bytes)
```

### 5.4 构建项目

如有 tldraw 许可证，先在 `apps\web\.env.production.local` 配置：

```env
VITE_TLDRAW_LICENSE_KEY=你的许可证密钥
```

然后构建全部 workspace 包、API 和前端：

```powershell
pnpm install --frozen-lockfile
pnpm build
```

构建产物：

- Web：`apps\web\dist`
- API：`apps\local-api\dist`
- 内部包：`packages\*\dist`

### 5.5 启动 API

在项目根目录执行：

```powershell
node --env-file=.env.local apps/local-api/dist/server.js
```

API 必须保持监听 `127.0.0.1:8787`。健康检查：

```powershell
Invoke-RestMethod http://127.0.0.1:8787/health
```

正常响应中的 `status`、`database` 和 `userDirectory` 应为 `ok`。

生产环境可使用 WinSW、NSSM 或 Windows 任务计划程序将上述命令注册为开机启动服务。服务工作目录必须是项目根目录，运行账号必须对 `INFINITE_BOARD_DATA_DIR` 有读写权限。

### 5.6 配置 Caddy

下载 Caddy，将 `deploy\Caddyfile.example` 复制为服务器使用的 `Caddyfile`。启动前设置：

```powershell
$env:APP_DOMAIN = 'board.example.internal'
$env:WEB_ROOT = 'D:\apps\flying-brush-art-board\apps\web\dist'
caddy run --config .\Caddyfile
```

Caddy 会：

- 提供前端静态文件。
- 将 `/api/*`、`/auth/*`、`/realtime*`、`/health`、`/mcp`、`/oauth/*` 和 `/.well-known/*` 反向代理到本机 API。
- 为 WebSocket 实时协作提供同源入口。
- 为 `/mcp` 关闭响应缓冲，支持 Streamable HTTP。
- 为前端路由回退到 `index.html`。

防火墙开放实际 Web HTTP 端口，例如 TCP 4173 或 80；不要开放 8787。

### 5.7 启用远程 MCP（可选）

先保持 `MCP_ENABLED=false` 完成普通 Web 验收。启用 v2 前必须备份数据库；将其改为 `true`，并确认 `MCP_PUBLIC_URL`、`MCP_ALLOWED_HOSTS` 和 `MCP_ALLOWED_ORIGINS` 都使用同一个实际 HTTP Origin，然后重启 API。

用户登录 Web 后，在“项目 → 集成 → MCP v2 接入”下载 Windows 配置脚本。脚本使用当前网页 Origin 加 `/mcp`，不携带凭证；客户端首次连接时通过飞书 OAuth 授权。

管理员可在已登录浏览器中访问 `/api/mcp/health` 查看聚合指标。可用仓库内独立 SDK 探针验收：

```powershell
$env:MCP_SERVER_URL = 'http://192.168.65.48:4173/mcp'
$env:MCP_OAUTH_ACCESS_TOKEN = '<仅用于验收的短期 OAuth Access Token>'
pnpm smoke:mcp
Remove-Item Env:MCP_OAUTH_ACCESS_TOKEN
```

详细客户端配置、工具和错误处理见[远程 MCP 同事使用指南](../remote-mcp-user-guide.md)。

### 5.8 验收

```powershell
Invoke-RestMethod http://192.168.65.48:4173/health
```

然后在桌面浏览器中检查：

1. 飞书登录和白名单校验。
2. 新建项目与画板。
3. 文本、图片、连接线和子画板操作。
4. 两个浏览器窗口同时编辑同一画板。
5. 评论、保存状态和审计记录。
6. 导入和导出。
7. 开启 MCP 后，执行 SDK 探针，并从一个测试客户端调用只读工具和一次受控写入。

## 6. 从旧机器迁移数据

### 6.1 在旧机器创建备份

停止频繁编辑后执行：

```powershell
.\scripts\backup.ps1 -LocalAppDataBase 'D:\AppData' -BackupDirectory 'E:\InfiniteBoardBackups'
```

`-LocalAppDataBase` 是数据目录的父目录，脚本会使用其下的 `InfiniteBoard` 子目录。

### 6.2 在新机器恢复

1. 在新机器启动一次应用，使数据库和目录初始化。
2. 停止 API，确认 8787 已不再监听。
3. 将完整备份目录复制到新机器。
4. 执行：

```powershell
.\scripts\restore.ps1 `
  -LocalAppDataBase 'D:\AppData' `
  -BackupDirectory 'E:\InfiniteBoardBackups\backup-具体时间戳'
```

数据库和资源文件必须一起迁移。浏览器标签、撤销历史和未保存草稿不会迁移。

飞书凭据的保护密钥与 Windows 机器相关，迁移后应在新机器重新完成飞书授权，不要直接复用旧机器的凭据文件。

## 7. 更新版本

先备份，然后执行：

```powershell
git fetch origin
git checkout main
git pull --ff-only origin main
pnpm install --frozen-lockfile
pnpm build
```

完成后重启 API 和 Caddy。不要在服务器上直接修改源码，否则 `git pull --ff-only` 可能失败。

## 8. 常见问题

### 依赖安装失败

- 确认 Node.js 主版本为 22。
- 确认 pnpm 为 11.9.0。
- 使用 `pnpm install --frozen-lockfile`，不要删除项目补丁配置。

### 页面能打开但 API 请求失败

- 检查 `http://127.0.0.1:8787/health`。
- 检查 Caddy 是否代理 `/api/*` 和 `/auth/*`。
- 检查 API 是否仍只监听回环地址。

### 实时协作无法连接

- 检查 Caddy 是否代理 `/realtime*`。
- 检查浏览器开发者工具中的 WebSocket 状态。
- 确认正式模式的健康检查返回 `realtime: ok`。

### MCP 无法连接

- 确认服务器已设置 `MCP_ENABLED=true` 并重启。
- 确认客户端 URL 为 `https://实际域名/mcp`，不是 `127.0.0.1:8787`。
- 检查 Vite 或 Caddy 是否代理 `/mcp`，Windows 防火墙已开放实际 Web HTTP 端口且未开放 8787。
- `401` 时在客户端重新 Authenticate，并确认授权没有被暂停或断开、用户仍在飞书白名单。
- `MCP_HOST_REJECTED` 或 `MCP_ORIGIN_REJECTED` 时检查允许列表，不要配置通配符。

### 飞书回调失败

- 登录回调地址根据用户打开网页时的协议和 Host 动态生成，路径固定为 `/auth/feishu/callback`。
- 飞书开发者后台仍需登记所有实际使用的网页来源对应回调地址。
- 飞书后台登记的回调地址必须逐字一致。

### 图片或数据丢失

- 检查 `INFINITE_BOARD_DATA_DIR` 是否指向正确目录。
- 确认 SQLite 文件和 `assets` 目录一起恢复。
- 不要把数据目录放在 Git 仓库内。

更多信息：

- [备份与恢复](../backup-and-restore.md)
- [局域网协作服务器](lan-collaboration-server.md)
- [远程 MCP 同事使用指南](../remote-mcp-user-guide.md)
- [安全与隐私](../security-and-privacy.md)
- [飞书导入故障排查](../feishu-import-troubleshooting.md)
