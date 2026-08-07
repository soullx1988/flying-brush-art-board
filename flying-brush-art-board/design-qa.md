# 表格飞书对齐 Design QA

- source visual truth paths:
  - `C:\Users\pc\AppData\Local\Temp\codex-clipboard-9b3015df-4a3d-4298-8e41-cd3cfde20cae.png`
  - `C:\Users\pc\AppData\Local\Temp\codex-clipboard-f10ad987-8be6-421f-b03b-3d3ca791e0e7.png`
  - `C:\Users\pc\AppData\Local\Temp\codex-clipboard-d74c410f-ff3e-4a6f-a001-9ee43d7d3dd5.png`
  - `C:\Users\pc\AppData\Local\Temp\codex-clipboard-87106282-dd36-46c6-9f36-93c9999b4129.png`
  - `C:\Users\pc\AppData\Local\Temp\codex-clipboard-de80c123-0c1d-4578-9a0d-ddae273b5703.png`
- implementation screenshot paths:
  - `G:\work\策划\无限画布\.codex-temp\table-feishu-alignment-qa\implementation-column-delete-1024.png`
  - `G:\work\策划\无限画布\.codex-temp\table-feishu-alignment-qa\implementation-cell-edit-1024.png`
  - `G:\work\策划\无限画布\.codex-temp\table-feishu-alignment-qa\implementation-row-insert-and-menu.png`
  - `G:\work\策划\无限画布\.codex-temp\table-feishu-alignment-qa\implementation-column-insert.png`
  - `G:\work\策划\无限画布\.codex-temp\table-feishu-alignment-qa\implementation-table-drag-handle.png`
- viewport: 原有格式工具栏证据为 `1024 × 768`；本轮真实 Chrome 交互证据为 `1912 × 900`。
- state: 第二行整行选中并悬停内部行分隔线；单元格选中并悬停内部列分隔线；悬停左上六点整表拖动柄。
- full-view comparison evidence:
  - `G:\work\策划\无限画布\.codex-temp\table-feishu-alignment-qa\comparison-column-delete.png`
  - `G:\work\策划\无限画布\.codex-temp\table-feishu-alignment-qa\comparison-cell-edit.png`
  - `G:\work\策划\无限画布\.codex-temp\table-feishu-alignment-qa\comparison-row-insert-menu-v2.png`
  - `G:\work\策划\无限画布\.codex-temp\table-feishu-alignment-qa\comparison-column-insert-v2.png`
  - `G:\work\策划\无限画布\.codex-temp\table-feishu-alignment-qa\comparison-table-drag-handle-v2.png`
- focused region comparison evidence: 五组对比图均同时包含飞书参考与实现裁切，行列插入点、整行工具栏、六点柄和选中轮廓在原始像素下可辨认。

## Findings

- 没有 P0/P1/P2 问题。整行/整列选中、蓝色轴头、删除入口、分隔线插入点、六点整表拖动柄和单元格格式工具栏均与参考图保持同一信息层级。
- 字体与排版：正文使用项目既有 Inter/PingFang/Microsoft YaHei 字体栈；编辑默认字号为 14，工具栏文字与参考图密度相近。
- 间距与布局节奏：工具栏居中悬浮于当前列或单元格上方，8px 圆角、轻边框和阴影与参考图接近；1024px 视口未发生裁切或越界。
- 颜色与视觉令牌：选中蓝、删除红、灰色边框和白色浮层与参考图语义一致；颜色值沿用项目/tldraw 令牌。
- 图片与资产：界面无位图资产；所有图标复用 tldraw 原生图标，不存在占位图或手绘 SVG。
- 文案：`输入文本`、删除行/列、插入行/列、字号和对齐语义完整，中文可访问名称与可见功能一致。
- 真实浏览器行为：内部行边界插入使行数 `3 → 4`，内部列边界插入使列数 `2 → 3`；删除整行使行数 `4 → 3`；六点柄拖动 `50 × 30px` 后单次撤销准确恢复原位。

## Patches made

- 新增整列统一蓝色轮廓、蓝色列头与固定屏幕尺寸的上下文工具栏。
- 新增直接删除列、左右插列、均分列宽、背景选择。
- 新增单元格编辑占位、文字颜色、字号、对齐和更多格式操作，并持久化到表格 props 与 SVG 导出。
- 将所有下拉交互改为 tldraw 原生 Select，避免自定义菜单浮层。
- 修正编辑器文字对齐继承，并验证字号/对齐操作在编辑中不会丢失。
- 新增与整列对称的整行轮廓、行头、填充、删除、插入和均分行高操作。
- 将固定末尾加号改为每条行/列分隔线的索引插入点，点击后自动选中新轴。
- 新增左上六点整表拖动柄，使用 shape 父坐标移动并保持单次撤销边界。
- 轴工具栏上移预留插入点通道，避免选中列后工具栏遮挡顶部插入按钮。

## Follow-up polish

- P3：tldraw 原生填充图标与飞书的圆形斜杠图标略有差异；这是遵循项目组件复用约束的有意差异。
- P3：tldraw 外层选框与连接锚点比飞书参考图更明显；属于现有画板统一交互，不建议在表格上单独隐藏。
- P3：真实浏览器截图中的指针会覆盖部分悬停加号，但 DOM 命中、可见度和点击插入均已分别验证。

final result: passed
