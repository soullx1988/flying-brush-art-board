# 从 192.168.65.48 同步正式数据到 192.168.64.128

本文交给 `192.168.65.48` 上的 Codex 执行。代码修改应已经提交并推送到远程仓库；本文从核对部署提交开始，将 `192.168.65.48` 的数据库、资源和飞书 App 配置完整同步到 `192.168.64.128`。

## 目标和边界

- 执行机和数据源：`192.168.65.48`。
- 目标机：`192.168.64.128`。
- 目标 Web Origin：`http://192.168.64.128:4173`。
- 数据策略：源机完整覆盖目标机，不合并两份 SQLite 数据。
- 目标机已有相同项目环境，不重新安装整套项目。
- 目标机原数据必须先备份；任一关键验收失败时使用该备份回滚。
- 不把数据库、`.env.local`、飞书密钥、OAuth Token 或同步包提交到 Git。

源机数据库、`assets` 和飞书 App 配置是本次同步的唯一来源。目标机现有业务数据在同步后只保留于部署前备份中。

## 必须停止并报告的情况

遇到以下任一情况，不得继续同步，也不得猜测：

- 源机工作树存在尚未处理的代码修改，或当前提交没有推送到远程仓库。
- 无法确定源机或目标机的项目目录、真实 `INFINITE_BOARD_DATA_DIR`。
- 无法确定目标机使用 `start-dev.bat`、Windows 服务、计划任务、NSSM、WinSW 还是 Caddy 启动。
- 没有已经授权的远程执行方式或安全文件传输通道。
- 目标机存在未提交的服务器本地代码修改。
- 目标机不能 fast-forward 到指定部署提交。
- 任一备份失败，或备份目录缺少 `database.sqlite`、`assets`、`manifest.json`、`projects`。
- 停止目标服务后，`4173` 或 `8787` 仍被未知进程监听。
- 浏览器实际访问 Origin 不是 `http://192.168.64.128:4173`。
- 无法在飞书开放平台登记目标机回调地址。

不得在终端输出、聊天、日志或交接报告中展示 `FEISHU_APP_SECRET`、`SESSION_SECRET`、OAuth Token、授权码或数据库内容。

## 第一阶段：核对源机部署提交

在 `192.168.65.48` 的项目根目录执行：

```powershell
git status --short --branch
git log -1 --oneline --decorate
git fetch origin
git rev-parse HEAD
git rev-parse origin/master
node --version
pnpm --version
```

要求：

- 工作树没有待提交或暂存的跟踪文件修改。
- `HEAD` 是本次要部署的提交，并且远程仓库中已存在该提交。
- Node.js 为 `>=22.13 <23`，pnpm 为 `11.9.0`。

记录部署提交，后续目标机必须部署同一个值：

```powershell
$deployCommit = (git rev-parse HEAD).Trim()
Write-Output "Deploy commit: $deployCommit"
```

安装锁定依赖并构建：

```powershell
pnpm install --frozen-lockfile
pnpm build
```

只有构建成功并生成 `apps\web\dist`、`apps\local-api\dist` 和内部包构建产物后，才能准备数据同步包。

## 第二阶段：确认源机数据和飞书配置

从源机 `.env.local` 或实际服务配置读取数据目录。以下检查只输出路径和配置是否存在，不输出密钥：

```powershell
$sourceEnvPath = Join-Path (Get-Location) '.env.local'
if (-not (Test-Path -LiteralPath $sourceEnvPath)) {
  throw '.env.local was not found in the source project root.'
}

$sourceEnvLines = Get-Content -LiteralPath $sourceEnvPath
$dataLine = $sourceEnvLines | Where-Object { $_ -match '^INFINITE_BOARD_DATA_DIR=.+' } | Select-Object -Last 1
if (-not $dataLine) { throw 'INFINITE_BOARD_DATA_DIR is missing.' }
$sourceDataDirectory = ($dataLine -split '=', 2)[1].Trim()

$requiredSecretNames = @('FEISHU_APP_ID', 'FEISHU_APP_SECRET', 'SESSION_SECRET')
foreach ($name in $requiredSecretNames) {
  $present = [bool]($sourceEnvLines | Where-Object { $_ -match ('^' + [regex]::Escape($name) + '=.+$') })
  [pscustomobject]@{ Name = $name; Present = $present }
}

Write-Output "Source data directory: $sourceDataDirectory"
Get-Item -LiteralPath (Join-Path $sourceDataDirectory 'infinite-board.sqlite') | Select-Object FullName, Length, LastWriteTime
```

若任一必要配置不存在，停止并报告。不要用 `.env.example` 的示例值代替正式配置。

## 第三阶段：生成源机同步包

备份服务使用 SQLite backup API，可以在源 API 运行时生成一致性快照。同步前仍应通知用户暂停编辑，避免备份完成后源机又产生目标机没有的新修改。

同步包必须放在仓库外。先指定一个有足够空间的新目录：

```powershell
$syncRoot = 'D:\InfiniteBoardTransfers\to-192.168.64.128'
New-Item -ItemType Directory -Path $syncRoot -Force | Out-Null

$env:INFINITE_BOARD_BACKUP_DATA_DIRECTORY = $sourceDataDirectory
$env:INFINITE_BOARD_BACKUP_ROOT_DIRECTORY = $syncRoot
try {
  pnpm exec tsx scripts/backup-cli.ts backup
  if ($LASTEXITCODE -ne 0) { throw 'Source backup failed.' }
} finally {
  Remove-Item Env:INFINITE_BOARD_BACKUP_DATA_DIRECTORY -ErrorAction SilentlyContinue
  Remove-Item Env:INFINITE_BOARD_BACKUP_ROOT_DIRECTORY -ErrorAction SilentlyContinue
}
```

如果 `D:\InfiniteBoardTransfers` 不适用于实际机器，选择另一个仓库外目录并在报告中记录。不要把同步包放在项目目录、Git 工作树或源数据目录的 `backups` 保留策略范围内。

选择刚生成的备份并检查结构：

```powershell
$sourceBackup = Get-ChildItem -LiteralPath $syncRoot -Directory -Filter 'backup-*' |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
if (-not $sourceBackup) { throw 'No source backup directory was created.' }

$requiredBackupEntries = @('database.sqlite', 'assets', 'manifest.json', 'projects')
foreach ($entry in $requiredBackupEntries) {
  $entryPath = Join-Path $sourceBackup.FullName $entry
  if (-not (Test-Path -LiteralPath $entryPath)) { throw "Backup entry missing: $entry" }
}

$manifest = Get-Content -Raw -LiteralPath (Join-Path $sourceBackup.FullName 'manifest.json') | ConvertFrom-Json
$databaseFile = Get-Item -LiteralPath (Join-Path $sourceBackup.FullName 'database.sqlite')
$assetFiles = Get-ChildItem -LiteralPath (Join-Path $sourceBackup.FullName 'assets') -File -Recurse
$projectFiles = Get-ChildItem -LiteralPath (Join-Path $sourceBackup.FullName 'projects') -File -Filter '*.iboard'

[pscustomobject]@{
  BackupDirectory = $sourceBackup.FullName
  CreatedAt = $manifest.createdAt
  DatabaseBytes = $databaseFile.Length
  AssetFiles = $assetFiles.Count
  AssetBytes = ($assetFiles | Measure-Object -Property Length -Sum).Sum
  ProjectArchives = $projectFiles.Count
}
```

记录上述数量和大小，用于目标机接收后核对。不要输出 manifest 中的项目内容或读取数据库表内容。

## 第四阶段：准备飞书 App 配置

目标机复用源机的飞书 App，但不要复制源数据目录中的以下文件：

```text
feishu-import-credentials.json
feishu-import-credentials.key
```

这两个文件包含用户导入授权，并由 Windows DPAPI 的当前用户保护；复制到另一台机器或另一个服务账号后不能可靠解密。目标机需要重新完成飞书导入授权。

通过已有的受控密钥通道把以下配置交给目标机管理员或目标机 Codex，不得粘贴到聊天或普通日志：

```text
FEISHU_APP_ID
FEISHU_APP_SECRET
FEISHU_AUTH_ENABLED
FEISHU_WHITELIST_ENABLED
```

不要覆盖目标机原有 `SESSION_SECRET`。数据库中的登录用户可以迁移，但目标机现有会话应由目标机自己的会话密钥继续管理。

在飞书开放平台为同一 App 登记登录回调：

```text
http://192.168.64.128:4173/auth/feishu/callback
```

登录所需权限至少包括：

```text
auth:user.id:read
```

飞书白板/文档导入还需要：

```text
board:whiteboard:node:read
docx:document:readonly
wiki:node:retrieve
docs:document.media:download
offline_access
```

当前代码中的飞书导入授权回调固定为：

```text
http://127.0.0.1:8787/auth/feishu/import/callback
```

它与 Web 登录回调不同。只有在目标 Windows 主机本地浏览器中授权时，这个回环地址才指向目标 API；如果要求局域网其他电脑直接完成飞书导入授权，应先修改应用实现并重新部署，不能把登录回调误当成导入回调。

## 第五阶段：把同步材料交给目标机

使用已经获批的 SMB、SFTP、远程 PowerShell会话或其他安全通道传输整个 `$sourceBackup.FullName` 目录。不要自行开启匿名共享、临时关闭防火墙或把密钥放入同步包。

目标机接收目录示例：

```text
D:\InfiniteBoardTransfers\incoming\backup-<timestamp>
```

传输完成后，在目标机重新统计 `database.sqlite` 大小、资源文件数量/总大小和 `.iboard` 数量，必须与源机记录一致。若源机 Codex没有目标机远程权限，则在这里停止自动执行，将以下内容交给目标机 Codex继续：

- 本文完整路径。
- 部署 commit。
- 同步包接收路径。
- 源机备份的数据库大小、资源数量/大小、项目归档数量。
- 飞书配置已经通过哪一种受控密钥通道提供。

不得在没有执行证据时声称目标机已完成同步。

## 第六阶段：目标机只读盘点和部署前备份

以下命令必须在 `192.168.64.128` 的项目根目录执行：

```powershell
git status --short --branch
git remote -v
git log -1 --oneline --decorate
node --version
pnpm --version
Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in 4173, 8787, 80, 443 }
```

确认目标机真实数据目录和必要配置是否存在，只输出路径和布尔值：

```powershell
$targetEnvPath = Join-Path (Get-Location) '.env.local'
if (-not (Test-Path -LiteralPath $targetEnvPath)) { throw 'Target .env.local is missing.' }
$targetEnvLines = Get-Content -LiteralPath $targetEnvPath
$targetDataLine = $targetEnvLines | Where-Object { $_ -match '^INFINITE_BOARD_DATA_DIR=.+' } | Select-Object -Last 1
if (-not $targetDataLine) { throw 'Target INFINITE_BOARD_DATA_DIR is missing.' }
$targetDataDirectory = ($targetDataLine -split '=', 2)[1].Trim()
Write-Output "Target data directory: $targetDataDirectory"
```

确认目标机当前服务管理方式，但暂不停止。随后为目标机现有数据创建部署前备份：

```powershell
$targetBackupRoot = Join-Path $targetDataDirectory 'pre-sync-backups'
$env:INFINITE_BOARD_BACKUP_DATA_DIRECTORY = $targetDataDirectory
$env:INFINITE_BOARD_BACKUP_ROOT_DIRECTORY = $targetBackupRoot
try {
  pnpm exec tsx scripts/backup-cli.ts backup
  if ($LASTEXITCODE -ne 0) { throw 'Target pre-sync backup failed.' }
} finally {
  Remove-Item Env:INFINITE_BOARD_BACKUP_DATA_DIRECTORY -ErrorAction SilentlyContinue
  Remove-Item Env:INFINITE_BOARD_BACKUP_ROOT_DIRECTORY -ErrorAction SilentlyContinue
}
```

验证新备份包含 `database.sqlite`、`assets`、`manifest.json` 和 `projects`，并记录其绝对路径。备份成功前不得停止或覆盖目标机服务。

另行复制目标机 `.env.local` 到仓库外、仅管理员可访问的部署备份目录。不得在报告中展示文件内容。

## 第七阶段：停止目标服务并更新代码

通知用户进入维护窗口。使用目标机已经确认的服务管理方式停止 API、Web 和 Caddy/反向代理（如适用），不要终止无关进程。

确认端口已释放：

```powershell
Get-NetTCPConnection -State Listen -LocalPort 4173,8787 -ErrorAction SilentlyContinue
```

命令不应返回监听记录。若仍有监听，先识别进程和原有服务管理器；不得直接结束未知进程。

工作树干净后更新到源机记录的部署提交：

```powershell
git fetch origin
git checkout master
git pull --ff-only origin master
git rev-parse HEAD
pnpm install --frozen-lockfile
pnpm build
```

`git rev-parse HEAD` 必须与源机记录的 `$deployCommit` 完全一致。构建失败时不要恢复源数据，先修复代码部署问题或恢复原服务。

## 第八阶段：恢复源机数据库和资源

设置目标机收到的同步包路径：

```powershell
$incomingBackup = 'D:\InfiniteBoardTransfers\incoming\backup-<timestamp>'
```

将占位路径替换为第五阶段实际核对过的绝对路径。确认 API 仍未监听 `8787`，然后调用项目恢复服务：

```powershell
$apiListener = Get-NetTCPConnection -State Listen -LocalPort 8787 -ErrorAction SilentlyContinue | Select-Object -First 1
if ($apiListener) { throw "Stop the target API first. PID: $($apiListener.OwningProcess)" }

$env:INFINITE_BOARD_RESTORE_DATA_DIRECTORY = $targetDataDirectory
$env:INFINITE_BOARD_RESTORE_BACKUP_DIRECTORY = $incomingBackup
try {
  pnpm exec tsx scripts/backup-cli.ts restore
  if ($LASTEXITCODE -ne 0) { throw 'Target restore failed.' }
} finally {
  Remove-Item Env:INFINITE_BOARD_RESTORE_DATA_DIRECTORY -ErrorAction SilentlyContinue
  Remove-Item Env:INFINITE_BOARD_RESTORE_BACKUP_DIRECTORY -ErrorAction SilentlyContinue
}
```

恢复服务会：

- 在目标数据目录的 `backups\restore-points` 中创建自动恢复点。
- 一起替换 SQLite 和 `assets`。
- 清理不应沿用的 SQLite WAL/SHM sidecar。
- 校验 SQLite integrity、外键、项目引用图、引用形状和协作数据表。
- 校验失败时自动尝试恢复替换前的数据。

不要手工复制正在使用的 `infinite-board.sqlite`，也不要只复制数据库而遗漏资源目录。

## 第九阶段：更新目标机环境配置

编辑目标机现有 `.env.local`，保留：

- 目标机真实 `INFINITE_BOARD_DATA_DIR`。
- 目标机原有 `SESSION_SECRET`。
- 与本次同步无关且已经验证的服务配置。

通过受控密钥通道写入源机的飞书 App ID/Secret，并确认：

```env
FEISHU_AUTH_ENABLED=true
MCP_PUBLIC_URL=http://192.168.64.128:4173
MCP_ALLOWED_HOSTS=192.168.64.128
MCP_ALLOWED_ORIGINS=http://192.168.64.128:4173
```

`FEISHU_WHITELIST_ENABLED` 沿用源机正式配置。`MCP_ENABLED` 沿用目标机原开关；若为 `true`，上面三项必须使用目标机真实 Origin，禁止使用 `*`。

不要把源机的 `INFINITE_BOARD_DATA_DIR`、`MCP_PUBLIC_URL`、`MCP_ALLOWED_HOSTS` 或 `MCP_ALLOWED_ORIGINS` 原样复制到目标机。

## 第十阶段：启动和验收

继续使用目标机原有服务管理方式启动 API、Web 和 Caddy/代理。API 工作目录必须是项目根目录，且运行账号必须对 `$targetDataDirectory` 有读写权限。

### 健康检查

```powershell
Invoke-RestMethod http://127.0.0.1:8787/health
Invoke-RestMethod http://192.168.64.128:4173/health
```

两次响应的 `status`、`database`、`userDirectory` 和 `realtime` 都应为 `ok`。

### Web 和数据回归

在真实桌面浏览器中验证：

1. 可以打开 `http://192.168.64.128:4173`。
2. 源机原有项目、画板、图片、评论和登录用户数据存在。
3. 新建项目、编辑、保存、刷新正常。
4. 两个浏览器窗口编辑同一画板时实时同步正常。
5. 图片和其他资源可以加载，不出现缺失文件。
6. 导入、导出和子画板引用正常。

### 飞书验收

1. 从目标 Origin 发起飞书登录。
2. 确认回调返回 `http://192.168.64.128:4173/auth/feishu/callback`。
3. 登录后 `/api/me` 返回当前用户。
4. 在目标 Windows 主机本地浏览器重新完成飞书导入授权。
5. 使用授权账号检查一个有权限的飞书白板或文档，完成预览和一次受控导入。

不得以复制过来的 DPAPI 凭据文件代替重新授权。

### MCP 验收（仅当启用）

```powershell
Invoke-RestMethod http://192.168.64.128:4173/.well-known/oauth-protected-resource/mcp
Invoke-RestMethod http://192.168.64.128:4173/.well-known/oauth-authorization-server
```

确认资源地址指向 `http://192.168.64.128:4173/mcp`，然后从测试客户端完成 OAuth，并验证工具发现和一次受控读写操作。

## 回滚

任一关键验收失败时：

1. 停止目标 API、Web 和代理服务。
2. 确认 `8787` 不再监听。
3. 使用第六阶段记录的目标机部署前备份，通过 `scripts/backup-cli.ts restore` 恢复数据库和资源。
4. 恢复部署前保存的目标机 `.env.local`。
5. 如数据库 migration 与旧代码不兼容，同时恢复部署前代码提交。
6. 使用原服务管理方式重启。
7. 重新执行本机和统一入口健康检查。

不得只回滚代码而保留不兼容的新数据库，也不得只恢复 SQLite 而遗漏 `assets`。

## 完成交接报告

全部验收通过后，源机 Codex应报告：

```text
源机项目目录：<实际路径>
源机数据目录：<仅路径>
源机同步包：<实际路径>
目标机项目目录：<实际路径>
目标机数据目录：<仅路径>
目标机部署前备份：<实际路径>
目标机自动恢复点：<实际路径>
部署提交：<完整 commit>
代码提交一致性：<通过/失败>
同步包核对：<数据库大小、资源数量/大小、项目归档数量是否一致>
目标机运行方式：<start-dev / Windows 服务 / NSSM / WinSW / Caddy 等>
实际访问 Origin：http://192.168.64.128:4173
数据库恢复校验：<database/referenceGraph/referenceShapes/collaboration>
本机 API 健康检查：<通过/失败>
统一入口健康检查：<通过/失败>
Web 与实时协作回归：<通过/失败及失败项>
飞书登录：<通过/失败>
飞书导入重新授权：<通过/失败>
MCP 验收：<未启用/通过/失败>
回滚状态：<未触发/已回滚及结果>
遗留问题：<无或逐项列出>
```

任何验收项失败时，不得写“同步完成”。保留同步包、目标机部署前备份、恢复点和相关非敏感日志，报告具体失败步骤、HTTP 状态或错误码。
