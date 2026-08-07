# ADR 0001: 画布内核与许可证

- 状态：`pending-user-license`
- 日期：2026-07-23
- 决策：采用 tldraw `5.2.5` 作为首期画布内核；许可证结论由用户完成申请、条款接受和必要付款后再更新。

## 背景

本项目需要可扩展的无限画布：自定义 Shape、Tool、Binding、上下文菜单、快照迁移和 PNG/SVG 导出均是核心需求。tldraw `5.2.5` 提供这些公开扩展点，并与本项目固定的 React `19.2.1` 兼容。

tldraw npm 包声明 `SEE LICENSE IN LICENSE.md`，并把完整许可证指向官方来源：<https://github.com/tldraw/tldraw/blob/main/LICENSE.md>。该官方文本和 tldraw 当前的 License Key 页面是许可解释的唯一权威；本 ADR 不替代法律意见，也不代表用户接受任何条款。

## 决策

1. 开发阶段使用 `http://127.0.0.1`/localhost；可以继续实施和测试本项目，但不将这视为正式日常使用的许可证结论。
2. 正式日常使用、分发或任何生产化前，用户必须取得适用于实际使用方式的许可证结论，并将状态更新为 `verified-user-license`。
3. 许可证 Key 仅通过本机、Git 忽略的 `.env.local` 的 `VITE_TLDRAW_LICENSE_KEY` 注入。`.env.example` 只保留变量名，不保存 Key。
4. tldraw 的版本固定为 `5.2.5`。升级前必须重新检查许可证入口、完成 snapshot 迁移和回归测试。

## 用户需要确认的路径

| 路径 | 适用判断 | 项目处理 |
|---|---|---|
| Hobby License | 若 tldraw 审核后确认个人非商业自用可适用 | 接受官方要求；保留所有 `made with tldraw` 品牌标识或水印，不绕过、遮挡或伪造。 |
| Trial License | 若用户需要在正式决定前进行有限期评估 | 记录到期日期；到期前取得后续许可或停止正式日常使用。 |
| Commercial License | 若实际使用、分发或条件不满足 Hobby/Trial | 用户接受条款并完成必要付款；把本机 Key 放入 `.env.local`。 |
| 书面确认 | 若纯本地个人使用的边界仍不明确 | 保存用户获得的书面结论，不提交其中的任何敏感信息。 |

法律条款接受、账号身份、审核、管理员审批和付款都必须由用户完成。开发工作只能提供 Key 的环境变量接入、运行时检查和验证协助。

## 到期与品牌处理

- Trial License 到期、Hobby/Commercial 条件变化或 Key 失效时，不得继续声称本项目可正式日常使用。
- 在取得新的可接受结论前，应用仅保留 localhost 开发/测试用途；发布、分发和正式日常使用暂停。
- 不移除、隐藏或规避 tldraw 要求的 `made with tldraw` 标识、水印或其他品牌呈现。

## 回退决策

出现以下任一条件时，停止以 tldraw 作为正式日常使用画布内核，并启动 MIT 许可的 Excalidraw 回退评估：

- 用户无法取得或不接受适用许可证；
- 许可成本或品牌要求不符合用户预期；
- 官方许可证文本变化后不再覆盖预期使用方式。

回退不是静默替换：先冻结 tldraw schema 版本，评估 `board-reference` Shape、snapshot、导入导出和迁移成本，完成数据转换测试后再切换。当前 Task 2 不执行该迁移。

## 验证与后续状态

当前允许状态为 `pending-user-license`，不阻塞 Task 3–24 的开发。用户获得许可证结论后，执行以下检查并更新本 ADR：

1. 复核官方许可证与 License Key 页面。
2. 在 `.env.local` 配置 `VITE_TLDRAW_LICENSE_KEY`（如适用），不发送到聊天或提交 Git。
3. 验证 localhost 与正式构建的许可证行为，以及要求的品牌呈现。
4. 将状态更新为 `verified-user-license`，记录结论日期和许可证类别；不记录 Key、订单号或个人信息。
