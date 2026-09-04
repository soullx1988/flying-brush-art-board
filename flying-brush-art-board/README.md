# Infinite Board

一个本地优先的无限画板应用。它支持项目内的多画板、画板引用、浏览器式标签页、跨画板复制粘贴，以及常用画板格式的导入导出。

## 安装与启动

要求：Node.js `>=22.13 <23`、pnpm `11.9.0`。

```bash
pnpm install
pnpm dev
```

## 第一阶段验收认证开关

根目录 `.env.local` 中的以下开关仅用于开发验收：

```env
FEISHU_AUTH_ENABLED=false
FEISHU_WHITELIST_ENABLED=false
```

两者均为 `false` 时，后端以固定的本地验收用户运行，画板和导入导出不会被飞书登录阻塞。可通过 `GET http://127.0.0.1:8787/auth/status` 确认当前模式。

开启 `FEISHU_AUTH_ENABLED=true` 后，所有 `/api/*` 路由在飞书 OAuth 接入前会默认返回 `401 FEISHU_LOGIN_REQUIRED`。飞书用户首次登录后，必要身份信息会保存在项目 SQLite 的 `app_users` 表中，不需要 PostgreSQL；生产环境禁止关闭飞书登录。

也可以在 Windows PowerShell 中使用本地启动器；它会检查版本、端口、数据目录和数据库迁移：

```powershell
.\scripts\start-local.ps1
```

应用数据默认保存在仓库根目录的 `.infinite-board-data`，`start-dev.bat` 与 `scripts\start-local.ps1` 使用同一份数据和 `4173/8787` 端口。启动器只监听本机回环地址；若端口已被占用会明确失败，不会静默连接到可能使用另一数据目录的旧进程。可用 `-DataDirectory` 显式切换数据目录；旧版 `-LocalAppDataBase` 参数仍兼容。

### 本机日常使用

首次安装日常入口时运行：

```powershell
.\scripts\install-local-usage.ps1
```

安装后可以直接双击桌面的“打开短线交易画板”。系统也会在当前用户登录时启动，并在每天 `08:45` 再检查一次；如果服务已经正常运行，启动器会直接复用，不会重复启动。画板入口是 `http://127.0.0.1:4173`。

“今天怎么看”会读取适用于当天的不可变冻结预案。隔夜阶段可以提前查看候选、模式和观察口径，但保持只读；到竞价阶段仍须依据当时快照重新确认，画板本身不会放大交易权限。

## 短线交易工作台

项目库为空时，应用会幂等创建一个“短线主线交易工作台”，默认入口是“总览”，并内嵌四个可自由移动、缩放和继续编辑的大画板：

- `数据`：市场环境、义水北路只读推演、个人选股池、公告观察源和数据源状态；
- `逻辑`：盘前假设、触发条件、证伪条件、动作与复盘；
- `经验`：按场景沉淀有效信号、失败信号和可复用规则；
- `心态`：记录情绪、触发事件、计划偏差和校正规则。

交易数据桥默认读取同级 `07_中短线选股器` 的盘后报告和 `announcement_watch_feed.json`，通过只读 HTTP 快照与 SSE 变更通知刷新画布组件。实时事实数据不会写进 tldraw 快照，因此不会覆盖个人布局、备注或画布历史。可在 `.env.local` 中显式配置：

```env
TRADING_BRIDGE_ENABLED=true
TRADING_PICKER_DATA_DIR=..\..\07_中短线选股器
TRADING_POLL_INTERVAL_MS=2000
TRADING_MAX_JSON_BYTES=16777216
TRADING_STALE_AFTER_MS=86400000
TRADING_MAX_FUTURE_SKEW_MS=300000
```

`TRADING_STALE_AFTER_MS` 是当前盘后报告的时长型停更阈值，默认 24 小时；它尚不等同于 A 股节假日/交易阶段日历。源报告缺失、语义字段不完整、时间非法或超出允许的未来时钟偏差时不会进入 `CURRENT`。响应中的 `ageMs` 是 `ageEvaluatedAt` 时刻的健康快照值；`freshUntil` 是客户端必须执行的本地失效截止点。即使 SSE 与 HTTP 同时断开，界面也会在截止点退出 `CURRENT`。服务端跨过停更阈值时会发布新的状态与 revision。

`revision` 是不可排序的 ETag 校验值。HTTP 与 SSE 同时返回 `streamId + sequence`，其中 `sequence` 只在同一 `streamId` 内严格递增；服务重启后 `streamId` 会变化，客户端应重置顺序基线。`lastErrorAt` 保留最近一次错误状态转换时间，恢复后不会清空；是否仍处于错误中以 `errorActive` 为准。

当前公告面板是“公告观察源”，不是“正式公告池”。`announcement_watch_feed.json` 是可编辑手工文件，不是可信验证边界；其中所有条目一律归类为 `human_claim + UNVERIFIED`。`sourceTier=official`、手填 `verificationStatus=VERIFIED`、任意 URL 或 64 位 hash 都不能自证官方原文。只有后续独立 verifier 从受信官方来源取得原文并重算 hash（或验证受信签名）后，才允许产生 `verified_official_document`。现有 `summary` 一律标为 `summaryEpistemicClass=human_claim`，界面固定显示“观察摘要 / 人工解读”。未核验内容不得据此升级主线、生成正式证据或触发正式 veto。画布是读取、展示和个人沉淀层，不拥有交易执行资格，也不会反向修改选股系统的生产事实。

## 常用命令

```bash
pnpm test
pnpm test:feishu
pnpm test:security
pnpm test:realtime:load
pnpm bench:performance
pnpm typecheck
pnpm build
pnpm e2e
```

默认测试不读取 `.env.local`，也不连接飞书。取得真实飞书授权后，才配置本地凭据并显式运行：

```bash
pnpm smoke:feishu:real
pnpm e2e:feishu:real
```

未设置 `FEISHU_REAL_SMOKE=1` 或本地凭据时，真实飞书命令显示 `SKIPPED: awaiting user authorization` 并正常退出。

## 局域网协作

白名单用户通过飞书登录后，可在同一 Board 中实时共同编辑；同一用户的多个标签页也可同时编辑。评论、锚点和操作审计只保存在本地 SQLite，不会写入飞书。部署时让 Caddy 提供 HTTPS/WebSocket 入口，Fastify 仍仅监听回环地址；详情见[局域网协作服务器部署](docs/deployment/lan-collaboration-server.md)。

## 使用与文件交换

- [用户指南](docs/user-guide.md)：多画板、引用、标签页、复制粘贴和拖放。
- [安全与隐私](docs/security-and-privacy.md)：本地数据、OAuth 凭据、导入风险与许可边界。
- [备份与恢复](docs/backup-and-restore.md)：备份、还原和恢复点。

支持导入 `.iboard`、`.tldr`、`.drawio`、图片、SVG 和 PDF；支持导出完整项目 `.iboard` 及 PNG、SVG、PDF。`.iboard` 是唯一承诺项目级无损往返的格式。

## 故障排查

1. 运行 `pnpm typecheck`、`pnpm test` 和 `pnpm build`，先区分类型、单元测试和构建问题。
2. 无法启动时用 `scripts/start-local.ps1` 重新检查 Node、pnpm、端口和迁移。
3. 数据恢复、备份损坏或迁移问题，参见[备份与恢复](docs/backup-and-restore.md)。
4. 导入被拒绝、凭据保护或许可问题，参见[安全与隐私](docs/security-and-privacy.md)。
