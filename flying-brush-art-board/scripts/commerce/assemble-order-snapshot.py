"""Assemble whitelisted fields saved from GM's read-only order pages."""
import argparse
import hashlib
import json
from pathlib import Path

def assemble(directory, output):
    state=json.loads((directory/'collection-state-private.json').read_text(encoding='utf8'))
    files=sorted(directory.glob('gm-orders-S*-private.json'))
    if state['completed']!=state['total'] or state['errors'] or len(files)!=state['total']:
        raise ValueError('订单读取尚未完成，不能声明完整名单')
    players,manifest=[],[]
    for p in files:
        b=p.read_bytes();d=json.loads(b)
        if d['total']!=len(d['rows']):raise ValueError('角色区间行数不符')
        players.append({k:d[k] for k in ['server','role','total','rows']})
        manifest.append({'path':str(p),'sha256':hashlib.sha256(b).hexdigest(),'sourceTotal':d['sourceTotal'],'selectedRows':d['total'],'readAt':d['readAt']})
    if len({(p['server'],p['role']) for p in players})!=len(players):raise ValueError('重复角色')
    result={'complete':True,'readAt':state['readAt'],'from':state['from'],'through':state['through'],
        'columns':['id','money','status','orderType','rechargeItemId','dateline'],'players':players}
    output.write_text(json.dumps(result,ensure_ascii=False),encoding='utf8')
    output.with_suffix('.manifest.json').write_text(json.dumps(manifest,ensure_ascii=False),encoding='utf8')
    print(json.dumps({'roles':len(players),'orders':sum(p['total'] for p in players)}))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--directory',type=Path,required=True);parser.add_argument('--output',type=Path,required=True)
    a=parser.parse_args();assemble(a.directory,a.output)
