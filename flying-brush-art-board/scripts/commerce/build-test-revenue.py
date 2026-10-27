"""Import saved GM tables as a reproducible test-period revenue snapshot.

The operating daily report and the product report have different accounting
bases. Preserve both; never allocate the difference to products or infer cash
sales by subtracting voucher buyer counts from order counts.
"""
import argparse
import collections
from contextlib import closing
import datetime as dt
import hashlib
import json
import pathlib
import re
import sqlite3


def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def integer(value):
    if not str(value).isdigit():
        raise ValueError(f'Invalid nonnegative integer: {value}')
    return int(value)


def parse_daily(report):
    tables = report['tables']
    headers = next(t['headers'] for t in tables if '日期' in t['headers'])
    rows = [r for t in tables for r in t['rows'] if r and re.fullmatch(r'\d{4}-\d{2}-\d{2}', r[0])]
    result = []
    for cells in rows:
        if len(cells) != len(headers):
            raise ValueError('Daily table width mismatch')
        row = dict(zip(headers, cells))
        date = row['日期']
        dt.date.fromisoformat(date)
        if not report['from'] <= date <= report['through']:
            raise ValueError('Daily date outside requested period')
        result.append({'server': report['server'], 'date': date,
                       'orders': integer(row['订单数']), 'yuan': integer(row['总充值']),
                       'buyers': integer(row['付费用户数量'])})
    summaries = [t['headers'] for t in tables if '付费用户数量(去重)' in t['headers']]
    summary_cells = tables[-1]['rows']
    if len(summaries) != 1 or len(summary_cells) != 1 or not result:
        raise ValueError('Missing daily rows or interval summary')
    if len(summary_cells[0]) != len(summaries[0]):
        raise ValueError('Daily summary width mismatch')
    summary = dict(zip(summaries[0], summary_cells[0]))
    if len({r['date'] for r in result}) != len(result):
        raise ValueError('Duplicate daily date')
    if sum(r['yuan'] for r in result) != integer(summary['总充值']):
        raise ValueError('Daily sum does not match the GM interval summary')
    return result, integer(summary['付费用户数量(去重)'])


def parse_products(report):
    headers = next(t['headers'] for t in report['tables'] if '充值项目Id' in t['headers'])
    result = []
    for cells in [r for t in report['tables'] for r in t['rows']]:
        if len(cells) != len(headers):
            raise ValueError('Product table width mismatch')
        row = dict(zip(headers, cells))
        result.append({'server': report['server'], 'rechargeId': integer(row['充值项目Id']),
                       'name': row['充值项名称'], 'type': integer(row['充值类型']),
                       'configuredYuan': integer(row['充值项配置金额']),
                       'orders': integer(row['订单总数']), 'yuan': integer(row['订单总金额']),
                       'buyerDays': integer(row['充值人数(总计)']),
                       'voucherBuyerDays': integer(row['代金券充值人数'])})
    if not result or len({(r['rechargeId'], r['type']) for r in result}) != len(result):
        raise ValueError('Missing or duplicated product rows')
    return result


def build(directory, dataset, base_bundle, output, database):
    scope = read(directory / 'scope.json')
    end_exclusive = (dt.date.fromisoformat(scope['through']) + dt.timedelta(days=1)).isoformat()
    products = sorted(directory.glob('gm-products-S*.json'))
    daily_files = sorted(directory.glob('gm-daily-S*.json'))
    product_ids = {read(p)['server'] for p in products}
    daily_ids = {read(p)['server'] for p in daily_files}
    expected = {s['id'] for s in scope['servers']}
    if len(expected) != len(scope['servers']) or scope['from'] > scope['through']:
        raise ValueError('Invalid scope')
    if product_ids != expected or daily_ids != expected or len(products) != len(expected) or len(daily_files) != len(expected):
        raise ValueError('Each scope server needs exactly one product report and one daily report')
    rows, daily, servers, sources, read_times = [], [], [], [], []
    for path in products:
        report = read(path)
        if report['from'] != scope['from'] or report['toExclusive'] != end_exclusive:
            raise ValueError('Unexpected product period')
        server = report['server']
        daily_path = directory / f'gm-daily-S{server}.json'
        daily_report = read(daily_path)
        if daily_report['server'] != server or daily_report['from'] != report['from'] or daily_report['through'] != scope['through']:
            raise ValueError('Operating and product periods do not align')
        parsed_days, buyers = parse_daily(daily_report)
        parsed_products = parse_products(report)
        rows.extend(parsed_products)
        daily.extend(parsed_days)
        server_scope = next(s for s in scope['servers'] if s['id'] == server)
        label, group = server_scope['name'], server_scope['group']
        servers.append({'id': server, 'name': label, 'group': group, 'cashBuyers': buyers,
                        'cashOrders': sum(r['orders'] for r in parsed_days),
                        'cashYuan': sum(r['yuan'] for r in parsed_days),
                        'productOrders': sum(r['orders'] for r in parsed_products),
                        'productYuan': sum(r['yuan'] for r in parsed_products)})
        for source_path, value in [(path, report), (daily_path, daily_report)]:
            sources.append({'path': str(source_path), 'sha256': sha(source_path)})
            read_times.append(value['readAt'])
    by_rid = collections.defaultdict(list)
    for product in dataset['products']:
        if product.get('rid'):
            by_rid[product['rid']].append(product)
    unresolved = []
    for rid in sorted({r['rechargeId'] for r in rows}):
        matches = by_rid[rid]
        if len(matches) != 1 or matches[0]['status'] != 'defined':
            unresolved.append({'rechargeId': rid, 'reason': '当前商品对应缺失或不唯一' if len(matches) != 1 else '充值档位已对应，商品内容待核验'})
    sources.append({'path': str(directory / 'scope.json'), 'sha256': sha(directory / 'scope.json')})
    snapshot_id = hashlib.sha256(json.dumps(sources, sort_keys=True).encode()).hexdigest()
    database.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(database)) as con, con:
        con.execute('CREATE TABLE IF NOT EXISTS revenue_snapshots (id TEXT PRIMARY KEY, sources_json TEXT NOT NULL)')
        con.execute('CREATE TABLE IF NOT EXISTS gm_product_totals (snapshot_id TEXT, server INTEGER, recharge_id INTEGER, type INTEGER, body_json TEXT, PRIMARY KEY(snapshot_id,server,recharge_id,type))')
        con.execute('CREATE TABLE IF NOT EXISTS gm_cash_daily (snapshot_id TEXT, server INTEGER, date TEXT, body_json TEXT, PRIMARY KEY(snapshot_id,server,date))')
        con.execute('INSERT OR REPLACE INTO revenue_snapshots VALUES (?,?)', (snapshot_id, json.dumps(sources, ensure_ascii=False)))
        con.executemany('INSERT OR REPLACE INTO gm_product_totals VALUES (?,?,?,?,?)', [(snapshot_id, r['server'], r['rechargeId'], r['type'], json.dumps(r, ensure_ascii=False)) for r in rows])
        con.executemany('INSERT OR REPLACE INTO gm_cash_daily VALUES (?,?,?,?)', [(snapshot_id, r['server'], r['date'], json.dumps(r, ensure_ascii=False)) for r in daily])
    revenue = {'id': snapshot_id, 'title': scope['title'], 'from': scope['from'], 'through': scope['through'],
               'readAt': max(read_times), 'servers': sorted(servers, key=lambda s:s['id']), 'daily': daily,
               'products': rows, 'unresolved': unresolved, 'sources': sources,
               'backup': {'path': str(database), 'sha256': sha(database)},
               'dailyUrl': 'http://mlbj-web.4399xydj.com/#/layout/gameData/gameDailyData/retainDataList',
               'productUrl': 'http://mlbj-web.4399xydj.com/#/layout/gameData/rechargeData/queryRecharge',
               'cashBasis': '经营日报总充值：成功现金订单金额；沿用后台白名单过滤，不是退款后净收入。',
               'productBasis': '商品表含现金和代金券订单，金额按统计配置价计算；人数为每日去重人数累加，不能当区间去重人数。',
               'coverage': scope['coverage'],
               'limitations': ['区服日表缺行不填零；只统计所选完整日，未宣称测试已结束。',
                               '商品金额与现金充值口径不同；不能按差额推算某个商品的现金营收或代金券订单数。',
                               '当前商品按充值档位对应；测试时奖励版本、曝光、退款及全期订单明细仍待补证。',
                               'S102/S103 旧订单备份仅作独立样本，不与本次全期汇总相加。']}
    base_bundle['evidence']['revenue'] = revenue
    base_bundle['evidence']['updated'] = dt.datetime.now(dt.timezone.utc).isoformat()
    output.write_text(json.dumps(base_bundle, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    audit = {'servers': len(servers), 'productRows': len(rows), 'rechargeItems': len({r['rechargeId'] for r in rows}),
             'dailyRows': len(daily), 'cashYuan': sum(s['cashYuan'] for s in servers),
             'cashOrders': sum(s['cashOrders'] for s in servers), 'cashBuyers': sum(s['cashBuyers'] for s in servers),
             'productYuan': sum(r['yuan'] for r in rows), 'productOrders': sum(r['orders'] for r in rows),
             'unresolved': unresolved, 'sourceFiles': len(sources), 'snapshotId': snapshot_id}
    output.with_suffix('.audit.json').write_text(json.dumps(audit, ensure_ascii=False, indent=2), encoding='utf-8')
    return audit


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    for name in ['directory', 'dataset', 'base-bundle', 'output', 'database']:
        parser.add_argument('--' + name, type=pathlib.Path, required=True)
    args = parser.parse_args()
    print(json.dumps(build(args.directory, read(args.dataset), read(args.base_bundle), args.output, args.database), ensure_ascii=False))
