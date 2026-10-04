# test/app-report.py — test/app.sh の結果を読んで表示する
import json, os, sys
here = os.path.dirname(os.path.abspath(__file__))
p = os.path.join(here, 'app-result.json')
if not os.path.exists(p):
    print('結果のファイルがない。アプリが起動できなかった可能性がある。test/app-1.log を見る。'); sys.exit(1)
r = json.load(open(p, encoding='utf-8'))
print('WebView:', r['ua'])
print('段階:', r.get('phase'), '/ WebP 書き出し:', r.get('canEncodeWebp'), '/', r.get('fatal', ''))
bad = 0
for c in r['checks']:
    bad += 0 if c['ok'] else 1
    print(('ok   ' if c['ok'] else 'FAIL ') + c['name'] + ('  — ' + c['detail'] if c['detail'] else ''))
s = os.path.join(here, 'app-second.txt')
if os.path.exists(s): print(open(s).read().strip())
print(f"{len(r['checks']) - bad} 件 OK、{bad} 件 FAIL")
sys.exit(1 if bad or r.get('phase') != 2 else 0)
