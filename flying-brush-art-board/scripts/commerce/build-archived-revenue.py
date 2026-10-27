"""Recover daily revenue observations from archived GM JSON, never infer SKU sales.

The source files are repeated captures, not transactions. Select the latest
observation for each server/day; preserve every input and choice in SQLite.
"""
import argparse
import datetime as dt
import hashlib
import json
from pathlib import Path
import sqlite3
from contextlib import closing


def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def source(path):
    return {'path': str(path.resolve()), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}


def timestamp(value):
    parsed = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    if parsed.tzinfo is None:
        raise ValueError('Capture time needs a timezone')
    return parsed


def observation(server, date, captured, row, path, kind):
    if timestamp(captured).astimezone(dt.timezone(dt.timedelta(hours=8))).date().isoformat() < date:
        raise ValueError('Observation predates its data day')
    value = row['OrderTotalAmount']
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value < 0:
        raise ValueError('Invalid report amount')
    out = {'server': server, 'date': date, 'capturedAt': captured, 'yuan': value, 'source': str(path.resolve())}
    for original, key in [('OrderNum', 'orders'), ('UserPayNum', 'buyers')]:
        if original in row:
            if not isinstance(row[original], int) or row[original] < 0:
                raise ValueError('Invalid count')
            out[key] = row[original]
    return {'value': out, 'kind': kind, 'raw': row}


def choose_latest(observations):
    chosen = {}
    for item in observations:
        value = item['value']
        key = value['server'], value['date']
        old = chosen.get(key)
        if old and timestamp(old['value']['capturedAt']) == timestamp(value['capturedAt']):
            # Duplicate capture files cannot introduce conflicting amounts or counts.
            for field in ['yuan', 'orders', 'buyers']:
                if field in old['value'] and field in value and old['value'][field] != value[field]:
                    raise ValueError(f'Conflicting same-time observation: {key}')
        if not old or timestamp(value['capturedAt']) > timestamp(old['value']['capturedAt']):
            chosen[key] = item
    return [chosen[key]['value'] for key in sorted(chosen)]


def build(args):
    scope = read(args.scope)
    servers = {s['id'] for s in scope['servers']}
    observations, files, empty = [], [], []
    def include(server, date):
        return server in servers and scope['from'] <= date <= scope['through']
    for path in sorted(args.directory.glob('game_data_*_202606*.json')):
        data = read(path)
        server = int(data['_meta']['server_id'])
        if server not in servers:
            continue
        files.append(path)
        rows = (data.get('留存') or {}).get('retainDta') or []
        if not rows:
            empty.append(str(path.resolve()))
        for row in rows:
            if include(server, row['Date']):
                observations.append(observation(server, row['Date'], data['_meta']['capture_time'], row, path, 'game_data'))
    for path in sorted(args.directory.glob('daily_retention_202606*.json')):
        data = read(path)
        files.append(path)
        for values in data['servers'].values():
            server = int(values['sid'])
            for date, row in values.items():
                if date.startswith('2026-06-') and include(server, date):
                    observations.append(observation(server, date, data['capture_time'], row, path, 'daily_retention'))
    daily = choose_latest(observations)
    if {row['server'] for row in daily} != servers:
        raise ValueError('A requested server has no archived observations')
    hashes = [source(p) for p in [args.scope, args.availability, *files]]
    args.database.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(args.database)) as con, con:
        con.executescript('''
            CREATE TABLE IF NOT EXISTS source_files(path TEXT PRIMARY KEY, sha256 TEXT);
            CREATE TABLE IF NOT EXISTS observations(server INTEGER, date TEXT, captured_at TEXT, source_path TEXT, kind TEXT, yuan REAL, raw_json TEXT);
            CREATE TABLE IF NOT EXISTS daily_selected(server INTEGER, date TEXT, captured_at TEXT, yuan REAL, orders INTEGER, buyers INTEGER, source_path TEXT, PRIMARY KEY(server,date));
            DELETE FROM source_files; DELETE FROM observations; DELETE FROM daily_selected;
        ''')
        con.executemany('INSERT INTO source_files VALUES(?,?)', [(x['path'],x['sha256']) for x in hashes])
        con.executemany('INSERT INTO observations VALUES(?,?,?,?,?,?,?)', [(o['value']['server'],o['value']['date'],o['value']['capturedAt'],o['value']['source'],o['kind'],o['value']['yuan'],json.dumps(o['raw'],ensure_ascii=False)) for o in observations])
        con.executemany('INSERT INTO daily_selected VALUES(?,?,?,?,?,?,?)', [(r['server'],r['date'],r['capturedAt'],r['yuan'],r.get('orders'),r.get('buyers'),r['source']) for r in daily])
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    report = {
        'id': scope['id'], 'title': scope['title'], 'from': min(r['date'] for r in daily), 'through': max(r['date'] for r in daily),
        'importedAt': now, 'servers': scope['servers'], 'daily': daily, 'inputFiles': len(files), 'emptyFiles': len(empty),
        'basis': 'GM 留存报表 OrderTotalAmount 原值，单位元；未取得逐笔订单，现金、代金券及滚服归属待核验，不能称为现金实收或净营收。',
        'coverage': '王者 S501—S508、魔灵 S11—S18。各服备份截止时间不同，不能作为测试全期，也不能直接与 10 月全期比较。',
        'limitations': [
            '按区服＋日期取捕获时间最新的一份，同一天的多次累计快照不相加。原快照和选择结果均保存于 SQLite。',
            '“当天快照”仅覆盖当天抓取时刻；“次日或以后回读”也不代表退款后最终结算。缺失日期不补零。',
            '最新日记录缺订单数时保留空值，不用更早快照的订单数搭配较新的金额。每日付费人数不能累加为区间去重人数。',
            '6 月商品配置版本及商品身份尚未核对，未把区服汇总分摊到当前 1.15.0 商品。',
        ],
        'gaps': [
            '商品级现金 / 代金券：缺 6 月旧服订单表（区服、订单ID、商品/充值档位ID、支付类型、状态、订单金额、支付时间、退款信息）及历史商品配置。',
            '钻石商品：缺旧服 action_id=71 操作日志或等价消费流水（日志ID、匿名角色、时间、礼包ID、实际扣除和奖励）；不能用充值金额反推。',
            '完整测试区间：缺各服停测前最后一次完整日报或全期订单导出；目前部分记录截止于 6 月 18 日，部分到 6 月 22 日凌晨。',
            '当前 GM 区服列表未提供这些旧服；2026-10-27 对 S501 的 6 月商品统计查询返回 HTTP 500，查询失败不代表销量为零。',
        ], 'sources': hashes, 'backup': source(args.database),
    }
    base = read(args.base_bundle)
    reports = {r['id']:r for r in base['evidence'].get('archives', [])}
    reports[report['id']] = report
    base['evidence']['archives'] = list(reports.values())
    base['evidence']['updated'] = now
    args.output.write_text(json.dumps(base,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    same_day = [r for r in daily if timestamp(r['capturedAt']).astimezone(dt.timezone(dt.timedelta(hours=8))).date().isoformat() == r['date']]
    audit = {'files':len(files),'emptyFiles':len(empty),'observations':len(observations),'selectedDays':len(daily),'partialDays':len(same_day),'yuan':sum(r['yuan'] for r in daily),'groups':{},'ordersFieldDays':sum('orders' in r for r in daily),'database':source(args.database)}
    for group in sorted({s['group'] for s in scope['servers']}):
        ids = {s['id'] for s in scope['servers'] if s['group'] == group}
        selected = [r for r in daily if r['server'] in ids]
        audit['groups'][group] = {'servers':len(ids),'days':len(selected),'yuan':sum(r['yuan'] for r in selected)}
    args.output.with_suffix('.audit.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(audit,ensure_ascii=False,indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    for name in ['directory','scope','availability','base-bundle','database','output']:
        parser.add_argument('--'+name,required=True,type=Path)
    build(parser.parse_args())
