# 更新付费点画板的配图与订单备份

`build-evidence.py` 从商品来源快照、客户端原始图集和订单导出生成资料包；不改游戏工程、不访问生产数据库。需要 Python 3，无额外依赖。

```powershell
python scripts/commerce/build-evidence.py --dataset <商品快照.json> --orders <订单导出.json> --client <客户端根目录> --database <本地历史备份.sqlite> --output <资料包.json>
python scripts/commerce/test_build_evidence.py
```

在现有付费点画板点击“更新配图与历史”，选择生成的资料包。更新图片和历史数据，保留商品、设计内容与画板层级。图片进入画板已有资产存储；历史汇总保存在画板元数据中，随画板保存。不要把实际商品数据、订单或生成的资料包提交到代码仓库。

订单输入采用已有导出格式：`complete`、`readAt`、`columns`、`players`。每个玩家包含 `server`、匿名 `role`、`total`、`rows`。所需列为 `id, money, status, orderType, rechargeItemId, dateline`。

统计规则：

- 区服＋订单 ID 去重，冲突或分页缺项拒绝生成。
- 只有成功现金订单（`status=1, orderType=1`）计入现金订单金额。代金券订单与未成功订单单列。
- 使用订单自身金额，不用当前商品价格反算历史金额；不称为渠道净收入。
- 区服＋角色去重；按北京时间的订单创建日展示，不能冒充支付日。
- 充值档位必须唯一对应当前商品，冲突进入 `unresolved`。未见成功记录不自动写零。
- 商品来源哈希变化时要求先更新商品快照。历史奖励版本、曝光、退款、钻石与其他业务流水仍需各自证据。

配图从道具配置的 `icon` 与游戏图集定位，保留原图，以坐标显示独立图标；不重绘。界面参考图明确标注来源和占位数值，不能代替当前实机截图。扩展入口路径或截图时只维护脚本中的对应关系，再统一生成资料包。

目前适配的是本地订单导出快照，尚非实时后台连接。新的导出格式应增加对应读取器，并验证支付类型、金额单位、时间字段和覆盖人群后再接入。

## 测试全期的 GM 统计

`build-test-revenue.py` 接收已保存的后台商品统计、经营日报与范围文件，生成可重复导入的同一资料包，以及独立 SQLite 备份。无需再维护一张商品表；以充值档位关联当前商品，历史金额保留后台原值。

```powershell
python scripts/commerce/build-test-revenue.py --directory <GM快照目录> --dataset <商品快照.json> --base-bundle <现有资料包.json> --output <新资料包.json> --database <测试历史.sqlite>
python scripts/commerce/test_build_test_revenue.py
```

目录包含 `scope.json`、每服一份 `gm-products-S<编号>.json` 和 `gm-daily-S<编号>.json`。范围文件维护 `title, from, through, coverage, servers[{id,name,group}]`；日期按北京时间完整日，`through` 包含当天。商品原表使用 `from, toExclusive, server, readAt, tables`；日报使用 `from, through, server, readAt, tables`。`tables` 保存后台页面原始 `headers` 和 `rows`，不能先把商品金额转换成现金金额。

- 商品统计包含现金和代金券，金额由后台按配置价统计；不等于商品现金实收。购买人数为每日去重人数累加。
- 现金充值来自经营日报；逐服日明细之和必须等于后台区间汇总。缺行保留缺失，不能补成零。
- 旧角色样本单独保留，不叠加进全期总额。全期重复日期、重复商品、缺服、时间范围不一致或负数会阻止导入。
- SQLite 保存来源摘要、商品统计和逐日现金，JSON 导入画板后随原画板保存。读取是历史快照，不是持续实时连接；更新时用相同流程重新读取并导入。
- 仅更新图片或旧订单样本的资料包会保留画板上已有的全期营收；带有新全期统计的资料包才替换该统计。
- 商品内容不明、充值档位不唯一、历史奖励版本未证实等问题显式保留。现金拆分、曝光转化和设计达标不能仅凭商品统计得出。

验收：核对来源总额 → 分服筛选 → 商品查看链路 → 缺项可见 → 刷新后数据仍在。页面的“设计预期”候选不因接入收入而变为已确认目标。

## 商品支付与钻石流水

`build-product-ledger.py` 在同一个资料包中增加 `ledger`，无需复制商品定义。充值档位唯一对应现金 / 代金券订单；礼包 ID 对应钻石购买。使用原订单 `money`，代金券订单金额不当现金或实际扣券面额。历史奖励保留日志原文。

```powershell
python scripts/commerce/extract-gift-props.py --directory <first_week_behavior目录> --output <本地购买礼包道具流水.json>
python scripts/commerce/build-product-ledger.py --dataset <商品快照.json> --base-bundle <全期统计资料包.json> --orders <带完整列名的订单.json> --directory <GM操作日志快照目录> --props-extract <本地购买礼包道具流水.json> --database <商品证据.sqlite> --output <资料包.json>
python scripts/commerce/test_build_product_ledger.py
```

操作日志快照为 `gm-gift-actions-S<server>-private.json`，包含 `server, roleId, readAt, totalText, tables[{headers,rows}]`。在后台角色的“操作日志”筛选“购买礼包”，保存日期、操作、数据三列；必须读完所有分页，不能把某一页声明为完整角色记录。原始身份仅保存在本地输入；SQLite 使用匿名角色摘要，画板仅包含汇总。

道具流水缺礼包 ID 时只统计未关联扣除。即使价格与奖励完全相同也不能推断商品身份。旧备份的 `returned` 是时间过滤前分页计数，`rows` 是过滤后的数据，不能误判二者不等就缺页。提取器检查 `returned >= total` 并保存来源摘要清单。

当前后台按角色查询，只接入实际取得的角色样本；界面明确分开全期统计与样本。只更新旧配图的资料包保留已有 `ledger`。全量补齐所需的逐单字段、操作日志字段和开放证据记录在资料包 `gaps` 中。不要将角色样本外推或叠加进全服汇总，不要将明细表的同秒两笔购买折叠为一笔。

## 6 月旧服的日报备份

`build-archived-revenue.py` 读取迁移包中的 `game_data_*_202606*.json` 与 `daily_retention_202606*.json`，从留存报表恢复每日 `OrderTotalAmount`。这些是累计观测，**不是逐笔订单**；不能套用 10 月的现金口径，也不能分摊到当前商品。

```powershell
python scripts/commerce/build-archived-revenue.py --directory <六月备份数据记录目录> --scope <范围.json> --availability <后台可用性核查.json> --base-bundle <现有完整资料包.json> --database <独立六月备份.sqlite> --output <新资料包.json>
python scripts/commerce/test_build_archived_revenue.py
```

范围文件保存稳定批次 `id`、标题、日期边界和 `servers[{id,name,group}]`，王者 S501—S508 与魔灵 S11—S18 的身份取自迁移交接资料。每个区服＋日期选择抓取时间最新的一份；不求多次快照之和，也不取金额最大值。相同抓取时间的金额冲突阻止生成。缺订单数不填零，也不用较旧快照的订单数搭配较新金额。原始输入、未选中的旧观测与最终记录分别存于 SQLite 的 `source_files`、`observations` 和 `daily_selected`。

资料存入 `evidence.archives`，按批次 ID 更新；后续更新配图或 10 月资料不会抹掉 6 月备份。画板“历史测试批次”可进入旧服视图，王者、魔灵及逐服明细均由同一份资料生成。当天快照和次日回读分别标注，缺失日期不补零；原始支付类型、退款、商品 ID、钻石日志及 6 月商品配置缺失时保持待补，不继承 10 月的商品记录。
# 商品配置与实得核对

商品清单中的源表定义、后台 SQL 草稿、带礼包 ID 的购买流水分开保存。导入时间不代表配置修改时间；`sources.revision/checkedAt/origin` 记录读取的版本。`catalogReview.draft` 只能作为草稿对照，不能作为各服发布证明。

`productFacts` 从当前导入的流水自动比较奖励和价格。只有名称能唯一对应配置物品、物品种类完整、区服和日期内的奖励一致时，才在清单显示“流水实得”；原配置保留，差异不会由哈希更新消除。缺失随机奖励或同一商品出现多种实得时，保留配置并标为待核全。切换区服不会借用其他区服的证据。

配置更新包在已有 `infinite-board-commerce-evidence` 中附带 `catalog`，包含原 `baseSources/baseProducts` 和重新提取的 `products/sources/created/scope`。导入会检查原记录是否变化、身份和设计关联是否保留，以及历史充值档位和礼包 ID 是否仍唯一对应。不能仅换 sourceHashes。先执行：

`node --import tsx scripts/commerce/validate-catalog-refresh.ts before.json bundle.json audit.json`

校验后使用画板“更新配图与历史”导入。`before.json`、配置快照、后台页面采集及包文件保存在任务私有资料目录，勿提交角色与订单原始数据。缺逐服生效配置及发布记录时，不得称为实时线上清单。

# 全量价格与奖励核对

`audit-catalog.py` 从画板当前快照、已固定版本的 11 份配置、订单备份与完整分页的礼包日志重算价格及奖励。它把分次折扣、递增价格、随机折扣、免费／广告方式写回同一份商品记录；设计需求、商品身份与原画板关联保留。

核查资料包的 `catalogReview.audit` 保存逐项结论、缺失字段和不涉及现金的领取记录。领取记录不能计入钻石消费或现金收入。GM 的普通道具展示会省略 `Diamond`、`MagicSpirit` 等对象字段：没有“获得道具”段的购买日志，仍必须保留带 SKU 的钻石扣费。空白奖励标为未核全，不能补成零或源表奖励。

`status=missing/unmapped` 的引用、没有充值档位和奖励的现金空壳从正常浏览排除；原记录与历史统计不删除。未购买不是未生效的证据。Nacos 发布、SQL 草稿、逐服加载版本和历史实得分别记录，未绑定测试环境的 Nacos 快照不得冒充线上配置。

新增日志解析能力时，保留旧 SQLite 备份，生成新备份并逐项核对差额。本轮 `validate-catalog-refresh.ts ... --complete-missing-rewards` 专门核对补入的 980 笔、336,870 钻石，要求所有既有商品购买行、现金／代金券、6 月历史与设计关联完全保留；普通刷新仍要求流水完全不变。

## 道具包含关系与资源兑换入口

`audit-item-placements.py` 复用 `audit-catalog.py` 的价格／奖励提取，对全部定义与道具表逐项检查（含额外奖励）。它从客户端 `ShopExchangeType` 与商店集合页签提取具体名称，写入商品的 `placement`；保留原 `channel`，不破坏商业模式大类和历史关联。新名称、筛选、商品卡共用这份元数据，不另建商品表。

```powershell
python scripts/commerce/audit-item-placements.py --dataset <商品快照.json> --item-map <道具价值资料.json> --client <客户端根目录> --assets-bundle <已有完整配图包.json> --report <核查报告.json> --output <入口更新包.json>
node --import tsx scripts/commerce/validate-catalog-refresh.ts <商品快照.json> <入口更新包.json> <更新校验.json>
node --import tsx scripts/commerce/validate-item-placements.ts <导入后商品快照.json> <道具价值资料.json>
```

按原“更新配图与历史”入口导入，原始资料与汇总报告保留在私有资料目录。入口名不能证明各服已开放；价格、奖励和历史不因命名更新而改变。默认关联图展示全部获得方式，付费、兑换和免费领取按需筛选；被筛选掉的数量及恢复全部入口持续可见。作为兑换消耗的货币不自动算成商品奖励，随机池内容不冒充确定发放。

## 道具总览完整性复查

先从原画板取得当前商品资料与道具资料，使用 `build-item-value-data.py` 重新读取正式《商业化产出》和客户端配置，再运行：

```powershell
python scripts/commerce/audit-item-completeness.py --dataset <商品资料.json> --before <原道具资料.json> --item-map <新道具资料.json> --client <客户端根目录> --assets-bundle <原完整配图包.json> --report <完整性报告.json> --output <补图包.json>
node --import tsx scripts/commerce/validate-item-completeness.ts <商品资料.json> <原道具资料.json> <新道具资料.json> <补图包.json> <核验结果.json>
python scripts/test-item-value-completeness.py
```

报告核对全部商品定义、直接奖励和额外奖励、兑换消耗、正式价格与用户批准值、原始游戏图标、来源清单及随机候选。候选使用 `Drop.WeightDrop` 区分物品 ID 和嵌套掉落组，遇到缺失、循环或专用对象类型时保留缺项；不按随机容器的价值给具体候选定价，也不自动算入必得商品关联。

道具总览按 `category` 分列、基础价分档从高到低排列，档内也按实际基础价降序。分类由 `build-item-value-data.py / item_category` 根据工程类型、兑换用途与名称生成；武器、专武和积分不能兜底进英雄。时间、投放条件和来源仍保存在道具详情中。相同类别、家族、品质和单价的道具可以跨投放节点汇总，展开后仍留在原类型列；未知价格保留在待处理页。使用原“更新数值资料”导入，或“整理坐标”重排；保留道具身份、商品售价关联、自由批注和其他页面，不维护第二份商品或价格资料。

先按原“更新配图与历史”入口导入补图包，再在道具画板“更新数值资料”导入新道具资料。批准价格由现有导入逻辑保留。商品、历史支付、六月备份及历史差异必须保持原样；修改后在页面检查“收录与缺项”、货币消耗去向、随机候选展开、同类折叠及刷新保存。投放依据完整保留，不截取前若干条。全游戏首次时间、各服开放与全量业务流水仍需各自证据，不因覆盖检查通过而自动认定完整。
