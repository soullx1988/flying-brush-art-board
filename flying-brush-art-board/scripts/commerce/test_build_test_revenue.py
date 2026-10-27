import copy
from contextlib import closing
import importlib.util
import json
import pathlib
import sqlite3
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('revenue',pathlib.Path(__file__).with_name('build-test-revenue.py'))
revenue=importlib.util.module_from_spec(spec)
spec.loader.exec_module(revenue)

class TestRevenue(unittest.TestCase):
    def setUp(self):
        self.daily={'server':102,'from':'2027-10-13','through':'2027-10-26','readAt':'2027-10-27','tables':[
            {'headers':['日期','订单数','总充值','付费用户数量'],'rows':[]},
            {'headers':[],'rows':[['2027-10-14','2','60','1']]},
            {'headers':['总充值','付费用户数量(去重)'],'rows':[]},
            {'headers':[],'rows':[['60','1']]}]}
        self.products={'server':102,'from':'2027-10-13','toExclusive':'2027-10-27','readAt':'2027-10-27','tables':[
            {'headers':['充值项目Id','充值类型','充值类型名称','充值项名称','充值项配置金额','充值人数(总计)','代金券充值人数','订单总数','订单总金额'],'rows':[]},
            {'headers':[],'rows':[['505','8','礼包','测试礼包','30','2','1','3','90']]}]}

    def test_different_bases_persist_and_missing_dates_are_not_filled(self):
        with tempfile.TemporaryDirectory() as temp:
            root=pathlib.Path(temp)
            scope={'title':'测试','from':'2027-10-13','through':'2027-10-26','coverage':'测试范围','servers':[{'id':102,'name':'王者1服','group':'king'}]}
            for name,body in [('scope.json',scope),('gm-daily-S102.json',self.daily),('gm-products-S102.json',self.products)]:
                (root/name).write_text(json.dumps(body),encoding='utf-8')
            out,db=root/'bundle.json',root/'history.sqlite'
            audit=revenue.build(root,{'products':[{'rid':505,'status':'defined'}]},{'evidence':{'history':{'successCashYuan':999}}},out,db)
            self.assertEqual((audit['cashYuan'],audit['productYuan'],audit['dailyRows']),(60,90,1))
            saved=json.loads(out.read_text(encoding='utf-8'))
            self.assertEqual(saved['evidence']['history']['successCashYuan'],999)
            with closing(sqlite3.connect(db)) as conn:
                self.assertEqual(conn.execute('select count(*) from gm_product_totals').fetchone()[0],1)
            (root/'gm-daily-S102.json').unlink()
            with self.assertRaisesRegex(ValueError,'Each scope server'):
                revenue.build(root,{'products':[]},{'evidence':{}},out,db)

    def test_daily_totals_duplicates_and_dates_fail_closed(self):
        bad=copy.deepcopy(self.daily); bad['tables'][-1]['rows'][0][0]='61'
        with self.assertRaisesRegex(ValueError,'sum does not match'): revenue.parse_daily(bad)
        bad=copy.deepcopy(self.daily); bad['tables'][1]['rows']*=2
        with self.assertRaisesRegex(ValueError,'Duplicate'): revenue.parse_daily(bad)
        bad=copy.deepcopy(self.daily); bad['tables'][1]['rows'][0][0]='2027-10-27'
        with self.assertRaisesRegex(ValueError,'outside'): revenue.parse_daily(bad)

    def test_duplicate_product_and_negative_money_are_rejected(self):
        bad=copy.deepcopy(self.products); bad['tables'][1]['rows']*=2
        with self.assertRaisesRegex(ValueError,'duplicated'): revenue.parse_products(bad)
        bad=copy.deepcopy(self.products); bad['tables'][1]['rows'][0][-1]='-30'
        with self.assertRaisesRegex(ValueError,'nonnegative'): revenue.parse_products(bad)

if __name__=='__main__': unittest.main()
