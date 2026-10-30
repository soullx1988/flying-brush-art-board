"""Audit every catalog reward link and enrich exchange entrances from the game client.

No prices, rewards, orders, base values or inferred live status are changed. Output is
a normal, concurrency-checked catalog update, imported through the existing UI.
"""
import argparse
import collections
import copy
import hashlib
import importlib.util
import json
import re
from pathlib import Path

spec = importlib.util.spec_from_file_location('catalog_audit', Path(__file__).with_name('audit-catalog.py'))
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


def exchange_names(database, ui):
    enum = database.split('export enum ShopExchangeType {', 1)[1].split('}', 1)[0]
    definitions = re.findall(r'别名:\s*([^\r\n]+).*?\*/\s*(\w+)\s*=\s*(\d+)', enum, re.S)
    names = {int(value): {'name': name.strip(), 'symbol': symbol, 'ui': False} for name, symbol, value in definitions}
    config = ui.split('const RECRUIT_ALL_SHOP_TAB_CONFIGS:', 1)[1].split('];', 1)[0]
    for block in re.findall(r'\{([^{}]+)\}', config):
        title = re.search(r'title:\s*"([^"]+)"', block)
        target = re.search(r'exchangeShopType:\s*Shop.ShopExchangeType\.(\w+)', block)
        if title and target:
            entry = next((v for v in names.values() if v['symbol'] == target[1]), None)
            if entry:
                entry.update(name=title[1], ui=True)
    return names


def audit_links(data, map_data, expected):
    products = {p['key']: p for p in data['products']}
    missing = sorted(set(expected) - products.keys())
    extra = sorted(p['key'] for p in products.values() if p['status'] == 'defined' and p['key'] not in expected)
    differences = []
    for key, fields in expected.items():
        if key not in products:
            continue
        for field, value in fields.items():
            old = products[key].get(field, [] if field in ('rewards', 'extraRewards') else None)
            same = audit.signature(old) == audit.signature(value) if field in ('rewards', 'extraRewards') else old == value
            if not same:
                differences.append({'key': key, 'field': field, 'before': old, 'expected': value})
    eligible = [p for p in products.values() if p['status'] == 'defined' and not (p['kind'] == 'cash' and not p.get('rid') and not p['rewards'])]
    by_item = collections.defaultdict(list)
    for p in eligible:
        for item in {r['id'] for r in p['rewards'] + p.get('extraRewards', [])}:
            by_item[item].append(p['key'])
    ids = {i['id'] for i in map_data['items']}
    return {
        'definitions': len(expected), 'visibleProducts': len(eligible), 'missingProducts': missing,
        'extraProducts': extra, 'differences': differences, 'unmappedRewardIds': sorted(by_item.keys() - ids),
        'items': len(ids), 'itemsWithProducts': len(ids & by_item.keys()), 'links': sum(map(len, by_item.values())),
        'byItem': dict(by_item),
        'withoutDirectProductReward': [{'id': i['id'], 'name': i['name']} for i in map_data['items'] if i['id'] not in by_item],
    }


def run(args):
    data = audit.read(args.dataset)
    for src in data['sources'].values():
        if audit.source(src['path'])['sha256'] != src['sha256']:
            raise ValueError('Source changed: ' + src['path'])
    expected, *_ = audit.expected_products(data)
    report = audit_links(data, audit.read(args.item_map), expected)
    client = args.client / 'Lucky/assets'
    db_path = client / 'ScriptsFramework/Game/Config/Database.ts'
    ui_path = client / 'Script/Fgui/UIRecruitAllShop/FUIRecruitAllShop.ts'
    names = exchange_names(db_path.read_text(encoding='utf-8-sig'), ui_path.read_text(encoding='utf-8-sig'))
    # A line-ending change is not a semantic change; compare parsed game configs too.
    report['clientChecks'] = []
    for key, src in data['sources'].items():
        if key.startswith('tables_') and key != 'tables_sysitems_tbitems':
            current = client / 'AssetsPackage/Datas' / (key + '.json')
            same = audit.read(src['path']) == audit.read(current)
            report['clientChecks'].append({'key': key, 'same': same, **audit.source(current)})
    if report['missingProducts'] or report['extraProducts'] or report['differences'] or report['unmappedRewardIds'] or not all(c['same'] for c in report['clientChecks']):
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        raise ValueError('Coverage/source mismatch; inspect report before importing')
    products = copy.deepcopy(data['products'])
    counts = collections.Counter()
    for p in products:
        if not p['key'].startswith('exchange:'):
            continue
        shop_type = int(p['key'].split(':')[1])
        if shop_type not in names:
            raise ValueError('Unknown exchange type: ' + str(shop_type))
        entry = names[shop_type]
        p['placement'] = {
            'name': entry['name'],
            'path': ('商店集合 → ' if entry['ui'] else '') + entry['name'],
            'source': ('exchange_shop_ui / RECRUIT_ALL_SHOP_TAB_CONFIGS → ' if entry['ui'] else '') + f"exchange_shop_types / ShopExchangeType.{entry['symbol']}={shop_type} → {p['source']} / {p['sku']}",
        }
        p['note'] = '商店名称已按客户端页签／配置枚举核对。兑换价格、限购来自配置；各服实际开放、解锁进度与兑换流水仍待核验。'
        counts[entry['name']] += 1
    sources = copy.deepcopy(data['sources'])
    for key, path in [('exchange_shop_ui', ui_path), ('exchange_shop_types', db_path)]:
        sources[key] = {'name': path.name, 'origin': str(path), **audit.source(path)}
    evidence = copy.deepcopy(data['evidence'])
    evidence['sourceHashes'] = {key: value['sha256'] for key, value in sources.items()}
    report['exchanges'] = dict(counts)
    report['gaps'] = ['逐服实际开放、当前解锁条件与兑换扣费／发奖流水未接入。', '商品包含关系不含随机池递归展开、引导／任务／邮件等非商品来源；首次投放节点仍沿用已核证据。']
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    files = audit.read(args.assets_bundle)['files']
    if any(key not in files for key in evidence['assets']):
        raise ValueError('Missing existing image assets')
    bundle = {'format': 'infinite-board-commerce-evidence', 'version': 1, 'evidence': evidence, 'files': {h: files[h] for h in evidence['assets']},
              'catalog': {'baseSources': {k: v['sha256'] for k, v in data['sources'].items()}, 'baseProducts': data['products'],
                          'created': data['created'], 'scope': data['scope'], 'products': products, 'sources': sources}}
    args.output.write_text(json.dumps(bundle, ensure_ascii=False), encoding='utf-8')
    print(json.dumps({k: v for k, v in report.items() if k not in ('byItem', 'clientChecks')}, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('dataset', 'item-map', 'client', 'assets-bundle', 'report', 'output'):
        parser.add_argument('--' + name, type=Path, required=True)
    run(parser.parse_args())
