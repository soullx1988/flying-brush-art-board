import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('audit',Path(__file__).with_name('audit-catalog.py'))
audit=importlib.util.module_from_spec(spec);spec.loader.exec_module(audit)

class CatalogAuditTests(unittest.TestCase):
    def test_discount_and_step_are_distinct_price_rules(self):
        names={1:'积分'}
        self.assertEqual(audit.exchange_price({'cost':{'id':1,'num':600},'discount_times':3,'discount':50},names),'前3次 300；之后 600 积分')
        self.assertEqual(audit.exchange_price({'cost':{'id':1,'num':200000},'costPlus':[5,320000]},names),'起价 200000 积分；每购5次加320000')
        self.assertEqual(audit.exchange_price({},names),'免费领取')

    def test_random_prices_are_not_presented_as_one_fixed_price(self):
        row={'cost':{'id':1,'num':150},'random_discount':[{'discount':8000,'weight':500},{'discount':10000,'weight':1000},{'discount':100,'weight':0}]}
        self.assertEqual(audit.pool_price(row,{1:'钻石'}),'120 / 150 钻石（随机折扣）')

    def test_partial_and_ambiguous_rewards_are_not_invented(self):
        rs=[{'id':1,'name':'宝石','n':1},{'id':2,'name':'金币','n':20000}]
        self.assertEqual(audit.recorded('金币x20000',rs),[(2,20000)])
        self.assertNotEqual(audit.recorded('金币x20000',rs),audit.signature(rs))
        self.assertIsNone(audit.recorded('金币x2.5',rs))

if __name__=='__main__':unittest.main()
