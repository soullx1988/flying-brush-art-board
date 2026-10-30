import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('builder', Path(__file__).with_name('build-item-value-data.py'))
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class Completeness(unittest.TestCase):
    def build(self, drops, missions=()):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            data = {
                'tables_sysitems_tbitems.json': [dict(id=1, name='随机包', item_type=5, use_value=1, use_detail_value='10'), dict(id=2, name='货币'), dict(id=3, name='候选道具')],
                'tables_sysdrop_tbdrop.json': drops,
                'tables_sysbattles_tbbattlechaptermission.json': list(missions),
                'tables_sysfunction_tbfunctionlist.json': [],
                'tables_sysfunction_tbfunctionswitch.json': [],
                'tables_sysshop_tbshopexchange.json': [dict(type=6, line=[dict(item_id=603, cost=dict(id=2, num=1000))])],
            }
            for name, rows in data.items():
                (root / name).write_text(json.dumps(rows), encoding='utf8')
            products = [dict(key='exchange:6:603', status='defined', kind='resource', channel='资源兑换商店', rewards=[dict(id=1, name='随机包', n=1)])]
            snapshot = dict(store={'doc': dict(typeName='document', meta=dict(commerceOverview=dict(dataset=dict(products=products))))})
            (root / 'catalog.json').write_text(json.dumps(snapshot), encoding='utf8')
            return builder.build(root / 'catalog.json', root, 'board:source')

    def test_nested_pool_is_not_an_item_and_currency_is_not_a_reward(self):
        data = self.build([dict(id=10, sure_type=0, sure_drop_award=[], weight_type=2, weight_drop_award=[dict(id=11, num=1, weight=1)]), dict(id=11, sure_type=0, sure_drop_award=[], weight_type=1, weight_drop_award=[dict(id=3, num=1, weight=1)])])
        item = next(i for i in data['items'] if i['id'] == 1)
        self.assertEqual([(r['id'], r['kind']) for r in item['contents']], [(3, 'random')])
        self.assertNotIn(3, [i['id'] for i in data['items']])
        currency = next(i for i in data['items'] if i['id'] == 2)
        self.assertEqual(currency['exchangeUses'], ['exchange:6:603'])
        self.assertEqual(currency['stageId'], 'unknown')

    def test_sources_are_not_truncated_and_missing_pool_is_visible(self):
        missions = [dict(missionID=100001+n, missionLevel=n+1, missionName=f'第{n+1}关', reward1=[dict(id=1, num=1)]) for n in range(20)]
        item = next(i for i in self.build([], missions)['items'] if i['id'] == 1)
        self.assertEqual(len(item['placementSources']), 20)
        self.assertTrue(item['contentGaps'])

    def test_cycle_and_choice_are_not_reported_as_guaranteed(self):
        data = self.build([dict(id=10, sure_type=2, sure_drop_award=[dict(id=3, num=1)], weight_type=2, weight_drop_award=[dict(id=10, num=1, weight=1)])])
        item = next(i for i in data['items'] if i['id'] == 1)
        self.assertEqual(item['contents'][0]['kind'], 'choice')
        self.assertTrue(item['contentGaps'])


if __name__ == '__main__':
    unittest.main()
