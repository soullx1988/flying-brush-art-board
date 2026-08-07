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

应用数据默认保存在 `%LOCALAPPDATA%\InfiniteBoard`。启动器只监听本机回环地址。

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
