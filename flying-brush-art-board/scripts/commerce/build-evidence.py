"""Read game assets and an exported order snapshot; produce a board import bundle.

No game config or production database writes. Images remain original files. The
board receives aggregate history only; order-level evidence stays in local SQLite.
"""
import argparse
import base64
import collections
import datetime as dt
import hashlib
import json
import pathlib
import plistlib
import re
import sqlite3
import struct


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def aggregate_orders(raw, products, database, source_hash):
    columns = raw['columns']
    required = {'id', 'money', 'status', 'orderType', 'rechargeItemId', 'dateline'}
    if not required.issubset(columns) or not raw.get('complete'):
        raise ValueError('订单来源字段或完整性声明不满足要求')
    rows = {}
    for player in raw['players']:
        if player['total'] != len(player['rows']):
            raise ValueError('玩家订单分页未收齐')
        role = hashlib.sha256(f"{player['server']}:{player['role']}".encode()).hexdigest()
        for line in player['rows']:
            order = dict(zip(columns, line))
            if len(line) != len(columns):
                raise ValueError('订单字段数量不一致')
            key = (int(player['server']), str(order['id']))
            value = (source_hash, *key, role, int(order['money']), int(order['status']), int(order['orderType']), int(order['rechargeItemId']), int(order['dateline']))
            if key in rows and rows[key] != value:
                raise ValueError('同一订单存在冲突快照')
            if value[4] < 0:
                raise ValueError('订单金额为负')
            rows[key] = value
    con = sqlite3.connect(database)
    con.execute('CREATE TABLE IF NOT EXISTS orders (source_sha TEXT, server INTEGER, order_id TEXT, role_key TEXT, money INTEGER, status INTEGER, order_type INTEGER, recharge_id INTEGER, created_at INTEGER, PRIMARY KEY(source_sha,server,order_id))')
    with con:
        con.execute('DELETE FROM orders WHERE source_sha=?', (source_hash,))
        con.executemany('INSERT INTO orders VALUES (?,?,?,?,?,?,?,?,?)', rows.values())
    query = 'SELECT server,role_key,money,status,order_type,recharge_id,created_at FROM orders WHERE source_sha=?'
    orders = [dict(zip(['server','role','money','status','type','rid','time'], r)) for r in con.execute(query, (source_hash,))]
    con.close()
    current = collections.defaultdict(list)
    for p in products:
        if p.get('rid'):
            current[int(p['rid'])].append(p['key'])
    cash = [o for o in orders if o['status'] == 1 and o['type'] == 1]
    by_product, unresolved = {}, []
    for rid in sorted({o['rid'] for o in cash}):
        selected = [o for o in cash if o['rid'] == rid]
        if len(current[rid]) != 1:
            unresolved.append({'rechargeId':rid,'reason':'当前商品对应缺失或不唯一','orders':len(selected)})
            continue
        by_day = collections.defaultdict(list)
        for order in selected:
            date = dt.datetime.fromtimestamp(order['time'], dt.timezone(dt.timedelta(hours=8))).strftime('%Y-%m-%d')
            by_day[(date, order['server'])].append(order)
        daily = [{'date':date,'server':server,'orders':len(group),'buyers':len({o['role'] for o in group}),'yuan':sum(o['money'] for o in group)} for (date,server),group in sorted(by_day.items())]
        by_product[current[rid][0]] = {
            'rechargeId':rid,'orders':len(selected),'buyers':len({o['role'] for o in selected}),
            'yuan':sum(o['money'] for o in selected),'prices':sorted({o['money'] for o in selected}),
            'failedOrPending':sum(o['rid']==rid and o['status']!=1 for o in orders),
            'voucherOrders':sum(o['rid']==rid and o['status']==1 and o['type']==2 for o in orders),
            'firstDate':daily[0]['date'],'lastDate':daily[-1]['date'],'daily':daily,
        }
    return {'records':len(orders),'successCashOrders':len(cash),'successCashYuan':sum(o['money'] for o in cash),
            'failedOrPending':sum(o['status']!=1 for o in orders),'voucherOrders':sum(o['status']==1 and o['type']==2 for o in orders),
            'byProduct':by_product,'unresolved':unresolved}


def item_icons(client, used):
    """Resolve both rewarded items and spent currencies from the same game art."""
    assets, files, icons = {}, {}, {}
    def asset(path):
        b = path.read_bytes()
        if not b.startswith(b'\x89PNG\r\n\x1a\n'):
            raise ValueError(f'当前只收录原始 PNG: {path}')
        w,h = struct.unpack('>II', b[16:24]); sha = hashlib.sha256(b).hexdigest()
        assets[sha] = {'name':path.name,'path':str(path),'sha256':sha,'mime':'image/png','width':w,'height':h}
        files[sha] = base64.b64encode(b).decode()
        return sha
    item_root = client/'Lucky/assets/AssetsPackage/GUI/Res/Item'
    atlases = []
    for name in ['item','item_fashion']:
        p=item_root/(name+'.plist')
        atlases.append((p,plistlib.loads(p.read_bytes())['frames']))
    items={x['id']:x for x in read(client/'Lucky/assets/AssetsPackage/Datas/tables_sysitems_tbitems.json')}
    fashion_path=client/'Lucky/assets/AssetsPackage/Datas/tables_sysplayer_tbplayerfashion.json'
    fashions={x['id']:x for x in read(fashion_path)} if fashion_path.exists() else {}
    for item_id in sorted(used):
        icon=items.get(item_id,{}).get('icon') or fashions.get(item_id,{}).get('icon','')
        if not icon:
            continue
        matched=False
        for path,frames in atlases:
            frame=frames.get(f'item_{icon}.png')
            if not frame:
                continue
            x,y,w,h=map(int,re.findall(r'-?\d+',frame['frame']))
            icons[str(item_id)]={'asset':asset(path.with_suffix('.png')),'x':x,'y':y,'w':w,'h':h,'rotated':frame['rotated']}
            matched=True
            break
        if not matched:
            p=item_root/'item_scattered'/f'item_{icon}.png'
            if not p.is_file():
                p=client/'fgui/LuckFGUI/LuckFGUI/assets/Item/img'/f'item_{icon}.png'
            if p.is_file():
                sha=asset(p);info=assets[sha]
                icons[str(item_id)]={'asset':sha,'x':0,'y':0,'w':info['width'],'h':info['height'],'rotated':False}
    return assets, files, icons


def build(args):
    data, raw = read(args.dataset), read(args.orders)
    for value in data['sources'].values():
        if digest(pathlib.Path(value['path'])) != value['sha256']:
            raise ValueError(f"商品来源已变化，请先更新商品快照：{value['path']}")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    used={a['id'] for p in data['products'] for a in p['rewards']+p.get('extraRewards',[])}
    exchanges=read(args.client/'Lucky/assets/AssetsPackage/Datas/tables_sysshop_tbshopexchange.json')
    used.update(r['cost']['id'] for group in exchanges for r in group['line'] if r.get('cost'))
    used.update([300001,300003,300004])
    # A routine image refresh must also refresh previously linked container contents.
    used.update(map(int, data.get('evidence', {}).get('icons', {})))
    assets, files, icons = item_icons(args.client, used)
    def asset(path):
        b=path.read_bytes()
        if not b.startswith(b'\x89PNG\r\n\x1a\n'):
            raise ValueError(f'当前只收录原始 PNG: {path}')
        sha=hashlib.sha256(b).hexdigest(); w,h=struct.unpack('>II',b[16:24])
        assets[sha]={'name':path.name,'path':str(path),'sha256':sha,'mime':'image/png','width':w,'height':h}
        files[sha]=base64.b64encode(b).decode()
        return sha
    placements={}
    for channel in ['日礼包','周礼包','月礼包','钻石充值','金币礼包','每日随机商店']:
        placements[channel]={'path':f'商城 → {channel}','evidence':'工程商城模块与礼包分类；实际开放还受功能与服务器配置影响。'}
    screenshot=args.client/'Lucky/项目文档/通用组件/其他复杂按钮/1-每日特惠界面.png'
    placements['每日特惠礼包']={'path':'每日特惠活动 → 礼包区 / 一键全购','evidence':'本地每日特惠界面文档与礼包 clazz=11。','reference':asset(screenshot),'referenceLabel':'工程界面参考（有占位数值）；拍摄日期未记录，不代表当前实机价格。'}
    history=aggregate_orders(raw,data['products'],args.database,digest(args.orders))
    servers=sorted({p['server'] for p in raw['players']})
    history.update({'source':{'path':str(args.orders),'sha256':digest(args.orders)},'readAt':raw['readAt'],
      'population':f"S{'、S'.join(map(str,servers))} 已导出的 {len(raw['players'])} 个角色；仅代表这批备份，不声称全服完整覆盖。",
      'timeBasis':'按订单创建时间 dateline（北京时间）归日；备份未含实际支付时间 pay_time。',
      'versionNote':'按充值档位 ID 唯一对应当前商品；历史版本、奖励内容和渠道结算未复核。',
      'limitations':['仅 status=1 且 orderType=1 计入成功现金订单；代币订单单列。','金额取订单 money 字段，非渠道结算净收入，未扣退款。','人数按区服＋角色去重，不声称跨角色账号去重；每日人数不能相加。','备份未含曝光与完整退款数据，不能计算购买转化率或退款后净收入。','钻石、广告、免费领取与资源兑换需要各自业务流水，不能用充值订单替代。']})
    evidence={'updated':dt.datetime.now(dt.timezone.utc).isoformat(),'sourceHashes':{k:v['sha256'] for k,v in data['sources'].items()},'assets':assets,'icons':icons,'placements':placements,'history':history}
    bundle={'format':'infinite-board-commerce-evidence','version':1,'evidence':evidence,'files':files}
    args.output.write_text(json.dumps(bundle,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    audit={'icons':len(icons),'rewardIds':len(used),'missingIcons':sorted(used-set(map(int,icons))), 'imageFiles':len(assets), 'historyProducts':len(history['byProduct']), 'records':history['records'],'successCashOrders':history['successCashOrders'],'successCashYuan':history['successCashYuan'],'failedOrPending':history['failedOrPending'],'voucherOrders':history['voucherOrders'],'unresolved':history['unresolved'],'sourceSha256':history['source']['sha256']}
    args.output.with_suffix('.audit.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(audit,ensure_ascii=False))


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    for name in ['dataset','orders','client','output','database']:
        parser.add_argument('--'+name,type=pathlib.Path,required=True)
    build(parser.parse_args())
