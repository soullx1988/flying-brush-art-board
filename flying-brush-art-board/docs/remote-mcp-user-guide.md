# Infinite Board MCP v2 同事使用指南

Infinite Board MCP 可让 Codex、Cursor 或 Windsurf 直接读取和修改无限画板。

- 版本：`2.0.0`
- 传输：Streamable HTTP
- 认证：飞书 OAuth 2.1
- 个人令牌：不需要
- 当前示例地址：`http://192.168.65.48:4173/mcp`

## 一键配置

1. 连接公司局域网，用浏览器打开 Infinite Board 并登录。
2. 进入顶部“集成”页。
3. 确认页面显示的 MCP URL 与网页的 IP 和端口一致。
4. 点击“下载 Windows 配置包”，并解压 `InfiniteBoard-MCP-Setup.zip`。
5. 双击 `Install-InfiniteBoard-MCP.bat`，等待配置完成。
6. 重启需要使用的 MCP 客户端，完成飞书授权。

ZIP 包含：

```text
Install-InfiniteBoard-MCP.bat
InfiniteBoard-MCP-Setup.ps1
InfiniteBoard-MCP-Workflow-SKILL.md
```

配置包不包含账号、Cookie 或 Token。脚本只更新 `infinite_board`，保留其他 MCP，修改前会自动生成 `.bak-*` 备份。

> 必须从自己实际访问的网页下载配置包。不要把 MCP URL 改成 `127.0.0.1`、内部端口 `8787` 或其他电脑的地址。

## Codex Desktop

运行 BAT 并重启 Codex 后，打开：

```text
设置 → 插件 → MCP → infinite_board
```

- 出现 `infinite_board` 且开关已开启：配置已被识别。
- 仍显示“进行身份验证”：尚未完成 OAuth。
- 点击“进行身份验证”，在浏览器中完成飞书登录并选择“允许并连接”。
- 浏览器显示 `Authentication complete. You may close this window.`：授权已经成功，可以关闭该页面。

首次授权成功后，应**完全退出并重新打开 Codex Desktop，再新建一个任务**进行连接验证。授权前已经打开的任务可能缓存“工具不可用”状态；仅切换回已有任务不会刷新 MCP 工具目录，也不代表授权失败。此时不需要重复授权或修改 MCP 配置。

如果不方便运行 BAT，也可以直接在 Codex 对话中发送：

```text
请帮我安装一个名为 infinite_board 的 Streamable HTTP MCP Server，
地址是 http://192.168.65.48:4173/mcp，认证方式使用服务器提供的 OAuth。
安装完成后检查配置，并引导我完成 Authenticate 授权。
```

### Codex Skill

BAT 会同时安装：

```text
%USERPROFILE%\.agents\skills\infinite-board-mcp-workflow\SKILL.md
```

在“设置 → 插件 → 技能”中看到 `Infinite Board MCP Workflow`，且开关已开启，即表示 Skill 安装成功。

Skill 为个人级，Codex 会自动发现，不需要在项目 `AGENTS.md` 中关联。需要时也可显式说：

```text
请使用 $infinite-board-mcp-workflow 操作 infinite_board MCP。
```

## Cursor 与 Windsurf

- Cursor：脚本合并 `%USERPROFILE%\.cursor\mcp.json`。
- Windsurf：脚本合并 `%USERPROFILE%\.codeium\windsurf\mcp_config.json`。

重启客户端，找到 `infinite_board`，点击连接或 `Authenticate` 完成 OAuth。

ZIP 中的 `InfiniteBoard-MCP-Workflow-SKILL.md` 也可交给其他客户端的 AI，让它改写为对应的 Rules/Instructions。当前未确认 Trae 支持远程 MCP OAuth。

## 验证连接

先执行只读验证：

```text
请使用 infinite_board MCP 调用 system_get_current_user 和
system_get_capabilities，再列出最近更新的项目；不要修改任何内容。
```

能返回当前飞书用户和服务器信息，即表示连接成功。

需要验证写入时，可再发送：

```text
使用 infinite_board MCP 新建一个名为“MCP v2 验收”的测试项目，
在根画板创建一个写着“连接成功”的便签。
```

## 管理授权

Infinite Board“集成”页可以管理已授权客户端：

- 关闭开关：暂停访问。
- 重新开启：恢复访问。
- 断开图标：彻底撤销授权，下次需重新登录。

更换电脑、服务器 IP 或网页端口后，应从新地址重新下载并运行配置包。

## 常见问题

| 现象 | 处理方式 |
| --- | --- |
| 下载的仍是 `.ps1` | 按 `Ctrl+F5` 刷新“集成”页，应下载 ZIP。 |
| BAT 运行失败 | 确认 BAT、PS1 和 Skill 文件已解压到同一目录。 |
| PowerShell 禁止脚本 | 在解压目录运行 `Set-ExecutionPolicy -Scope Process Bypass`，再执行 PS1。 |
| Codex 显示“进行身份验证” | 配置已识别但未授权；点击按钮完成飞书 OAuth。 |
| 浏览器提示授权完成，但 Codex 回答“尚未加载 `infinite_board` MCP 工具” | 授权已成功，但当前任务仍缓存授权前的工具状态。完全退出并重新打开 Codex Desktop，然后新建任务再执行只读验证；不要只切换到已有任务，也不需要重复授权。 |
| 授权页返回 `502` | 访问 `http://服务器IP:4173/health`，确认服务正常。 |
| 飞书提示回调地址不一致 | 联系管理员登记当前 IP 和端口的飞书回调地址。 |
| 客户端返回 `401` | 重新 Authenticate，并确认客户端未在“集成”页被暂停或断开。 |
| 客户端拒绝局域网 HTTP | 该客户端不支持当前部署方式，需更换支持远程 HTTP OAuth 的客户端。 |
| 提示配置 JSON 损坏 | 修复 JSON 或从 `.bak-*` 恢复，脚本不会覆盖损坏文件。 |

## 局域网 HTTP 提醒

当前部署使用 HTTP，请只在可信局域网中使用：

- 不要把 Web 或 API 端口暴露到互联网。
- 不要在公共 Wi-Fi 中完成授权。
- 不要转发 Cookie、OAuth 回调参数或客户端缓存。
- 怀疑电脑或授权泄露时，立即在“集成”页断开对应客户端。
