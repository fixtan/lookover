// selftest.js — アプリ本体 (Tauri) の中で走らせる自動試験
//
// ブラウザでの試験 (test/ui.mjs) では、Rust 側とのやり取りを確かめられない。
// そこで、アプリを  lookover <画像> --selftest=<結果の書き出し先>  で起動すると、
// 起動後にここの run が呼ばれて、Rust 側のコマンドを一通り使い、結果を JSON で書き出す。
// ふだんの起動では、このファイルは読み込まれない。

import * as be from './backend.js';
import { decode } from './decode.js';

export async function run(outPath, iv, args) {
  const log = [];
  const R = { args, tauri: be.isTauri, ua: navigator.userAgent, checks: log };
  const check = (name, ok, detail = '') => log.push({ name, ok: !!ok, detail: String(detail) });
  const step = async (name, fn) => {
    try { const d = await fn(); check(name, d !== false, d === true || d === undefined ? '' : d); }
    catch (e) { check(name, false, 'throw: ' + (e && e.message ? e.message : e)); }
  };
  const wait = async (fn, ms = 15000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 50)); } };

  try {
    const { S, folder } = iv;

    // ---- 起動時に渡した画像が開いているか ----
    await step('起動時の引数から画像を開く', async () => {
      await wait(() => S.item && S.bmp);
      return `${S.item.name} ${S.bw}x${S.bh} / ${folder.count} 件 / title=${document.title}`;
    });
    const dir = be.dirname(S.item.path);
    R.dir = dir; R.first = S.item.name;

    // ---- ファイルの読み書き ----
    const jp = be.join(dir, '試験 テスト.bin');
    const data = new Uint8Array(70000);
    for (let i = 0; i < data.length; i++) data[i] = (i * 31 + 7) & 255;
    await step('write_file: 日本語と空白を含む名前へ、70 KB のバイト列を書く', async () => { await be.writeFile(jp, data); });
    await step('path_exists: 書いたファイルがある', async () => (await be.exists(jp)) === true);
    await step('read_file: 読み戻すと、同じ中身', async () => {
      const b = new Uint8Array(await be.readFile(jp));
      if (b.length !== data.length) return false;
      for (let i = 0; i < b.length; i++) if (b[i] !== data[i]) return false;
      return `${b.length} bytes`;
    });
    await step('file_info: 大きさが取れる', async () => { const i = await be.fileInfo(jp); return i.size === 70000 && !i.isDir && i.mtime > 1e12 && i.ctime >= 0 ? `mtime=${Math.round(i.mtime)} ctime=${Math.round(i.ctime)}` : false; });
    await step('list_dir: 一覧に入っている', async () => (await be.listDir(dir)).some((e) => e.name === '試験 テスト.bin'));
    await step('file_info: フォルダはフォルダと分かる', async () => (await be.fileInfo(dir)).isDir === true);
    await step('trash_file: ごみ箱へ送ると、無くなる', async () => { await be.trash(jp); return (await be.exists(jp)) === false; });
    await step('read_file: 無いファイルは、例外になる', async () => { try { await be.readFile(be.join(dir, 'no-such-file.png')); return false; } catch (e) { return 'error: ' + e; } });

    // ---- 窓 ----
    await step('set_title / is_fullscreen', async () => { be.setTitle('selftest'); return (await be.isFullscreen()) === false; });

    // ---- 送る・編集・書き出し ----
    await step('次の画像へ送る', async () => { const n = S.item.name; iv.go(1); await wait(() => S.item.name !== n && S.bmp); return S.item.name; });
    await step('前の画像へ戻る', async () => { iv.go(-1); await wait(() => S.item.name === R.first && S.bmp); });
    await step('回転 + 色の調整 (絵を作り直せる)', async () => {
      iv.doRotate(1);
      S.edit.adj.brightness = 30; S.edit.adj.sharpen = 50;
      iv.commit(); iv.rebuild();
      return `${S.out.w}x${S.out.h}`;
    });
    // この WebView が WebP に書き出せるか。
    // Windows (WebView2) は書き出せる。Linux (WebKitGTK) は書き出せないので、JPEG のプリセットで代わりに確かめる。
    const webp = await new Promise((ok) => { const c = document.createElement('canvas'); c.width = c.height = 2; c.toBlob((b) => ok(!!b && b.type === 'image/webp'), 'image/webp', 0.8); });
    R.canEncodeWebp = webp;
    const n = Math.max(0, iv.settings.presets.findIndex((p) => p.format === (webp ? 'webp' : 'jpeg')));
    let exported = '';
    await step(`ワンキー書き出し (${webp ? 'WebP' : 'JPEG。この WebView は WebP に書き出せない'})`, async () => {
      exported = await iv.quickExport(n);
      if (!exported) return false;
      const bytes = await be.readFile(exported);
      const d = await decode(bytes, be.extname(exported));
      const u = new Uint8Array(bytes);
      const head = webp ? String.fromCharCode(...u.slice(0, 4)) + String.fromCharCode(...u.slice(8, 12)) : (u[0] === 0xff && u[1] === 0xd8 ? 'JPEG' : '?');
      return `${be.basename(exported)} ${d.width}x${d.height} ${u.length} bytes ${head}`;
    });
    await step('書き出したファイルが、一覧に入る', async () => folder.items.some((i) => i.path === exported));
    iv.resetAll();

    R.phase = 1;
    await be.writeFile(outPath, new TextEncoder().encode(JSON.stringify(R, null, 2)));

    // ---- 2 つ目の起動から渡されるファイル ----
    // 試験の側が、別の画像を引数にして、もう一度アプリを起動する。
    // 2 つ目は起動せず、こちら (1 つ目) にパスが渡されてくるはず。
    const before = S.item.path;
    try {
      await wait(() => S.item && S.item.path !== before && S.bmp, 60000);
      check('2 つ目の起動から渡された画像を、1 つ目の窓で開く', true, S.item.name);
    } catch (e) {
      check('2 つ目の起動から渡された画像を、1 つ目の窓で開く', false, '60 秒待っても来なかった');
    }
    R.phase = 2;
    await be.writeFile(outPath, new TextEncoder().encode(JSON.stringify(R, null, 2)));
  } catch (e) {
    R.fatal = String(e && e.stack ? e.stack : e);
    try { await be.writeFile(outPath, new TextEncoder().encode(JSON.stringify(R, null, 2))); } catch (e2) { /* 書けなければ、どうにもならない */ }
  }
}
