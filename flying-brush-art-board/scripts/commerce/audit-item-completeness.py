"""Read-only content audit and additive icon bundle; raw player data is never emitted."""
import argparse
import collections
import copy
import importlib.util
import json
from pathlib import Path


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def run(args):
    here = Path(__file__).parent
    audit = module('catalog_audit', here / 'audit-catalog.py')
    placement = module('placement_audit', here / 'audit-item-placements.py')
    pictures = module('pictures', here / 'build-evidence.py')
    read = audit.read
    catalog, previous, current = read(args.dataset), read(args.before), read(args.item_map)
    expected, *_ = audit.expected_products(catalog)
    report = placement.audit_links(catalog, current, expected)
    approvals = {i['id']: i['approvedPrice'] for i in previous['items'] if i.get('approvedPrice')}
    for i in current['items']:
        if i['id'] in approvals:
            i.update(basePrice=approvals[i['id']]['value'], approvedPrice=approvals[i['id']])
    before = {i['id']: i for i in previous['items']}
    report['priceChanges'] = [dict(id=i['id'], before=before[i['id']]['basePrice'], after=i['basePrice']) for i in current['items'] if i['id'] in before and before[i['id']]['basePrice'] != i['basePrice']]
    report['addedPlacementSources'] = [{'id': i['id'], 'name': i['name'], 'added': len(set(i['placementSources']) - set(before.get(i['id'], {}).get('placementSources', [])))} for i in current['items']]
    report['addedPlacementSources'] = [x for x in report['addedPlacementSources'] if x['added']]
    report['stageCounts'] = dict(collections.Counter(i['stageId'] for i in current['items']))
    report['missingPrices'] = [{'id': i['id'], 'name': i['name']} for i in current['items'] if i['basePrice'] is None]
    report['approvedPrices'] = len(approvals)
    used = {i['id'] for i in current['items']} | {r['id'] for i in current['items'] for r in i.get('contents', [])}
    assets, files, icons = pictures.item_icons(args.client, used)
    report['missingIcons'] = sorted(used - set(map(int, icons)))
    report['addedIcons'] = sorted(set(icons) - set(catalog['evidence']['icons']), key=int)
    report['containers'] = [{'id': i['id'], 'name': i['name'], 'candidates': len(i.get('contents', [])), 'gaps': i.get('contentGaps', [])} for i in current['items'] if i.get('contents') or i.get('contentGaps')]
    report['candidateItemCount'] = len({r['id'] for i in current['items'] for r in i.get('contents', [])})
    report['exchangeCostLinks'] = sum(len(i.get('exchangeUses', [])) for i in current['items'])
    source_changes = []
    for key, source in catalog['sources'].items():
        if audit.source(source['path'])['sha256'] != source['sha256']:
            source_changes.append(key)
    report['changedCatalogSources'] = source_changes
    evidence = copy.deepcopy(catalog['evidence'])
    evidence['assets'].update(assets); evidence['icons'].update(icons)
    all_files = read(args.assets_bundle)['files']; all_files.update(files)
    if any(key not in all_files for key in evidence['assets']):
        raise ValueError('Missing existing image bytes')
    bundle = dict(format='infinite-board-commerce-evidence', version=1, evidence=evidence, files={h: all_files[h] for h in evidence['assets']})
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf8')
    if any(report[k] for k in ['missingProducts', 'extraProducts', 'differences', 'unmappedRewardIds', 'changedCatalogSources', 'priceChanges']):
        raise ValueError('Content mismatch; inspect report before import')
    args.output.write_text(json.dumps(bundle, ensure_ascii=False), encoding='utf8')
    print(json.dumps({k: v for k,v in report.items() if k not in ['byItem', 'addedPlacementSources', 'withoutDirectProductReward']}, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ['dataset', 'before', 'item-map', 'client', 'assets-bundle', 'report', 'output']:
        parser.add_argument('--'+key, type=Path, required=True)
    run(parser.parse_args())
