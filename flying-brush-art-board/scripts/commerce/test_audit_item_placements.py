import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('placements', Path(__file__).with_name('audit-item-placements.py'))
placements = importlib.util.module_from_spec(spec)
spec.loader.exec_module(placements)


class ItemPlacementTests(unittest.TestCase):
    def test_ui_names_override_old_enum_aliases_without_guessing_other_shops(self):
        database = 'export enum ShopExchangeType { /** 别名: 旧名\n */ StellarShop = 6, /** 别名: 活动商店\n */ EventShop = 8, }'
        ui = 'const RECRUIT_ALL_SHOP_TAB_CONFIGS: X[] = [{ title: "星辰商店", exchangeShopType: Shop.ShopExchangeType.StellarShop }];'
        names = placements.exchange_names(database, ui)
        self.assertEqual(names[6]['name'], '星辰商店')
        self.assertTrue(names[6]['ui'])
        self.assertEqual(names[8]['name'], '活动商店')
        self.assertFalse(names[8]['ui'])

    def test_checks_all_definitions_extra_rewards_and_map_coverage(self):
        reward = {'id': 1, 'n': 1, 'name': '道具'}
        p = {'key': 'exchange:6:603', 'status': 'defined', 'kind': 'resource', 'rewards': [reward], 'extraRewards': [{**reward, 'id': 2}]}
        data = {'products': [p, {**p, 'key': 'legacy', 'status': 'missing'}]}
        result = placements.audit_links(data, {'items': [{'id': 1, 'name': '道具'}, {'id': 3, 'name': '货币'}]}, {p['key']: {'rewards': [reward]}})
        self.assertEqual(result['links'], 2)
        self.assertEqual(result['unmappedRewardIds'], [2])
        self.assertEqual(result['withoutDirectProductReward'], [{'id': 3, 'name': '货币'}])
        self.assertEqual(result['missingProducts'], [])
        self.assertEqual(result['extraProducts'], [])


if __name__ == '__main__':
    unittest.main()
