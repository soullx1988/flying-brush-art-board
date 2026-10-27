import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('archived', Path(__file__).with_name('build-archived-revenue.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ArchivedRevenueTest(unittest.TestCase):
    def item(self, capture, amount, **fields):
        return module.observation(501, '2026-06-11', capture, {'OrderTotalAmount':amount, **fields}, Path('source.json'), 'fixture')

    def test_latest_capture_replaces_accumulation_and_does_not_borrow_old_counts(self):
        early = self.item('2026-06-11T23:00:00+08:00', 90, OrderNum=4)
        late = self.item('2026-06-12T10:00:00+08:00', 100)
        rows = module.choose_latest([late, early, late])
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['yuan'], 100)
        self.assertNotIn('orders', rows[0])

    def test_conflict_invalid_amount_and_future_day_fail(self):
        a = self.item('2026-06-12T10:00:00+08:00', 100)
        b = self.item('2026-06-12T10:00:00+08:00', 101)
        with self.assertRaises(ValueError): module.choose_latest([a,b])
        with self.assertRaises(ValueError): self.item('2026-06-12T10:00:00+08:00', -1)
        with self.assertRaises(ValueError): self.item('2026-06-10T10:00:00+08:00', 10)

    def test_latest_correction_can_decrease_amount_and_missing_dates_stay_missing(self):
        rows = module.choose_latest([self.item('2026-06-11T23:00:00+08:00', 100), self.item('2026-06-12T10:00:00+08:00', 80)])
        self.assertEqual([(r['date'],r['yuan']) for r in rows], [('2026-06-11',80)])


if __name__ == '__main__': unittest.main()
