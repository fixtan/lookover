// test/serve.mjs — 開発用サーバー (ポート 8770)
//
// Tauri を起動せずに、ブラウザで画面側を動かすためのもの。
//   /            … src/ の中身をそのまま返す
//   /api/...     … Rust 側のコマンドの代わり (フォルダの一覧、読む、書く、など)
// 使い方: node test/serve.mjs   →   http://localhost:8770/?open=<画像のパス>
//
// 注意: このサーバーは、頼まれたパスを何でも読み書きする。自分の PC の中で、開発のときだけ使う。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const PORT = 8770;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

function entry(p) {
  const st = fs.statSync(p);
  return { name: path.basename(p), path: p, size: st.size, mtime: st.mtimeMs, ctime: st.birthtimeMs, is_dir: st.isDirectory() };
}

const body = (req) => new Promise((ok) => { const a = []; req.on('data', (c) => a.push(c)); req.on('end', () => ok(Buffer.concat(a))); });

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const q = (k) => u.searchParams.get(k);
  const json = (v) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(v)); };
  try {
    switch (u.pathname) {
      case '/api/list': {
        const out = [];
        for (const n of fs.readdirSync(q('dir'))) { try { out.push(entry(path.join(q('dir'), n))); } catch (e) { /* 読めないものは飛ばす */ } }
        return json(out);
      }
      case '/api/info': return json(entry(q('path')));
      case '/api/exists': return json({ exists: fs.existsSync(q('path')) });
      case '/api/read': { res.writeHead(200, { 'content-type': 'application/octet-stream' }); return res.end(fs.readFileSync(q('path'))); }
      case '/api/write': {
        const p = q('path'), tmp = p + '.tmp-write';
        fs.writeFileSync(tmp, await body(req));
        fs.renameSync(tmp, p);
        return json({ ok: true });
      }
      case '/api/rename': {
        if (fs.existsSync(q('to'))) throw new Error(q('to') + ': 同じ名前のファイルがすでにある');
        fs.renameSync(q('from'), q('to'));
        return json({ ok: true });
      }
      case '/api/trash': {
        // ごみ箱の代わりに、同じフォルダの .trash へ移す
        const p = q('path'), dir = path.join(path.dirname(p), '.trash');
        fs.mkdirSync(dir, { recursive: true });
        fs.renameSync(p, path.join(dir, path.basename(p)));
        return json({ ok: true });
      }
    }
    const f = path.join(SRC, u.pathname === '/' ? 'index.html' : path.normalize(decodeURIComponent(u.pathname)));
    if (!f.startsWith(SRC) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(f).pipe(res);
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(String(e && e.message ? e.message : e));
  }
}).listen(PORT, '127.0.0.1', () => console.log('http://localhost:' + PORT));
