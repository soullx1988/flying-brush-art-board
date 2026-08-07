# 192.168.64.128 Infinite Board MCP 升级交接

## 交接目标

在 `192.168.64.128` 的现有 Infinite Board 部署上更新 `main` 分支，并首次启用远程 MCP v2。

目标版本：

```text
commit: e0b1f4aedbefe480a2727bdf22bed48e7bde41f7
subject: fix MCP child boards and local development
```

完成后必须保证：

- 现有项目、画板、图片、评论和登录用户数据仍然可用。
- Web 和实时协作功能正常。
- MCP OAuth、工具列表和读写调用正常。
- MCP 工具 `board_create_embedded` 创建的子画板，在展示和操作上与网页“插入子画板”一致。

## 给服务器 Codex 的执行指令

请先完整阅读本文，再执行。可以更新代码、安装依赖、构建、修改服务器本地环境配置并重启本项目相关服务；不得删除或覆盖现有数据目录，不得提交 `.env.local`、密钥、数据库或备份文件。

遇到以下情况必须停止并向用户报告，不得猜测：

- 无法确定项目实际安装目录。
- 无法确定 `INFINITE_BOARD_DATA_DIR` 的真实值。
- 仓库存在未提交的服务器本地代码修改。
- 当前分支无法 fast-forward 到 `origin/main`。
- 备份失败或无法验证备份文件存在。
- 不清楚服务器使用 `start-dev.bat`、Windows 服务、计划任务、NSSM、WinSW 还是 Caddy 启动。
- 浏览器实际访问 Origin 不是 `http://192.168.64.128:4173`。

不得在终端输出、交接报告或聊天中展示 `FEISHU_APP_SECRET`、`SESSION_SECRET`、OAuth Token 或数据库内容。

## 第一阶段：只读盘点

在服务器项目目录中执行：

```powershell
git status --short --branch
git remote -v
git log -1 --oneline --decorate
node --version
pnpm --version
Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in 4173,8787,80,443 }
```

检查但不要回显敏感值：

```powershell
$requiredNames = @(
  'FEISHU_APP_ID',
  'FEISHU_APP_SECRET',
  'SESSION_SECRET',
  'INFINITE_BOARD_DATA_DIR'
)

$envLines = Get-Content -LiteralPath '.env.local'
foreach ($name in $requiredNames) {
  $present = [bool]($envLines | Where-Object { $_ -match ('^' + [regex]::Escape($name) + '=.+$') })
  [pscustomobject]@{ Name = $name; Present = $present }
}
```

同时检查当前启动方式：Windows 服务、计划任务、NSSM、WinSW、Caddy 或手工启动窗口。记录服务名称、工作目录和启动命令，但不要立刻停止。

预期版本要求：

- Node.js：`>=22.13 <23`
- pnpm：`11.9.0`

如果仓库有本地修改，先报告文件列表，由用户决定如何处理；不得使用 `git reset --hard` 或覆盖文件。

## 第二阶段：确认真实数据目录并备份

`INFINITE_BOARD_DATA_DIR` 必须以服务器现有 `.env.local` 或服务配置中的真实值为准。不要采用示例路径，不要改成仓库内的 `.infinite-board-data`。

1. 通知用户进入维护窗口，暂停画板编辑。
2. 停止 Infinite Board API 进程或服务。
3. 确认 `127.0.0.1:8787` 已不再监听。
4. 备份整个数据目录，包括 SQLite 主文件、`-wal`、`-shm`、资源文件和凭据文件。
5. 验证备份目录存在且文件数量、主要文件大小合理。

建议将备份放在数据目录之外，并使用带时间戳的新目录。禁止覆盖旧备份。

如果项目现有 `scripts/backup.ps1` 与实际目录结构匹配，优先使用该脚本；否则在 API 完全停止后复制整个真实数据目录。备份未完成前不得启动新版本 API。

## 第三阶段：更新代码与依赖

确认工作树没有待处理修改后执行：

```powershell
git fetch origin
git checkout main
git pull --ff-only origin main
git rev-parse HEAD
pnpm install --frozen-lockfile
pnpm build
```

`git rev-parse HEAD` 必须输出：

```text
e0b1f4aedbefe480a2727bdf22bed48e7bde41f7
```

构建必须成功生成：

- `apps\web\dist`
- `apps\local-api\dist`
- `packages\*\dist`

不得跳过 `pnpm install --frozen-lockfile`。本版本包含依赖锁定、内部包预构建和 MCP 工具变更。

## 第四阶段：首次启用 MCP

保留服务器 `.env.local` 中现有的飞书配置、`SESSION_SECRET` 和 `INFINITE_BOARD_DATA_DIR`。不要重新生成 `SESSION_SECRET`。

若用户实际从 `http://192.168.64.128:4173` 访问，在 `.env.local` 中设置：

```env
MCP_ENABLED=true
MCP_PUBLIC_URL=http://192.168.64.128:4173
MCP_ALLOWED_HOSTS=192.168.64.128
MCP_ALLOWED_ORIGINS=http://192.168.64.128:4173
```

配置规则：

- `MCP_PUBLIC_URL` 是浏览器和 MCP 客户端实际访问的 Origin，包含协议以及实际端口。
- `MCP_ALLOWED_HOSTS` 只写主机名或 IP，不写协议、路径或通配符。
- `MCP_ALLOWED_ORIGINS` 写完整 Origin，包含协议和实际端口。
- 如果使用域名、80/443 或 HTTPS，三项必须按真实入口修改，不能照抄上述 IP 示例。
- 禁止配置 `*`。

### 使用 Vite / start-dev.bat

新版 Vite 已代理以下路径到本机 API：

```text
/api
/auth
/health
/realtime
/mcp
/oauth
/.well-known
```

防火墙只需开放实际 Web 端口（当前示例为 TCP 4173），不要向局域网开放 8787。

### 使用 Caddy / 静态生产部署

对照仓库 `deploy\Caddyfile.example` 更新服务器 Caddy 配置，必须同时代理：

```text
/mcp
/mcp/*
/oauth/*
/.well-known/*
/api/*
/auth/*
/realtime*
/health
```

`/mcp` 反向代理必须关闭响应缓冲，并传递原始 Host/Proto。静态站点根目录应指向新构建的 `apps\web\dist`。

## 第五阶段：启动与数据库迁移

只需重启本项目的 API、Web 服务和 Caddy（如使用），不要求重启整台 Windows；如果选择重启机器，仍然必须完成前述配置、安装和构建。

重要事项：

- 确保旧 API 进程已经停止，否则端口检测可能继续沿用旧代码。
- API 启动时会自动、事务性地执行缺失的 SQLite migration。
- 首次从无 MCP 的旧版本升级时，会自动创建 MCP OAuth、操作记录和确认记录相关表。
- 不要手工执行 SQL。
- 数据库迁移后，如需回滚，必须同时恢复升级前代码和升级前完整数据备份。

生产 API 启动命令参考：

```powershell
node --env-file=.env.local apps/local-api/dist/server.js
```

实际应继续使用服务器原有、已经确认的服务管理方式，并确保工作目录为项目根目录。

## 第六阶段：服务验收

### 1. 本机 API

```powershell
Invoke-RestMethod http://127.0.0.1:8787/health
```

确认 HTTP 成功，数据库和用户目录状态正常。

### 2. 局域网统一入口

若实际入口为 `http://192.168.64.128:4173`：

```powershell
Invoke-RestMethod http://192.168.64.128:4173/health
Invoke-RestMethod http://192.168.64.128:4173/.well-known/oauth-protected-resource/mcp
Invoke-RestMethod http://192.168.64.128:4173/.well-known/oauth-authorization-server
```

确认 MCP 资源地址指向：

```text
http://192.168.64.128:4173/mcp
```

### 3. Web 回归

在真实桌面浏览器中验证：

- 飞书登录和退出正常。
- 原有项目、画板、图片和评论仍然存在。
- 新建项目、编辑、保存和刷新正常。
- 两个浏览器窗口编辑同一画板时实时同步正常。
- 网页“插入子画板”可创建、显示、进入和返回。
- 浏览器控制台和服务端没有持续的 WebSocket 代理错误。

### 4. MCP 首次授权

该服务器此前没有 MCP，客户端需要首次安装配置并完成 OAuth 授权，不存在需要迁移的旧 MCP Token。

登录 Web 后，从“项目 → 集成 → MCP v2 接入”下载或运行 Windows 配置包。客户端完成授权后，新开一个 Codex 任务以刷新工具目录。

只读验收：

1. 调用 `system_get_current_user`。
2. 调用 `system_get_capabilities`。
3. 确认 `features.atomicEmbeddedBoardCreate` 为 `true`。
4. 确认工具列表包含 `board_create_embedded`。
5. 调用 `project_list`，确认可以读取现有项目。

受控写入验收应使用专门的测试项目：

1. 读取测试根画板当前 revision。
2. 调用 `board_create_embedded`，指定清晰的测试名称和不覆盖现有内容的坐标。
3. 调用 `reference_list(direction=outbound)`，确认新增引用的 `kind` 为 `embed`。
4. 在真实浏览器打开根画板，确认卡片显示“子画板”，尺寸和网页工具一致，缩略图可见。
5. 验证进入画板、在新标签页打开、重命名目标画板、切换引用类型和移除引用等原生操作可用。

不要再使用 `board_create + reference_create` 模拟“插入子画板”；新建关联子画板必须使用原子工具 `board_create_embedded`。

## 完成交接报告格式

服务器 Codex 完成后，应向用户报告：

```text
部署目录：<实际路径>
数据目录：<仅报告路径，不输出数据内容>
备份目录：<实际路径>
部署提交：e0b1f4aedbefe480a2727bdf22bed48e7bde41f7
运行方式：<start-dev / Windows 服务 / NSSM / WinSW / Caddy 等>
实际访问 Origin：<实际 Origin>
数据库迁移：<成功；列出 migration ID，不展示数据库内容>
API 健康检查：<通过/失败>
Web 回归：<通过/失败及失败项>
MCP OAuth：<通过/失败>
MCP 工具发现：<是否包含 board_create_embedded>
原子子画板浏览器验收：<通过/失败>
遗留问题：<无或逐项列出>
```

任何验收项失败时，不得声明部署完成。保留当前日志和备份，报告具体失败步骤、HTTP 状态或错误码，再决定修复或回滚。
