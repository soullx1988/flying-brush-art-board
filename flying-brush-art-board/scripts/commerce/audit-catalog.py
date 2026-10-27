"""Read-only price/reward audit. Never treat a draft or an unbound Nacos namespace as live.

All catalog identities survive; missing references are filtered by the reader, not deleted.
Raw orders/role identifiers remain outside the imported evidence bundle.
"""
import argparse, collections, copy, datetime, hashlib, json, re, sqlite3
from pathlib import Path
import openpyxl


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))


def source(path):
    p=Path(path)
    return {'path':str(p.resolve()),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}


def rewards(raw, names):
    if isinstance(raw,str):
        raw=[dict(zip(('id','num'),map(int,p.split(',')))) for p in raw.split('|') if p]
    if isinstance(raw,dict): raw=[raw]
    total=collections.Counter()
    for x in raw or []: total[int(x['id'])]+=x['num']
    return [{'id':k,'name':names.get(k,f'道具{k}'),'n':n} for k,n in total.items()]


def signature(rs):
    return sorted((r['id'],r['n']) for r in rs)


def recorded(text, configured):
    names={x['name']:x for x in configured}
    if len(names)!=len({x['id'] for x in configured}): return None
    result=collections.Counter();text=text.strip()
    while text:
        candidates=[]
        for name,x in names.items():
            if text.startswith(name):
                m=re.match(r'[x×]\s*(\d+)(?=\D|$)',text[len(name):])
                if m: candidates.append((name,x,m))
        if len(candidates)!=1: return None
        name,x,m=candidates[0];result[x['id']]+=int(m[1])
        text=text[len(name)+m.end():].lstrip(' ,，;；、|\t\n')
    return sorted(result.items())


def resource_price(cost, names):
    return f"{cost['num']} {names[cost['id']]}"


def exchange_price(row,names):
    cost=row.get('cost')
    if not cost: return '免费领取'
    price=resource_price(cost,names)
    if row.get('discount_times',0)>0:
        discounted=cost['num']*row['discount']//100
        return f"前{row['discount_times']}次 {discounted}；之后 {price}"
    step=row.get('costPlus',[])
    if len(step)>=2 and step[0]>0 and step[1]>0:
        return f"起价 {price}；每购{step[0]}次加{step[1]}"
    return price


def pool_price(row,names):
    if row.get('free',0) or row.get('free_advertising',0):
        return f"免费{row.get('free',0)}次 / 广告{row.get('free_advertising',0)}次"
    cost=row.get('cost')
    if not cost: return '免费领取'
    options=row.get('random_discount',[])
    if options:
        prices=sorted({int(cost['num']*x['discount']/10000) if x['discount'] else cost['num'] for x in options if x.get('weight',0)>0})
        if prices: return f"{' / '.join(map(str,prices))} {names[cost['id']]}（随机折扣）"
    return resource_price(cost,names)


def run(a):
    before=read(a.dataset); data=copy.deepcopy(before); bundle=read(a.bundle)
    for s in data['sources'].values():
        if source(s['path'])['sha256']!=s['sha256']: raise ValueError('Source changed: '+s['path'])
    load=lambda name:read(data['sources'][name]['path'])
    names={x['id']:x['name'] for x in load('tables_sysitems_tbitems')}
    recharge={x['id']:x for x in load('tables_sysrecharge_tbrechargeconfig')}
    book=openpyxl.load_workbook(data['sources']['gift']['path'],read_only=True,data_only=True)
    rows=list(book['Sheet1'].values)
    gifts={r[1]:dict(zip(rows[0],r)) for r in rows[5:] if r[1] is not None and not str(r[0] or '').startswith('##')}
    expected={};period={0:'永久',1:'日',2:'周',3:'月',4:'竞技场赛季',5:'每期活动'}
    pools=load('tables_sysshop_tbshoppool'); exchanges=load('tables_sysshop_tbshopexchange')
    price_rules=collections.Counter()
    for g in pools:
        for x in g['line']:
            expected[f"shop:{g['id']}:{x['line_id']}"]={'price':pool_price(x,names),'rewards':rewards(x.get('award'),names)}
            if x.get('random_discount'): price_rules['random']+=1
    for g in exchanges:
        for x in g['line']:
            expected[f"exchange:{g['type']}:{x['item_id']}"]={'price':exchange_price(x,names),'rewards':rewards(x['award'],names),
                'limit':(f"{x['num']}次" if x['num'] else '不限次数')+' / '+period[x['reset']]}
            if not x.get('cost'): expected[f"exchange:{g['type']}:{x['item_id']}"]['kind']='free'
            if x.get('discount_times',0)>0:price_rules['discount']+=1
            if x.get('costPlus'):price_rules['step']+=1
    def cash_price(rid): return '¥'+str(recharge[rid]['price']) if rid in recharge else '现金价格待核验'
    for rid,x in gifts.items():
        kind=x['buyType'];price=cash_price(x['rechargeId']) if kind==1 else '观看广告' if kind==2 else '免费领取' if kind==3 else resource_price({'id':rewards(x['price'],names)[0]['id'],'num':rewards(x['price'],names)[0]['n']},names) if kind==4 else f"免费{x['free']}次 / 广告{max(0,x['costNum']-x['free'])}次" if kind==5 else None
        if price is None: raise ValueError('Unknown buy type')
        expected['gift:'+str(rid)]={'price':price,'rewards':rewards(x['rewards'],names),'extraRewards':rewards(x['firstRechargeAward'],names)}
        if kind==5: expected['gift:'+str(rid)]['kind']='mixed'
    for x in load('tables_sysrecharge_tbrechargemonthcard'):
        expected['month:'+str(x['id'])]={'price':cash_price(x['rechargeId']),'rewards':rewards(x['rewards'],names),'extraRewards':rewards(recharge[x['rechargeId']].get('rewards'),names)}
    first=load('tables_sysrecharge_tbrechargefirstpay')
    for rid in {x['rechargeId'] for x in first}:
        expected['first:'+str(rid)]={'price':cash_price(rid),'rewards':rewards([r for x in first if x['rechargeId']==rid for r in x['rewards']],names)}
    for x in load('tables_syspass_tbpass'):
        for field,rw in [('recharge_id','premium_reward'),('recharge_id2','super_reward')]:
            if x.get(field): expected[f"pass:{x['id']}:{field}"]={'price':cash_price(x[field]),'rewards':rewards([r for n in x['model'] for r in n.get(rw,[])],names)}
    for table,prefix,rw in [('tables_sysfund_tbfund','fund','premium_reward'),('tables_syssignin_tbweeklysignin','week','pay_reward')]:
        for x in load(table):expected[f"{prefix}:{x['id']}"]={'price':cash_price(x['recharge_id']),'rewards':rewards([r for n in x['model'] for r in n.get(rw,[])],names)}
    modifications=[]
    for p in data['products']:
        if p['status']!='defined': continue
        e=expected[p['key']]
        # Never silently replace rewards; record and apply only an exact source derivation.
        changed={k:{'before':p.get(k),'after':v} for k,v in e.items() if (signature(p.get(k,[]))!=signature(v) if k in ['rewards','extraRewards'] else p.get(k)!=v)}
        if changed:modifications.append({'key':p['key'],'fields':changed})
        p.update(e)
    assert len(expected)==sum(p['status']=='defined' for p in data['products'])
    products={p['key']:p for p in data['products']}
    # Preserve successful order type; vouchers remain separate from actual cash.
    db=sqlite3.connect(a.ledger.resolve().as_uri()+'?mode=ro',uri=True)
    money=collections.defaultdict(lambda:collections.Counter());order_counts=collections.Counter()
    for payload, in db.execute("select payload from ledger_evidence where kind='orders'"):
        x=json.loads(payload)
        if x['status']==1:
            money[x['rechargeItemId']][x['money']]+=1;order_counts[x['orderType']]+=1
    for rid,prices in money.items():
        if rid not in recharge or set(prices)!={recharge[rid]['price']}:raise ValueError('Order amount differs from recharge tier: '+str(rid))
    # Audit all saved action-71 rows, including free/ad claims, without adding them to revenue.
    observations=collections.defaultdict(lambda:{'orders':0,'rewards':collections.Counter(),'prices':collections.Counter(),'dates':set(),'servers':set()})
    claims=collections.defaultdict(lambda:{'orders':0,'rewards':set()})
    action_rows=0
    for path in sorted(a.actions.glob('gm-gift-actions-S*-private.json')):
        raw=read(path);rs=[r for t in raw['tables'] for r in t['rows']]
        if len(rs)!=int(re.fullmatch(r'共\s*(\d+)\s*条',raw['totalText'])[1]):raise ValueError('Incomplete action pages')
        for date,action,text in rs:
            if not '2026-10-13'<=date[:10]<='2026-10-26':continue
            if action!='购买礼包': raise ValueError('Action filter changed')
            sku=re.search(r'礼包ID:\s*(\d+)',text);rw=re.search(r'获得道具：(.*?)礼包ID:',text)
            if not sku:raise ValueError('Missing SKU')
            key='gift:'+sku[1];o=observations[key];o['orders']+=1;o['rewards'][rw[1].strip() if rw else '']+=1
            cost=re.search(r'消耗道具：(.*?)(?=获得道具：|礼包ID:)',text)
            o['prices'][cost[1].strip() if cost else '未记录扣除道具']+=1
            if not cost or not re.search(r'钻石x\d+',cost[1]):
                c=claims[(key,raw['server'],date[:10])];c['orders']+=1;c['rewards'].add(rw[1].strip() if rw else '')
            o['dates'].add(date[:10]);o['servers'].add(raw['server']);action_rows+=1
    checks={};reward_matches=[];reward_mismatches=[];partial=[];cash_checked=[]
    for key,p in products.items():
        if p['status']!='defined':continue
        missing=['测试服发布快照、配置版本与各服加载记录；本次未获得可绑定到测试服的生效配置。']
        price='按源文件与扣费代码重新核对；实际扣费待流水验证。'
        reward='按源文件重新汇总；实际发放明细未接入。'
        if p.get('rid') in money:
            prices=money[p['rid']];configured=recharge[p['rid']]['price'];same=set(prices)=={configured}
            price=f"S102—106 成功订单 {sum(prices.values())} 笔，金额档位 {' / '.join(map(str,sorted(prices)))} 元；"+('与配置价格相同。' if same else '与配置不同。')+'现金与代金券仍按原订单类型分账。'
            cash_checked.append(key)
            if not same:raise ValueError('Additional cash price conflict: '+key)
        o=observations.get(key)
        if o:
            parsed=[recorded(t,p['rewards']) for t in o['rewards']]
            complete=all(x is not None and {i for i,n in x}=={r['id'] for r in p['rewards']} for x in parsed)
            if complete:
                same=all(x==signature(p['rewards']) for x in parsed)
                (reward_matches if same else reward_mismatches).append(key)
                reward=f"S102—106，10/13—10/26 保存日志 {o['orders']} 笔；"+('普通奖励记录与配置一致。' if same else '实得数量与源表不同；详细差异保留。')
            else:
                partial.append(key);reward=f"{o['orders']} 笔领取记录存在，但日志中的奖励字段不足以核全。"
            if p['kind'] in ['free','ad','mixed']:missing.append('领取记录没有区分免费与观看广告；仍缺广告完成事件或请求参数。')
        paid_rows=[r for r in bundle['evidence']['ledger']['purchases'] if r['key']==key]
        if paid_rows:
            prices=sorted({v for r in paid_rows for v in r['prices']})
            price=f"S102—106，10/13—10/26 范围内 {sum(r['orders'] for r in paid_rows)} 笔带 SKU 的钻石购买；实际单价 {' / '.join(map(str,prices))} 钻石。"
        if not o:missing.append('缺少带商品身份的发奖明细；付费成功不能证明全部奖励已兑现。')
        if p['key'].startswith(('shop:','exchange:')):missing.append('实际商店候选、折扣或本周期购买次数，以及带商店类型／商品 ID 的扣费和发奖流水。')
        checks[key]={'price':price,'reward':reward,'missing':missing}
    local_published=read(a.nacos)
    published_differences=[]
    for x in local_published:
        p=products.get('gift:'+str(x['id']))
        if not p or signature(rewards(x['rewards'],names))!=signature(p['rewards']): published_differences.append(x['id'])
        if x['buyType']==4 and resource_price(x['price'],names)!=p['price']:published_differences.append(x['id'])
    if {x['id'] for x in local_published}!=set(gifts):raise ValueError('Nacos and workbook identities differ; inspect before importing')
    draft=data['evidence']['catalogReview']['draft']
    draft_differences=[key for key,p in products.items() if key in draft and (signature(draft[key]['rewards'])!=signature(p['rewards']) or draft[key]['price']!=p['price'])]
    findings={}
    price_differences=[]
    for key in {r['key'] for r in bundle['evidence']['ledger']['purchases']}:
        prices={x for r in bundle['evidence']['ledger']['purchases'] if r['key']==key for x in r['prices']}
        if len(prices)!=1 or str(next(iter(prices)))+' 钻石'!=products[key]['price']:price_differences.append(key)
    for key in sorted(set(reward_mismatches+price_differences)):
        p=products[key];o=observations[key]
        findings[key]={'label':'测试实得已明确，生效版本待核对',
            'detail':f"{o['orders']} 笔带礼包 ID 的日志，{min(o['dates'])}—{max(o['dates'])}，S"+'、S'.join(map(str,sorted(o['servers'])))+'。扣费记录：'+' / '.join(o['prices'])+'；奖励记录：'+' / '.join(t or '普通奖励字段为空' for t in o['rewards'])+'。与当前源表不同；SQL 草稿仅作对照，不据此确认全服已生效。',
            'missing':['本次测试环境 tables_sysrecharge_tbrechargegiftpack.json 的发布快照、namespace / group / 发布时间。','S102—106 在对应购买时间加载的配置版本／摘要及热更生效记录；不能用草稿覆盖源表并宣称冲突消失。'],
            'sources':['带 SKU 的购买日志备份','GM SQL 草稿 1_15_0_0','SVN r52160','本地配置环境 lucky/config.game.1_15_0_0（未绑定测试服）']}
    for key in partial:
        if key in findings:
            findings[key]['missing'].append('此商品还缺独立对象的原始发奖字段；不能把普通奖励空白当成未发奖。')
            continue
        o=observations[key];p=products[key]
        category='宝石 Diamond' if any('宝石' in r['name'] for r in p['rewards']) else '魔灵 MagicSpirit' if any('魔灵' in r['name'] for r in p['rewards']) else '武器 Weapon 与重复获得转碎片' if any('武器' in p['title'] for r in p['rewards']) else '英雄 Hero／随机奖励展开与重复获得转碎片'
        findings[key]={'label':'随机／独立对象奖励待核全','detail':f"{o['orders']} 笔带 SKU 的记录；日志普通道具摘要不能完整表示{category}。保留源表奖励，未把空白或碎片直接当成原奖励。",
            'missing':[f'需 action_log.content 原始 gain 中的 {category} 字段、掉落映射及实际落库记录。','如为重复获得转碎片，需购买前拥有状态及当时的转换配置。'],
            'sources':['带 SKU 的领取日志备份','GM request/common.go 仅保留普通 Item','游戏 ItemUseCase.AddItems 及对应对象发放流程']}
    findings['gift:9202']={'label':'日志漏掉宝石字段；实际到账仍待原始记录',
        'detail':'两笔：S104 10/26 21:20:34、S105 10/24 11:15:20，均扣 3980 钻石，普通道具记录为高阶锻造精髓×30、金币×20000。3205 是自动展开的随机传说宝石；游戏通过 Diamond 对象返回宝石，GM BagItemInfo 只定义 Item，读取时会丢弃 Diamond。已定位显示遗漏，仍不能据此断言这两笔宝石均已发放。',
        'missing':['上述两笔 action_log.content 原始 JSON 的 gain[].Diamond：DiamondId、DiamondCnfId、Effect，以及对应宝石落库记录。','如原始记录也没有 Diamond，继续核对掉落表 2005、发奖失败日志与事务结果。'],
        'sources':['items 3205：auto_use=1，展开掉落表 2005','游戏 item.go AddItems / diamond.go AddDiamond','GM request/common.go BagItemInfo 只有 Item','GM action_log.go 的普通道具格式化']}
    coverage=[{'label':'商品定义价格与奖励重算','count':len(expected),'detail':'逐项读取 11 份源文件，校验奖励数量、价格规则、首充／即时奖励；这不代表全服已投放。'},
        {'label':'商品成功订单金额已核','count':len(cash_checked),'detail':f"S102—106 的成功订单共 {sum(order_counts.values())} 笔，涉及 {len(money)} 个充值档位（其中 1 个仍未对应具体商品）；现金 {order_counts[1]} 笔、代金券 {order_counts[2]} 笔。金额档位一致不等于奖励已发放。"},
        {'label':'领取日志覆盖','count':len(observations),'detail':f"{action_rows} 条带 SKU 的 action 71；含免费／广告领取，不新增到现金或钻石营收。"},
        {'label':'普通奖励与源表相符','count':len(reward_matches),'detail':f"另有 {len(reward_mismatches)} 项奖励数量不同，{len(partial)} 项日志不足；价格差异单独核对。"},
        {'label':'价格展示修正','count':sum(1 for x in modifications if 'price' in x['fields']),'detail':f"{price_rules['discount']} 项分次折扣、{price_rules['step']} 项递增价格、{price_rules['random']} 项随机折扣，另修正免费／广告方式。"},
        {'label':'移出正常商品浏览','count':sum(p['status']!='defined' or p['kind']=='cash' and not p.get('rid') and not p['rewards'] for p in products.values()),'detail':'39 条旧引用、79 条未对应充值档位、2 条缺充值档位和奖励的空壳礼包。保留核查记录，不将无销量等同未生效。'}]
    gaps=[f'生产／测试内网 Nacos 读取未成功；本地可读 lucky 环境的 238 项中，另有 {len(set(published_differences))} 项魔灵冲刺奖励与源表不同（1201—1209）。尚未绑定到测试服，不能据此修改当前商品；需环境对应与发布记录。',
        f'77 条现金商品配置中 {len(cash_checked)} 项有成功订单价格证据；另外 {77-len(cash_checked)} 项无匹配成功订单，其中 3002、3204 是缺充值档位和奖励的空壳，已移出浏览。现金奖励仍缺充值回调发奖与分次领取日志。',
        '随机商店与资源兑换共 247 项：配置规则已重算，实际选池、折扣与兑换发奖日志尚未接入。',
        '这些结论覆盖已保存的 10/13—10/26 样本，不代表所有区服全量；6 月历史仍缺商品 ID 与订单类型，未套用 10 月商品数值。']
    serial_obs={k:{**o,'rewards':dict(o['rewards']),'prices':dict(o['prices']),'dates':sorted(o['dates']),'servers':sorted(o['servers'])} for k,o in observations.items()}
    report={'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'coverage':coverage,'modifications':modifications,'checks':checks,'findings':findings,'gaps':gaps,
        'observations':serial_obs,'cashPriceKeys':cash_checked,'rewardMatches':reward_matches,'rewardDifferences':reward_mismatches,'partialRewards':partial,
        'priceDifferences':price_differences,'draftDifferences':draft_differences,'unboundPublishedDifferences':sorted(set(published_differences)),'unboundPublishedSource':source(a.nacos),'sources':data['sources'],
        'hidden':[{'key':p['key'],'title':p['title'],'reason':p['status']} for p in products.values() if p['status']!='defined' or p['kind']=='cash' and not p.get('rid') and not p['rewards']]}
    a.report.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
    bundle['catalog']={'baseProducts':before['products'],'baseSources':{k:s['sha256'] for k,s in before['sources'].items()},'products':data['products'],'sources':data['sources'],'created':'2026-10-27',
        'scope':'1.15.0 全量商品定义已按源文件与扣费代码核对；价格补充折扣及递增规则。测试实得独立标注，仍缺绑定测试服的发布快照与加载记录。'}
    review=copy.deepcopy(data['evidence']['catalogReview'])
    review['audit']={'source':source(a.report),'coverage':coverage,'findings':findings,'checks':checks,'gaps':gaps,
        'claims':[{'key':key,'server':server,'date':date,'orders':o['orders'],'rewards':sorted(o['rewards'])} for (key,server,date),o in sorted(claims.items())]}
    review['notes']=['配置定义、测试流水与编辑草稿分别保留；没有凭未购买判断商品未生效。','所有数值修正来自重新读取源文件或工程语义；未修改游戏配置，未发布 Nacos。']
    completed_ledger=bundle['evidence']['ledger']
    assert completed_ledger['payments']==before['evidence']['ledger']['payments']
    bundle['evidence']=copy.deepcopy(data['evidence']);bundle['evidence']['ledger']=completed_ledger;bundle['evidence']['catalogReview']=review;bundle['evidence']['updated']=report['checkedAt']
    a.output.write_text(json.dumps(bundle,ensure_ascii=False,separators=(',',':')),encoding='utf8')
    print(json.dumps({'coverage':coverage,'changed':len(modifications),'rewardDifferences':reward_mismatches,'partial':partial,'draftDifferences':draft_differences},ensure_ascii=False))


if __name__=='__main__':
    p=argparse.ArgumentParser()
    for name in ['dataset','bundle','ledger','actions','nacos','report','output']:p.add_argument('--'+name,type=Path,required=True)
    run(p.parse_args())
