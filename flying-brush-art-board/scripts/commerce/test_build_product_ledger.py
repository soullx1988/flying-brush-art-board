import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('ledger',Path(__file__).with_name('build-product-ledger.py'))
ledger=importlib.util.module_from_spec(spec);spec.loader.exec_module(ledger)

class ProductLedgerTests(unittest.TestCase):
    def test_order_identity_and_pagination(self):
        d={'complete':True,'columns':['id','money','status','orderType','rechargeItemId','dateline'],'players':[{'server':102,'role':'a','total':2,'rows':[[1,18,1,1,8,1792421657],[2,18,1,2,8,1792421658]]}]}
        rows=ledger.orders(d)
        self.assertEqual([r['orderType'] for r in rows],[1,2])
        d['players'][0]['rows'][1][0]=1
        with self.assertRaisesRegex(ValueError,'冲突'):ledger.orders(d)
        d['players'][0]['total']=3
        with self.assertRaisesRegex(ValueError,'分页'):ledger.orders(d)

    def test_diamond_gain_is_not_spend_and_same_second_purchases_stay_distinct(self):
        purchase=['2026-10-20 12:00:00','购买礼包','消耗道具：钻石x480获得道具：招募券x20礼包ID:204礼包名称:招募券']
        free=['2026-10-20 12:00:00','购买礼包','获得道具：钻石x20礼包ID:3000礼包名称:免费礼包']
        raw={'server':102,'roleId':'1','totalText':'共 3 条','tables':[{'rows':[purchase,purchase,free]}]}
        rows=ledger.gift_actions(raw,'2026-10-13','2026-10-26')
        self.assertEqual(len(rows),2);self.assertEqual(sum(r['diamonds'] for r in rows),960)
        self.assertEqual(ledger.gift_actions(raw,'2026-10-21','2026-10-26'),[])
        raw['totalText']='共 4 条'
        with self.assertRaisesRegex(ValueError,'分页'):ledger.gift_actions(raw,'2026-10-13','2026-10-26')

    def test_no_sku_is_inferred_from_a_matching_price_and_reward(self):
        row={'job':{'server':102,'roleId':'1'},'row':{'id':'log1','action':71,'cost':[[300003,480,500]],'gain':[[300004,20,25]],'t':1792421657}}
        actual=ledger.unidentified([row,row])
        self.assertEqual(len(actual),1);self.assertNotIn('giftId',actual[0])
        missing={'server':102,'roleId':'1','totalText':'共 1 条','tables':[{'rows':[['2026-10-20 12:00:00','购买礼包','消耗道具：钻石x480获得道具：招募券x20']]}]}
        with self.assertRaisesRegex(ValueError,'身份'):ledger.gift_actions(missing,'2026-10-13','2026-10-26')

    def test_missing_rendered_reward_does_not_drop_the_diamond_debit(self):
        raw={'server':104,'roleId':'private','totalText':'共 1 条','tables':[{'rows':[['2026-10-20 12:00:00','购买礼包','消耗道具：钻石x350礼包ID:312礼包名称:随机魔灵']]}]}
        rows=ledger.gift_actions(raw,'2026-10-13','2026-10-26')
        self.assertEqual(len(rows),1)
        self.assertEqual((rows[0]['giftId'],rows[0]['diamonds'],rows[0]['reward']),(312,350,''))

if __name__=='__main__':unittest.main()
