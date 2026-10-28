"""Read explicit diamond values only; merchandise prices never supply a baseline."""
from collections import defaultdict
import hashlib
import math
from pathlib import Path


def number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0


def read_rows(workbook):
    sheet = next((s for s in ("IN_玩法_道具定价", "道具定价") if s in workbook.sheetnames), None)
    if sheet is None:
        raise ValueError("所选工作簿没有道具定价页；请核对正式数值目录，不能改用礼包售价反推")
    ws = workbook[sheet]
    expected = {2: "道具名称", 4: "钻石价值", 6: "道具id"}
    if any(ws.cell(5, col).value != label for col, label in expected.items()):
        raise ValueError(f"{sheet}: 道具名称/钻石价值/道具id表头不匹配，请核对工作簿版本")
    rows = []
    for n, row in enumerate(ws.iter_rows(min_row=6, max_col=6, values_only=True), 6):
        name, value, item_id = row[1], row[3], row[5]
        if not isinstance(name, str) or not name.strip():
            continue
        valid_id = number(item_id) and item_id > 0 and int(item_id) == item_id
        rows.append({"name": name.strip(), "value": value, "id": int(item_id) if valid_id else None,
                     "source": f"{sheet}!D{n}", "identitySource": f"{sheet}!B{n}:F{n}"})
    return rows


def extract(path, items, source_url=None, revision=None):
    import openpyxl
    path = Path(path)
    workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
    try:
        rows = read_rows(workbook)
    finally:
        workbook.close()
    origin = source_url or str(path)
    if revision:
        origin += f"@r{revision}"
    by_id, by_name = defaultdict(list), defaultdict(list)
    for row in rows:
        if row["id"] is not None:
            by_id[row["id"]].append(row)
        else:
            by_name[row["name"]].append(row)
    name_counts = defaultdict(int)
    for item in items:
        name_counts[item["name"]] += 1
    prices, unmatched, renamed = {}, [], []
    for item in items:
        evidence = by_id.get(item["id"], [])
        if not evidence and name_counts[item["name"]] == 1:
            evidence = by_name.get(item["name"], [])
        if not evidence:
            continue
        sources = "、".join(dict.fromkeys(r["source"] for r in evidence))
        note = "直接读取道具定价的钻石价值列。商品折扣与成交价在商品总览查看。"
        values = [r["value"] for r in evidence]
        if not all(number(v) for v in values) or len(set(values)) != 1:
            reason = "基础价单元格为空、错误或无有效公式缓存" if not all(number(v) for v in values) else "同一道具ID存在不同基础价，待核对源表"
            prices[str(item["id"])] = {"value": None, "source": f"{origin} / {sources}", "note": reason}
            unmatched.append({"id": item["id"], "reason": reason, "evidence": evidence})
            continue
        names = list(dict.fromkeys(r["name"] for r in evidence))
        display_name = item["name"]
        if names != [item["name"]]:
            if names == [item["name"] + "碎片"] and item.get("debris") == 1:
                display_name = names[0]
                note += f" 工程名称为「{item['name']}」，debris=1；显示碎片全称。"
            else:
                note += f" 按相同道具ID读取；源表名称「{'、'.join(names)}」，工程名称「{item['name']}」，名称差异待核验。"
                renamed.append({"id": item["id"], "name": item["name"], "sourceNames": names})
        if values[0] == 0:
            note += " 源表填0，仅表示表内基础定价值，不代表免费出售。"
        prices[str(item["id"])] = {"value": values[0], "source": f"{origin} / {sources}", "note": note, "displayName": display_name}
    provenance = {"path": origin, "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "label": "商业化产出：道具定价·钻石价值（直接读取）"}
    audit = {"source": provenance, "sourceRows": len(rows), "unmatched": unmatched, "nameDifferences": renamed,
             "excluded": ["未使用礼包售价、折扣、返利比或历史成交反推基础价。", "未把随机宝石的价格套用到具体部位宝石；未用旧副本补齐。"]}
    return prices, provenance, audit
