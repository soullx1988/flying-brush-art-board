"""Synthetic fixtures only; no private workbook or game values in test fixtures."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
import openpyxl

spec = importlib.util.spec_from_file_location("prices", Path(__file__).with_name("commercial-base-prices.py"))
prices = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prices)


def workbook():
    w = openpyxl.Workbook()
    s = w.active
    s.title = "日周月礼包表"
    s.append([])
    s.append([])
    s.append([None, "名称", "道具", "道具数量", "钻石价格", "返利比", "折扣"])
    return w, s


class ValuationTests(unittest.TestCase):
    def test_free_ad_and_raw_sale_are_not_base_prices(self):
        w, s = workbook()
        for p, f in [(0, 10), ("广告", 10), (100, None), (100, "=#REF!")]:
            s.append([None, "礼包", "材料", 5, p, f])
        rows, skipped = prices.read_rows(w)
        self.assertFalse(rows)
        self.assertEqual(len(skipped), 4)

    def test_duplicate_sheets_do_not_weight_the_estimate_twice(self):
        w, s = workbook()
        s.append([None, "礼包", "材料", 5, 100, 1.5])
        duplicate = w.copy_worksheet(s)
        duplicate.title = "日周月礼包"
        duplicate.append([None, "礼包2", "材料", 10, 200, 1.6])
        rows, _ = prices.read_rows(w)
        self.assertEqual([r["value"] for r in rows["材料"]], [30, 32])
        self.assertEqual(len(rows["材料"][0]["sources"]), 2)

    def test_conflicting_values_and_ambiguous_names_remain_unpriced(self):
        w, s = workbook()
        s.append([None, "礼包", "冲突材料", 1, 100, 2])
        s.append([None, "礼包2", "冲突材料", 1, 100, 4])
        s.append([None, "礼包3", "同名材料", 1, 100, 2])
        s.append([None, "礼包4", "旧名材料", 1, 100, 2])
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "source.xlsx"
            w.save(path)
            before = path.read_bytes()
            result, _, audit = prices.extract(path, [{"id": 1, "name": "冲突材料"}, {"id": 2, "name": "同名材料"}, {"id": 3, "name": "同名材料"}, {"id": 4, "name": "新名材料"}])
            self.assertFalse(result)
            self.assertEqual(len(audit["unmatched"]), 3)
            self.assertEqual(before, path.read_bytes())

    def test_changed_headers_fail_closed(self):
        w, s = workbook()
        s["F3"] = "充值返还"
        with self.assertRaises(ValueError):
            prices.read_rows(w)


if __name__ == "__main__":
    unittest.main()
