import importlib.util
import pathlib
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('build',pathlib.Path(__file__).with_name('build-evidence.py'))
build=importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)

class EvidenceTests(unittest.TestCase):
    def run_data(self, players, products=None):
        raw={'complete':True,'columns':['id','money','status','orderType','rechargeItemId','dateline'],'players':players}
        with tempfile.TemporaryDirectory() as temp:
            return build.aggregate_orders(raw, products or [{'key':'gift:505','rid':505}], pathlib.Path(temp)/'history.sqlite', 'source')

    def test_cash_excludes_pending_and_vouchers_and_deduplicates_roles(self):
        rows=[[1,30,1,1,505,1791993600],[2,30,1,1,505,1792080000],[3,30,0,1,505,1791993600],[4,30,1,2,505,1791993600]]
        result=self.run_data([{'server':102,'role':'a','total':4,'rows':rows}])
        item=result['byProduct']['gift:505']
        self.assertEqual((item['orders'],item['buyers'],item['yuan'],item['failedOrPending'],item['voucherOrders']),(2,1,60,1,1))
        self.assertEqual(sum(x['buyers'] for x in item['daily']),2)

    def test_order_ids_are_scoped_to_server_and_duplicates_not_counted(self):
        player={'server':102,'role':'a','total':1,'rows':[[1,30,1,1,505,1791993600]]}
        result=self.run_data([player,player,{**player,'server':103}])
        self.assertEqual(result['byProduct']['gift:505']['orders'],2)
        self.assertEqual(result['byProduct']['gift:505']['buyers'],2)

    def test_ambiguous_mapping_is_not_attached(self):
        result=self.run_data([{'server':102,'role':'a','total':1,'rows':[[1,30,1,1,505,1791993600]]}],[{'key':'a','rid':505},{'key':'b','rid':505}])
        self.assertEqual(result['byProduct'],{})
        self.assertEqual(result['unresolved'][0]['orders'],1)

    def test_incomplete_pages_rejected(self):
        with self.assertRaises(ValueError):
            self.run_data([{'server':102,'role':'a','total':2,'rows':[[1,30,1,1,505,1791993600]]}])

if __name__=='__main__': unittest.main()
