"""Extract action 71 from the existing first_week_behavior props backups.

The original collector filters saved rows before 2026-10-22, so returned may
exceed len(rows). Pagination completeness must use returned vs total instead.
No SKU inference is performed; original file and job remain attached locally.
"""
import argparse
import hashlib
import json
from pathlib import Path

def extract(directory, output):
    rows, sources = [], []
    for p in sorted(directory.glob('props_*_full_private.json')):
        b = p.read_bytes()
        data = json.loads(b.decode('utf-8-sig'))
        if data['returned'] < data['total'] or len(data['rows']) > data['returned']:
            raise ValueError(f'分页不完整：{p.name}')
        rows.extend({'job':data['job'],'row':r,'source':str(p)} for r in data['rows'] if r['action']==71)
        sources.append({'path':str(p),'sha256':hashlib.sha256(b).hexdigest(),'total':data['total'],'returned':data['returned'],'saved':len(data['rows']),'readAt':data['readAt']})
    output.write_text(json.dumps(rows,ensure_ascii=False),encoding='utf8')
    output.with_suffix('.manifest.json').write_text(json.dumps(sources,ensure_ascii=False),encoding='utf8')
    print(json.dumps({'files':len(sources),'giftRows':len(rows)}))

if __name__=='__main__':
    p=argparse.ArgumentParser()
    p.add_argument('--directory',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True)
    a=p.parse_args();extract(a.directory,a.output)
