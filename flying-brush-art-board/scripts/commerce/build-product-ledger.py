"""Attach typed payments and SKU-bearing GM action evidence to the existing board.

Read only. Inputs stay local; only aggregates enter the board. Never infer SKU
from cost/rewards, and never combine role samples with the full GM revenue sum.
"""
import argparse
import collections
import datetime as dt
import hashlib
import json
from pathlib import Path
import re
import sqlite3
from contextlib import closing


def read(p):
    return json.loads(p.read_text(encoding='utf-8-sig'))


def source(p):
    return {'path': str(p.resolve()), 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()}


def role_key(server, role):
    return hashlib.sha256(f'{server}:{role}'.encode()).hexdigest()


def orders(raw):
    fields = {'id', 'money', 'status', 'orderType', 'rechargeItemId', 'dateline'}
    if not raw.get('complete') or not fields.issubset(raw['columns']):
        raise ValueError('订单字段或完整性声明缺失')
    result = {}
    for player in raw['players']:
        if player['total'] != len(player['rows']):
            raise ValueError('订单分页不完整')
        for values in player['rows']:
            if len(values) != len(raw['columns']):
                raise ValueError('订单列数不符')
            r = dict(zip(raw['columns'], values))
            if not isinstance(r['money'], int) or r['money'] < 0:
                raise ValueError('金额必须为非负整数元')
            r.update(server=player['server'], role=role_key(player['server'], player['role']))
            key = (r['server'], str(r['id']))
            if key in result and result[key] != r:
                raise ValueError('同一订单快照冲突')
            result[key] = r
    return list(result.values())


def gift_actions(raw, start, through):
    rows = [r for t in raw['tables'] for r in t['rows']]
    total = int(re.fullmatch(r'共\s*(\d+)\s*条', raw['totalText']).group(1))
    if total != len(rows):
        raise ValueError('操作日志未读完分页')
    result = []
    for index, row in enumerate(rows):
        date, action, text = row
        if action != '购买礼包':
            raise ValueError('操作筛选不符')
        if not start <= date[:10] <= through:
            continue
        cost = re.search(r'消耗道具：(.*?)(?=获得道具：|礼包ID:)', text)
        diamond = re.search(r'钻石x(\d+)', cost.group(1)) if cost else None
        if not diamond:
            continue
        gift = re.search(r'礼包ID:\s*(\d+)', text)
        reward = re.search(r'获得道具：(.*?)礼包ID:', text)
        if not gift:
            raise ValueError('钻石流水缺少商品身份')
        result.append({'server': raw['server'], 'role': role_key(raw['server'], raw['roleId']),
            'sourceRow': index, 'time': date, 'giftId': int(gift.group(1)), 'diamonds': int(diamond.group(1)),
            # GM drops non-Item fields (e.g. Diamond/MagicSpirit). Keep the debit,
            # but an empty rendered reward is explicitly incomplete evidence.
            'reward': reward.group(1).strip() if reward else '', 'original': text})
    return result


def unidentified(raw):
    unique = {}
    for entry in raw:
        j, row = entry['job'], entry['row']
        if row['action'] != 71:
            continue
        value = {k: row[k] for k in ['cost', 'gain', 't']}
        value.update(server=j['server'], role=role_key(j['server'], j['roleId']))
        key = (j['server'], str(row['id']))
        if key in unique and unique[key] != value:
            raise ValueError('同一道具流水有冲突')
        unique[key] = value
    rows = [dict(r, logId=k[1]) for k,r in unique.items() if any(x[0] == 300003 for x in r['cost'])]
    return rows


def build(a):
    data, base, raw = read(a.dataset), read(a.base_bundle), read(a.orders)
    if {k:v['sha256'] for k,v in data['sources'].items()} != base['evidence']['sourceHashes']:
        raise ValueError('来源版本不一致')
    for s in data['sources'].values():
        if source(Path(s['path']))['sha256'] != s['sha256']:
            raise ValueError('商品来源已经改变')
    os = orders(raw)
    ids = collections.defaultdict(list)
    for p in data['products']:
        if p.get('rid'):
            ids[p['rid']].append(p['key'])
    grouped = collections.defaultdict(list)
    for r in os:
        if len(ids[r['rechargeItemId']]) != 1:
            raise ValueError('充值商品映射不唯一')
        grouped[(r['server'], r['rechargeItemId'])].append(r)
    payments = []
    for (server, rid), rows in sorted(grouped.items()):
        cash = [r for r in rows if r['status'] == 1 and r['orderType'] == 1]
        vouchers = [r for r in rows if r['status'] == 1 and r['orderType'] == 2]
        if any(r['status'] == 1 and r['orderType'] not in [1, 2] for r in rows):
            raise ValueError('未知成功支付类型')
        payments.append({'key': ids[rid][0], 'rechargeId': rid, 'server': server,
            'cashOrders': len(cash), 'cashYuan': sum(r['money'] for r in cash), 'cashBuyers': len({r['role'] for r in cash}),
            'voucherOrders': len(vouchers), 'voucherOrderYuan': sum(r['money'] for r in vouchers), 'voucherBuyers': len({r['role'] for r in vouchers}),
            'unsuccessful': sum(r['status'] != 1 for r in rows)})
    start, through = base['evidence']['revenue']['from'], base['evidence']['revenue']['through']
    files = sorted(a.directory.glob('gm-gift-actions-S*-private.json'))
    state_file = a.directory/'collection-state-private.json'
    if state_file.exists():
        state = read(state_file)
        if state['completed'] != state['total'] or state['errors'] or len(files) != state['total']:
            raise ValueError('操作日志名单尚未读完')
    actions = [read(p) for p in files]
    if len({(x['server'], x['roleId']) for x in actions}) != len(actions):
        raise ValueError('同一角色重复采集，不能相加')
    gs = [r for x in actions for r in gift_actions(x, start, through)]
    grouped = collections.defaultdict(list)
    product_keys = {p['key'] for p in data['products']}
    for r in gs:
        if f"gift:{r['giftId']}" not in product_keys:
            raise ValueError(f"缺少礼包映射：{r['giftId']}")
        grouped[(r['server'], r['giftId'], r['time'][:10])].append(r)
    purchases = []
    for (server, gift, date), rows in sorted(grouped.items()):
        purchases.append({'key': f'gift:{gift}', 'giftId': gift, 'server': server, 'date': date,
            'orders': len(rows), 'buyers': len({r['role'] for r in rows}), 'diamonds': sum(r['diamonds'] for r in rows),
            'prices': sorted({r['diamonds'] for r in rows}), 'rewards': sorted({r['reward'] for r in rows})})
    unknown = unidentified(read(a.props_extract))
    candidate = sum(r['cost'] and sorted((x[0],x[1]) for x in r['cost']) == [(300003,480)] and sorted((x[0],x[1]) for x in r['gain']) == [(300004,20)] for r in unknown)
    source_files = [a.orders,a.props_extract,*files]
    manifest = a.props_extract.with_suffix('.manifest.json')
    if manifest.exists():
        source_files.append(manifest)
    order_manifest = a.orders.with_suffix('.manifest.json')
    if order_manifest.exists():
        source_files.append(order_manifest)
    a.database.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(a.database)) as con, con:
        con.execute('CREATE TABLE IF NOT EXISTS ledger_evidence (kind TEXT, ordinal INTEGER, payload TEXT, PRIMARY KEY(kind,ordinal))')
        con.execute('DELETE FROM ledger_evidence')
        for kind, rows in [('orders', os), ('identified_diamond_actions', gs), ('unidentified_diamond_props', unknown)]:
            con.executemany('INSERT INTO ledger_evidence VALUES (?,?,?)', [(kind,i,json.dumps(r,ensure_ascii=False)) for i,r in enumerate(rows)])
        con.execute('CREATE TABLE IF NOT EXISTS ledger_sources (path TEXT PRIMARY KEY, sha256 TEXT)')
        con.execute('DELETE FROM ledger_sources')
        con.executemany('INSERT INTO ledger_sources VALUES (?,?)', [(x['path'],x['sha256']) for x in map(source,source_files)])
    dates = sorted(dt.datetime.fromtimestamp(r['dateline'], dt.timezone(dt.timedelta(hours=8))).strftime('%Y-%m-%d') for r in os)
    audit = {}
    for p in data['products']:
        if p['channel'] == '通关礼包':
            audit[p['key']] = {'label':'配置存在 · 测试开放待核验',
                'detail':'这是配表里的“通关礼包”，工程入口叫“商城 → 关卡礼包”，由功能开关和主线进度控制。本次测试是否开放尚未证实，不能当作已投放商品。',
                'sources':['recharge_gift_pack.xlsx · class=9 · 商品 '+p['sku'], '客户端 FShopGkLb.ts · InitView / FunctionId.GKLB；招募入口 FUIRecruitEntrance.ts', '服务端 rechargeGiftPack.go · GetRechargeGiftPackClassInfo / 主线条件购买校验']}
    order_servers = sorted({p['server'] for p in raw['players']})
    order_scope = {'label':f"S{order_servers[0]}—S{order_servers[-1]} · {len(raw['players'])} 个已知角色 · {dates[0][5:]}—{dates[-1][5:]}（订单创建日）", 'from':dates[0], 'through':dates[-1], 'readAt':raw['readAt'], 'roles':len(raw['players']), 'servers':order_servers,
        'limitations':['成功现金：status=1 且 orderType=1；代金券：status=1 且 orderType=2。失败与待支付排除。', '金额取订单 money；代金券对应订单金额不是现金，也不代表实际扣券张数 / 面额。', '名单来自首周活跃与卡点角色备份，并非全服名册；全期 16 服商品统计未全部拆分，样本不外推、不与全期相加。', '按创建时间归日；缺 pay_time、券使用明细、退款状态和渠道结算，不能算退款后净营收。']}
    gift_scope = {'label':f"S102—S106 · {len(actions)} 个已知礼包消费角色 · {start[5:]}—{through[5:]}查询范围", 'from':start, 'through':through, 'readAt':max(x['readAt'] for x in actions), 'roles':len(actions), 'servers':sorted({x['server'] for x in actions}),
        'limitations':['逐角色完整读取“购买礼包”操作日志，以礼包 ID 关联；扣点、奖励取日志原值。', '名单来自 10/15—21 备份中存在礼包钻石消费的角色，不是随机样本；缺后续新增角色及其他区服，不能估算全服购买率或销量。', '与旧道具流水重叠，独立保存，不相加。需要全期全服 action_id=71 的带商品 ID 明细才能补全。']}
    selected_gm = [s for s in base['evidence']['revenue']['servers'] if s['id'] in order_servers]
    cash_gap = sum(s['cashYuan'] for s in selected_gm)-sum(r['cashYuan'] for r in payments)
    order_gap = sum(s['cashOrders'] for s in selected_gm)-sum(r['cashOrders'] for r in payments)
    ledger = {'orderScope':order_scope, 'giftScope':gift_scope, 'payments':payments, 'purchases':purchases,
        'unidentified': {'label':'S102—S106 · 10/15—21 已收集角色的礼包道具流水（商品 ID 缺失）', 'rows':len(unknown), 'diamonds':sum(c[1] for r in unknown for c in r['cost'] if c[0]==300003), 'dailyRecruitCandidates':candidate,
            'limitations':['action=71；以区服+日志 ID 去重；未凭价格或奖励把记录分摊给商品。','缺礼包 ID，且备份早于测试结束；不代表测试全期。']},
        'audits':audit, 'sources':[source(p) for p in source_files], 'backup':source(a.database),
        'gaps':[f'全期商品现金 / 代金券拆分：已补查 S102—S106 的 {len(raw["players"])} 个已知角色；与同 5 服经营日报相比，现金相差 {cash_gap} 元 / {order_gap} 笔，尚未逐单解释。其他 11 服未拆分；需完整角色名册或按区服导出的全期订单（id、recharge_item_id、order_type、status、money、支付时间）。不能把汇总差额分摊到商品。',
                f'完整钻石商品销量：本轮补查 S102—S106 的 {len(actions)} 个已知消费角色；仍缺其他 11 服和后续新增角色。需全期 action_id=71 的日志 ID、区服、匿名角色、时间、GiftPackId、cost、gain；后台展示接口未返回日志 ID，不能跨批按时间直接去重。',
                '通关礼包：需本次测试 GKLB 开放状态、服务端实际返回的 class=9 商品清单或实机证据。工程有入口不等于本轮已开放。',
                '设计达标：仍缺曝光、需求阶段、购买后使用与战斗表现，以及负责人确认的成功目标。']}
    base['evidence']['ledger'] = ledger
    base['evidence']['updated'] = dt.datetime.now(dt.timezone.utc).isoformat()
    base['evidence']['placements']['通关礼包'] = {'path':'商城 → 关卡礼包（配置分类名：通关礼包）','evidence':'工程有界面和主线条件校验；受功能开关控制。本次测试开放状态待核验。'}
    a.output.write_text(json.dumps(base,ensure_ascii=False,separators=(',',':')),encoding='utf8')
    summary = {'orders':len(os),'cashOrders':sum(x['cashOrders'] for x in payments),'cashYuan':sum(x['cashYuan'] for x in payments),'voucherOrders':sum(x['voucherOrders'] for x in payments),'voucherOrderYuan':sum(x['voucherOrderYuan'] for x in payments),'giftOrders':len(gs),'giftDiamonds':sum(x['diamonds'] for x in gs),'giftProducts':len({x['giftId'] for x in gs}),'recruit204Orders':sum(x['giftId']==204 for x in gs),'unidentified':ledger['unidentified'],'orderScope':order_scope['label'],'giftScope':gift_scope['label']}
    a.output.with_suffix('.audit.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps(summary,ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    for n in ['dataset','base-bundle','orders','directory','props-extract','database','output']:
        parser.add_argument('--'+n,type=Path,required=True)
    build(parser.parse_args())
