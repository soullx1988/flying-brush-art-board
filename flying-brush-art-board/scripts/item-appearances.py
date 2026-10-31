"""Appearance identities come from active game configs, not the shop reward list.

Consumable/unlocked aliases share one entry; default/hidden skins are excluded.
No price is inferred from rarity, unlock cost, duration or event weights.
"""


def appearances(items, fashions, skins):
    result = {}
    for f in fashions:
        kind = {1: '头像框', 2: '聊天框', 4: '称号'}.get(f['type'])
        if f.get('unlock') or not kind:
            continue
        aliases = sorted(i['id'] for i in items.values() if i.get('item_type') in (13, 21) and str(i.get('use_detail_value')) == str(f['id']))
        consumables = [i for i in aliases if items[i].get('item_type') == 13]
        # A fashion with no inventory item keeps its fashion identity explicitly.
        item_id = (consumables or aliases or [f['id']])[0]
        days = f.get('expireTime', 0)
        result[item_id] = dict(configId=f['id'], kind=kind, name=f['name'], itemIds=aliases,
            duration=f'{days} 天' if days else '永久', source=f.get('source', ''),
            hasAttributes=bool(f.get('attrs')), attributes=f.get('attrs', []),
            description=f"{kind}；{'有效期 ' + str(days) + ' 天' if days else '永久有效'}。" + ('含属性加成。' if f.get('attrs') else '') + f.get('source', ''),
            configSource=f"tables_sysplayer_tbplayerfashion.json / {f['id']}")
    for s in skins:
        if not s.get('unlockType') or s.get('noShow') or s['type'] not in (1, 2, 3):
            continue
        expected_type = {1: 15, 2: 26, 3: 27}[s['type']]
        # Unlock costs choose the current token, never obsolete aliases sharing refID.
        costs = {r['id'] for level in s.get('rank', []) for r in level.get('unlockCost', [])}
        matches = [i for i in items.values() if i.get('item_type') == expected_type and i.get('refID') == s['id'] and not i.get('hideInBag') and (i['id'] in costs or s['type'] == 1)]
        if len(matches) != 1:
            continue
        item = matches[0]
        kind = {1: '英雄皮肤', 2: '皮肤', 3: '武器皮肤'}[s['type']]
        has_attributes = any(r.get('attr') or r.get('skill') for r in s.get('rank', []))
        result[item['id']] = dict(configId=s['id'], kind=kind, name=s['name'] if s['type'] == 1 else item['name'], itemIds=[item['id']],
            duration='永久，可升星', source='', hasAttributes=has_attributes,
            attributes=[], description=(item.get('desc') or s['name']) + ('；含属性或技能加成，效果随星级变化。' if has_attributes else '；具体加成需结合角色配置核验。'),
            configSource=f"tables_sysheros_tbheroskins.json / {s['id']}")
    return result


def reward_references(rows, wanted):
    """Only count reward-shaped objects under explicit grant fields, not numeric ID collisions."""
    grant_fields = {'reward', 'rewards', 'drop', 'award', 'awards'}
    def walk(value, path='', granting=False):
        if isinstance(value, list):
            for n, v in enumerate(value):
                yield from walk(v, f'{path}[{n}]', granting)
        elif isinstance(value, dict):
            if granting and value.get('id') in wanted and value.get('num', 0) > 0:
                yield value['id'], path
            for key, v in value.items():
                yield from walk(v, f'{path}.{key}', granting or key in grant_fields)
    return list(walk(rows))
