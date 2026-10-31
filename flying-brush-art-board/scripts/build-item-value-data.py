"""Read-only source extraction for the independent item-value board.

No merchandise sale price is used as an item base price. --prices accepts a
source-derived JSON mapping {itemId: {value, source, note}}; omit it to keep
unknown prices explicit. The source workbook remains the owning editable file.
"""
import argparse
import hashlib
import json
import importlib.util
import math
import re
from datetime import datetime
from pathlib import Path


def item_category(item, name, exchange_currency=False):
    """One classification for the map and subsequent source refreshes."""
    typed = {2: "英雄与碎片", 10: "英雄与碎片", 18: "武器与碎片", 33: "武器与碎片", 34: "武器与碎片",
             22: "宝石与原石", 26: "皮肤", 30: "魔灵"}.get(item.get("item_type"))
    if typed:
        return typed
    if (item.get("item_type") == 1 and exchange_currency) or any(w in name for w in ["币", "钻石", "星辰", "声望", "积分", "友情点"]):
        return "货币与积分"
    if any(w in name for w in ["券", "钥", "之匙", "体力", "凭证"]):
        return "抽取与次数"
    if any(w in name for w in ["宝石", "原石"]):
        return "宝石与原石"
    if any(w in name for w in ["魔灵", "魔核", "魔晶"]):
        return "魔灵"
    if item.get("item_type") == 25 or any(w in name for w in ["经验", "合金", "陨铁", "精髓", "精粹", "蓝图", "合成石"]):
        return "养成材料"
    if "英雄" in name:
        return "英雄与碎片"
    return "其他道具"


def pricing_reviews(result, items, drops, prices, products):
    """Questions are generated from missing direct rows, never new price assumptions."""
    pools = {d["id"]: d for d in drops}
    parents = {}
    for parent in items.values():
        price = prices.get(str(parent["id"]), {})
        if price.get("value") is None or parent.get("item_type") != 5 or parent.get("use_value") != 1:
            continue
        pool_key = str(parent.get("use_detail_value", ""))
        pool = pools.get(int(pool_key)) if pool_key.isdigit() else None
        rewards = pool.get("weight_drop_award", []) if pool else []
        if not rewards or pool.get("sure_drop_award") or pool.get("special_probability_drop_award") or any(r.get("num") != 1 for r in rewards):
            continue
        for reward in rewards:
            child = items.get(reward["id"], {})
            if child.get("item_type") == 22 and child.get("quality") == parent.get("quality"):
                parents.setdefault(child["id"], []).append((parent, price, pool))
    groups = {}
    for item in result:
        if item["basePrice"] is not None:
            continue
        item_id = item["id"]
        candidate = parents.get(item_id, [])
        if len(candidate) == 1:
            parent, price, pool = candidate[0]
            key = f"pool-{pool['id']}"
            title = parent["name"].removeprefix("随机") + " · 具体部位"
            question = f"各部位是否统一采用 {price['value']:g} 钻/个，还是分别定价？当前保持空缺，等你决定。"
            context = f"表内「{parent['name']}」为 {price['value']:g} 钻，随机池包含这些部位；表中未规定确定部位的价值。"
            sources = [price["source"], f"tables_sysdrop_tbdrop.json / {pool['id']}.weight_drop_award"]
        else:
            key, title = f"item-{item_id}", item["name"]
            channels = list(dict.fromkeys(p["channel"] for p in products if any(r["id"] == item_id for r in p["rewards"] + p.get("extraRewards", []))))
            context = (item["description"] or "当前道具配置与定价页均未找到此ID。") + (f" 关联入口：{'、'.join(channels)}。" if channels else "")
            question = "请确认正确名称、道具ID及基础钻石价值；若已废弃，注明剔除。" if item_id not in items else "请填写每 1 个道具的基础钻石价值。"
            sources = [item["priceNote"]]
        if key not in groups:
            groups[key] = {"id": key, "kind": "price", "title": title, "itemIds": [], "question": question, "context": context, "sources": sources}
        groups[key]["itemIds"].append(item_id)
    for item in result:
        price = prices.get(str(item["id"]), {})
        if item["basePrice"] is not None and "名称差异待核验" in price.get("note", ""):
            groups[f"name-{item['id']}"] = {"id": f"name-{item['id']}", "kind": "name", "title": item["name"] + " · 名称核对", "itemIds": [item["id"]],
                "question": "请确认是否只是同一道具改名；如不是，需修正源表ID与对应定价。",
                "context": f"当前按同ID取 {item['basePrice']:g} 钻。" + price["note"].split("按相同道具ID读取；")[-1], "sources": [price["source"]]}
    return list(groups.values())


def build(catalog_snapshot, config_dir, source_board_id, prices=None, commercial_workbook=None, audit_output=None, commercial_source_url=None, commercial_source_revision=None):
    raw = json.loads(Path(catalog_snapshot).read_text(encoding="utf-8"))
    records = raw.get("document", raw)["store"].values()
    catalog = next(r for r in records if r["typeName"] == "document")["meta"]["commerceOverview"]["dataset"]
    products = [p for p in catalog["products"] if p["status"] == "defined" and not (p["kind"] == "cash" and not p.get("rid") and not p["rewards"])]
    root = Path(config_dir)
    sources = []

    def load(name):
        path = root / name
        content = path.read_bytes()
        sources.append({"path": str(path), "sha256": hashlib.sha256(content).hexdigest(), "label": name})
        return json.loads(content)

    items = {i["id"]: i for i in load("tables_sysitems_tbitems.json")}
    drops = load("tables_sysdrop_tbdrop.json")
    missions = load("tables_sysbattles_tbbattlechaptermission.json")
    functions = {r["id"]: r for r in load("tables_sysfunction_tbfunctionlist.json")}
    switches = {r["id"]: r["isOpen"] for r in load("tables_sysfunction_tbfunctionswitch.json")}
    exchange = load("tables_sysshop_tbshopexchange.json")
    wanted = {r["id"] for p in products for r in p["rewards"] + p.get("extraRewards", [])}
    # Include currencies spent by the same catalog, even when none of its bundles grants them.
    wanted.update(r["cost"]["id"] for group in exchange for r in group["line"] if r.get("cost") and any(p["key"] == f'exchange:{group["type"]}:{r["item_id"]}' for p in products))
    wanted.update([300001, 300003])
    candidates = {i: [] for i in wanted}
    # Follow Drop.WeightDrop.DropID, not an item ID. Keep candidate contents
    # separate from direct merchandise rewards and never infer a base value.
    pools = {d['id']: d for d in drops}
    def contents(pool_id, trail=(), inherited='guaranteed'):
        if pool_id in trail or pool_id not in pools:
            return [], [f'掉落组 {pool_id} 缺失或循环引用']
        pool = pools[pool_id]; result, gaps = [], []
        for field, mode in [('sure_drop_award', 'guaranteed' if pool['sure_type'] == 1 else 'choice'), ('weight_drop_award', 'random')]:
            for reward in pool.get(field, []):
                if reward.get('num', 0) <= 0 or (field == 'weight_drop_award' and reward.get('weight', 0) <= 0):
                    continue
                kind = inherited if inherited != 'guaranteed' else mode
                if field == 'weight_drop_award' and pool['weight_type'] == 2:
                    children, missing = contents(reward['id'], (*trail, pool_id), kind)
                    result.extend(children); gaps.extend(missing); continue
                if field == 'weight_drop_award' and pool['weight_type'] != 1:
                    gaps.append(f'掉落组 {pool_id} 使用类型 {pool["weight_type"]}，需核对专用对象映射'); continue
                target = items.get(reward['id'])
                if not target:
                    gaps.append(f'掉落组 {pool_id} 的道具 {reward["id"]} 未匹配'); continue
                name = target['name'] + ('碎片' if target.get('debris') == 1 and not target['name'].endswith('碎片') else '')
                result.append({'id': target['id'], 'name': name, 'kind': kind,
                    'source': f'tables_sysdrop_tbdrop.json / {" → ".join(map(str, (*trail, pool_id)))}.{field}'})
        if pool.get('special_probability_drop_award'):
            gaps.append(f'掉落组 {pool_id} 还有特殊概率规则，需核对条件')
        return list({(r['id'], r['kind']): r for r in result}.values()), list(dict.fromkeys(gaps))
    mission_order = {m["missionID"]: m["missionLevel"] for m in missions if 100000 <= m["missionID"] < 200000}

    def add(item_id, order, label, source, kind="progress"):
        if item_id in candidates:
            candidates[item_id].append({"order": order, "label": label, "source": source, "kind": kind})

    for m in missions:
        if m["missionID"] not in mission_order:
            continue
        for field in ["MissionFirstReward", "reward1", "reward2", "reward3", "battleRewards"]:
            for reward in m.get(field, []):
                if reward.get("num", 0) > 0:
                    label = f'{m["missionName"]} · ' + {"reward1": "1星奖励", "reward2": "2星奖励", "reward3": "3星奖励", "battleRewards": "战斗奖励", "MissionFirstReward": "首次奖励"}[field]
                    add(reward["id"], m["missionLevel"], label, f'tables_sysbattles_tbbattlechaptermission.json / {m["missionID"]}.{field}')

    def function_gate(function_id):
        f = functions.get(function_id)
        if not f or not switches.get(function_id, False):
            return None
        if f["defaultUnlock"] and not f["openRequire"]:
            return (0, f'{f["name"]} · 默认开放', "progress")
        requirements = [json.loads(r) for r in f["openRequire"]]
        if len(requirements) == 1 and set(requirements[0]) == {"wave"}:
            wave = requirements[0]["wave"]
            level = mission_order.get(wave["missionId"])
            if level is not None:
                return (level, f'第{level}关第{wave["waveId"]}波后 · {f["name"]}', "progress")
        return (10000, f'{f["name"]} · 条件 {"、".join(f["openRequire"])}', "conditional")

    for f in functions.values():
        gate = function_gate(f["id"])
        if gate:
            for reward in f["reward"]:
                if reward.get("num", 0) > 0:
                    add(reward["id"], gate[0], gate[1] + "开启奖励", f'tables_sysfunction_tbfunctionlist.json / {f["id"]}.reward', gate[2])

    # These links are explicit entrance ownership. This yields an earliest KNOWN
    # configuration source, not a claim that all free and personalized routes were scanned.
    channel_functions = {"首充": 10, "月卡": 9, "钻石充值": 110, "日礼包": 156, "周礼包": 157, "月礼包": 158, "每日随机商店": 147, "金币礼包": 115, "每日特惠礼包": 167, "基金": 56}
    for p in products:
        gate_id = channel_functions.get(p["channel"])
        gate = function_gate(gate_id) if gate_id else None
        if not gate:
            continue
        for r in p["rewards"] + p.get("extraRewards", []):
            add(r["id"], gate[0], f'{gate[1]} / {p["title"]}', f'tables_sysfunction_tbfunctionlist.json / {gate_id}.openRequire → 商品 {p["key"]}；商品独立条件、分日发放与后台开关待核验', "conditional")

    price_data = {}
    if prices:
        path = Path(prices)
        price_data = json.loads(path.read_text(encoding="utf-8"))
        sources.append({"path": str(path), "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "label": "基础定价源读取结果"})
    if commercial_workbook:
        if prices:
            raise ValueError("Choose one price owner: --prices or --commercial-workbook")
        spec = importlib.util.spec_from_file_location("commercial_prices", Path(__file__).with_name("commercial-base-prices.py"))
        reader = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(reader)
        price_data, provenance, audit = reader.extract(commercial_workbook, list(items.values()), commercial_source_url, commercial_source_revision)
        sources.append(provenance)
    stages = [
        {"id": "start", "label": "上手期", "order": 0, "kind": "progress"},
        {"id": "1-5", "label": "第 1—5 关", "order": 1, "kind": "progress"},
        {"id": "6-10", "label": "第 6—10 关", "order": 6, "kind": "progress"},
        {"id": "11-20", "label": "第 11—20 关", "order": 11, "kind": "progress"},
        {"id": "21+", "label": "第 21 关及以后", "order": 21, "kind": "progress"},
        {"id": "conditional", "label": "入口与活动条件", "order": 10000, "kind": "conditional"},
        {"id": "unknown", "label": "首次投放待核验", "order": 20000, "kind": "unknown"},
    ]
    result = []
    for item_id in sorted(wanted):
        item = items.get(item_id, {})
        name = item.get("name") or next((r["name"] for p in products for r in p["rewards"] + p.get("extraRewards", []) if r["id"] == item_id), str(item_id))
        candidate = sorted(candidates[item_id], key=lambda c: (c["kind"] != "progress", c["order"]))
        first = candidate[0] if candidate else None
        stage = "unknown"
        if first:
            n = first["order"]
            stage = "conditional" if first["kind"] != "progress" else "start" if n == 0 else "1-5" if n <= 5 else "6-10" if n <= 10 else "11-20" if n <= 20 else "21+"
        price = price_data.get(str(item_id), {})
        if price.get("estimate") is not None:
            raise ValueError(f"Estimated prices are retired; read the direct source cell: {item_id}")
        name = price.get("displayName", name)
        value = price.get("value")
        if value is not None and (not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value) or value < 0 or not price.get("source")):
            raise ValueError(f"Invalid base price evidence: {item_id}")
        family = {2: "英雄碎片" if item.get("debris") == 1 else "英雄", 10: "英雄", 18: "专属武器碎片" if item.get("debris") == 1 else "专属武器", 22: "部位宝石", 26: "皮肤", 30: "魔灵", 33: "武器", 34: "武器碎片"}.get(item.get("item_type"))
        pool_key = str(item.get('use_detail_value', ''))
        content_rows, content_gaps = contents(int(pool_key)) if item.get('item_type') == 5 and item.get('use_value') == 1 and pool_key.isdigit() else ([], [])
        exchange_uses = [f'exchange:{group["type"]}:{r["item_id"]}' for group in exchange for r in group['line'] if (r.get('cost') or {}).get('id') == item_id and any(p['key'] == f'exchange:{group["type"]}:{r["item_id"]}' for p in products)]
        cat = item_category(item, name, bool(exchange_uses))
        result.append({"id": item_id, "name": name, "category": cat, "description": re.sub(r"<[^>]*>", "", item.get("desc", "")),
            **({'contents': content_rows, 'contentGaps': content_gaps} if content_rows or content_gaps else {}),
            **({'exchangeUses': exchange_uses} if exchange_uses else {}),
            **({"family": family, "quality": item["quality"]} if family else {}),
            "basePrice": value, "priceSource": price.get("source", ""), "priceNote": price.get("note", (f"现用道具定价页没有 ID {item_id} 的对应行。" + ("表内随机宝石与具体部位宝石不是同一道具，不能直接套价。" if item.get("item_type") == 22 else "该ID也不在当前道具配置中，需先确认身份。" if not item else "需补充该道具定价行或明确名称映射。")) if commercial_workbook else "缺现用数值表的基础定价；未采用旧草案或商品成交价。"),
            "stageId": stage, "firstPlacement": first["label"] if first else "首次投放位置待核验",
            "placementNote": "这是已核到的配置来源。尚未穷尽引导、邮件、任务、后台活动与个性化条件，不能据此断言全游戏最早获得时间。" if first else "缺少可定位到关卡或时间的有效奖励、商店或活动开放条件。",
            "placementSources": list(dict.fromkeys(c["source"] for c in candidate))})
    reviews = pricing_reviews(result, items, drops, price_data, products)
    if commercial_workbook and audit_output:
        audit["reviewGroups"] = reviews
        audit["missingItems"] = [{"id": i["id"], "name": i["name"], "reason": i["priceNote"]} for i in result if i["basePrice"] is None]
        audit["plottedItems"] = [{"id": i["id"], "name": i["name"], "estimate": i.get("priceEstimate"), "value": i["basePrice"]} for i in result if i["basePrice"] is not None]
        Path(audit_output).write_text(json.dumps(audit, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"version": 1, "updated": datetime.now().strftime("%Y-%m-%d"), "sourceBoardId": source_board_id, "priceUnit": "钻石", "scope": "范围为关联商品总览中的有效商品奖励、即时奖励及兑换货币。基础价直接读取《商业化产出》道具定价页的钻石价值列；折扣留在商品总览。投放暂为已核到最早配置来源，未确认全游戏首次。", "sources": sources, "stages": stages, "items": result, "reviewGroups": reviews}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog", required=True)
    parser.add_argument("--config-dir", required=True)
    parser.add_argument("--source-board", required=True)
    parser.add_argument("--prices")
    parser.add_argument("--commercial-workbook")
    parser.add_argument("--commercial-source-url")
    parser.add_argument("--commercial-source-revision")
    parser.add_argument("--audit-output")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    data = build(args.catalog, args.config_dir, args.source_board, args.prices, args.commercial_workbook, args.audit_output, args.commercial_source_url, args.commercial_source_revision)
    Path(args.output).write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"items": len(data["items"]), "priced": sum(i["basePrice"] is not None for i in data["items"]), "knownPlacement": sum(i["stageId"] not in ("unknown", "conditional") for i in data["items"])}, ensure_ascii=False))
