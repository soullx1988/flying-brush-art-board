# Infinite Board MCP v2 执行记录

> 产品版本：`2.0.0`
> MCP SDK：`@modelcontextprotocol/sdk@1.30.0`
> 传输：Streamable HTTP
> 认证：OAuth 2.1，Authorization Code + PKCE S256

## 已冻结的边界

- 唯一入口为 `/mcp`，不提供版本化路径、stdio、CLI 或独立 Automation API。
- MCP 直接调用项目现有 Application / Command Service；画布写入继续经过 `BoardDocumentCoordinator`。
- 只接受 OAuth Access Token。不存在个人令牌、旧认证 Header、旧工具别名或转换层。
- 授权固定包含全部 MCP scope，不提供 scope 选择。
- 浏览器已打开同一画板时，MCP 写入继续通过现有实时协作链路同步。

## v2 交付清单

- [x] MCP Server 版本改为 `2.0.0`，能力声明为 Streamable HTTP + OAuth 2.1。
- [x] 删除个人令牌仓库、`/api/mcp/tokens`、创建/复制/启停令牌界面。
- [x] 同一数据库迁移删除 `mcp_access_tokens`，保留 `mcp_operations`、确认记录和历史审计。
- [x] 新增 OAuth 客户端、待授权请求、授权、授权码、Access Token、Refresh Token 表。
- [x] 授权码 5 分钟且一次性；Access Token 1 小时；Refresh Token 30 天并轮换。
- [x] 授权码和令牌只保存 SHA-256 哈希；动态注册客户端按无密钥公共客户端处理。
- [x] 提供 OAuth 资源发现、授权服务器发现、动态注册、授权、换令牌和撤销端点。
- [x] 复用飞书 Session、用户白名单和审计；用户离开白名单后授权立即不可用。
- [x] 设置页可暂停、恢复和断开客户端；断开会撤销整个令牌族。
- [x] 集成页改为 Windows 一键配置包入口；ZIP 内包含 PowerShell 脚本，避免浏览器直接拦截 `.ps1`，并展示已授权客户端。
- [x] 脚本从当前网页同源下载，MCP URL 固定为当前公开 Origin 加 `/mcp`。
- [x] 脚本幂等配置 Codex、Cursor、Windsurf；修改前备份，保留其他 MCP，拒绝覆盖损坏 JSON。
- [x] Trae 显示“当前客户端未确认支持 MCP OAuth”，不提供令牌回退。
- [x] Caddy 代理 `/mcp`、`/oauth/*`、`/.well-known/*`；Vite 开发代理保持同源。
- [x] 增加 OAuth 仓库、数据库迁移、协议、网页面板和脚本相关自动化测试。
- [ ] 在部署机先备份正式 SQLite 数据库，再执行 v2 迁移演练。
- [ ] 在真实局域网 HTTP 地址完成 Codex、Cursor、Windsurf 人工冒烟。

## 部署配置

```dotenv
MCP_ENABLED=true
MCP_PUBLIC_URL=http://192.168.65.48:4173
MCP_ALLOWED_HOSTS=192.168.65.48
MCP_ALLOWED_ORIGINS=http://192.168.65.48:4173
```

要求：

- `MCP_PUBLIC_URL` 只能是 Origin，不能带 `/projects`、查询参数或片段。
- 公开 Host 必须命中 `MCP_ALLOWED_HOSTS`，公开 Origin 必须命中 `MCP_ALLOWED_ORIGINS`。
- Fastify 继续只监听回环地址，由 Vite 或 Caddy 暴露局域网 HTTP 入口。

## 数据迁移与回滚

迁移 `0010_mcp_v2_oauth` 会直接删除 `mcp_access_tokens`。部署前必须停止写入并完整备份 SQLite 数据库及相关 WAL/SHM 状态。

本版本没有 v1/v2 灰度开关。回滚只能同时恢复：

1. v2 部署前的应用版本。
2. v2 迁移前的数据库备份。

只回滚应用或只回滚数据库都不受支持。

## 验收命令

```powershell
pnpm test
pnpm typecheck
pnpm build
```

真实环境验收步骤：

1. 同事从网页“集成”页下载 Windows 配置脚本。
2. 在 PowerShell 中运行脚本并重启目标客户端。
3. 客户端弹出授权时，使用已加入白名单的飞书账号登录并允许连接。
4. 调用 `system_get_current_user`、`system_get_capabilities`、`project_list`。
5. 创建测试项目和测试图形，确认浏览器实时出现结果，再执行一次导出。
6. 在网页暂停客户端，确认访问和刷新均失败；恢复后确认可重新访问。
7. 断开客户端，确认已有 Access Token 和 Refresh Token 均不可再用。

## 发布门禁

- 系统中只能存在一个 `/mcp` 入口、一套工具和 OAuth 一种认证方式。
- 旧个人令牌、旧令牌 API、旧界面和 `personal bearer token` 能力声明必须不可用。
- 伪造 Host、未允许的 Origin、未知 scope、开放重定向、授权码重放和 Refresh Token 重放必须被拒绝。
- 所有自动化测试、类型检查、Web/API 构建和数据库迁移演练必须通过。
