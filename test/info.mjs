// test/info.mjs — info.js (ファイルの先頭から形式・撮影情報を読む部分) の試験。node で動く。
// 先に python3 test/make_images.py で画像を作っておく。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseInfo, formatInfo, readTiff } from '../src/info.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const rd = (...n) => new Uint8Array(fs.readFileSync(path.join(HERE, 'files', ...n)));
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else fail++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };

for (const f of ['photo_info.jpg', 'photo_info.webp', 'photo_info.png']) {
  const i = parseInfo(rd('info', f), f.split('.').pop());
  const e = i.exif || {};
  ok(e.make === 'Canon' && e.model === 'Canon EOS R6', f + ': メーカーとモデル');
  ok(e.date === '2026:10:04 12:34:56', f + ': 撮影日時');
  ok(Math.abs(e.exposure - 1 / 250) < 1e-9 && Math.abs(e.fnumber - 1.8) < 1e-9 && e.iso === 400, f + ': 露出 (1/250, f/1.8, ISO 400)');
  ok(e.focal === 85 && e.focal35 === 85 && e.lens === 'RF85mm F1.2 L USM', f + ': 焦点距離とレンズ');
  ok(e.gps && Math.abs(e.gps.lat - (35 + 40 / 60 + 48 / 3600)) < 1e-9 && Math.abs(e.gps.lon - (139 + 45 / 60 + 36 / 3600)) < 1e-9, f + ': 位置 (北緯・東経)');
}
{
  const j = parseInfo(rd('info', 'photo_info.jpg'), 'jpg');
  ok(j.format === 'JPEG' && j.detail.some((d) => /YCbCr 4:2:0 8 bit/.test(d)), 'JPEG: 形式と色 (' + j.detail.join(' / ') + ')');
  const w = parseInfo(rd('info', 'photo_info.webp'), 'webp');
  ok(w.format === 'WebP' && w.detail.includes('非可逆'), 'WebP: 非可逆 (' + w.detail.join(' / ') + ')');
  const p = parseInfo(rd('info', 'photo_info.png'), 'png');
  ok(p.format === 'PNG' && p.detail[0] === 'RGB 8 bit', 'PNG: ' + p.detail.join(' / '));
  const a = parseInfo(rd('alpha.png'), 'png');
  ok(a.detail[0] === 'RGB + 透明 8 bit' && a.exif === null, 'PNG (透明): ' + a.detail[0]);
  const g = parseInfo(rd('sub', 'anim.gif'), 'gif');
  ok(g.format === 'GIF' && /^GIF8/.test(g.detail[0]), 'GIF: ' + g.detail.join(' / '));
  const b = parseInfo(rd('small.bmp'), 'bmp');
  ok(b.format === 'BMP' && b.detail[0] === '24 bit', 'BMP: ' + b.detail.join(' / '));
  const n = parseInfo(rd('info', 'plain.jpg'), 'jpg');
  ok(n.format === 'JPEG' && n.exif === null, 'EXIF の無い JPEG は exif が null');
  const o = parseInfo(rd('photo_exif6.jpg'), 'jpg');
  ok(o.exif && o.exif.orientation === 6, '向き (Orientation) が読める');
}
// こわれたものでも例外を出さない
{
  const junk = [new Uint8Array(0), new Uint8Array(5), new Uint8Array(100).fill(0xff), rd('broken.png'), rd('zz_big.jpg').slice(0, 300), rd('info', 'photo_info.jpg').slice(0, 60)];
  let threw = false;
  for (const x of junk) { try { parseInfo(x, 'jpg'); } catch (e) { threw = true; } }
  ok(!threw, '空・短い・こわれた・途中で切れたデータでも例外を出さない');
  // TIFF の中の穴 (オフセットがはみ出す) も安全に
  const t = new Uint8Array(40); t.set([0x49, 0x49, 42, 0, 8, 0, 0, 0, 1, 0, 0x0f, 0x01, 2, 0, 0xff, 0xff, 0, 0, 0x00, 0x10, 0, 0], 0);
  let r; try { r = readTiff(t, 0, 40); } catch (e) { r = 'threw'; }
  ok(r !== 'threw', 'TIFF のオフセットがはみ出していても例外を出さない');
}
// 表示の行
{
  const i = parseInfo(rd('info', 'photo_info.jpg'), 'jpg');
  const ctx = { name: 'photo_info.jpg', path: '/x/photo_info.jpg', width: 300, height: 200, size: 12345, mtime: Date.UTC(2026, 9, 5, 3, 4, 5), ctime: 0, frames: 0 };
  const off = formatInfo(i, ctx, { gps: false }, (n) => n + 'B').join('\n');
  const on = formatInfo(i, ctx, { gps: true }, (n) => n + 'B').join('\n');
  ok(/300 × 200/.test(off) && /JPEG/.test(off) && /12345B/.test(off), '行: 大きさ・形式・容量');
  ok(/撮影: 2026-10-04 12:34:56/.test(off), '行: 撮影日時の形');
  ok(/カメラ: Canon EOS R6/.test(off) && !/Canon Canon/.test(off), '行: カメラ名 (メーカーが重ならない)');
  ok(/1\/250 秒   f\/1\.8   ISO 400   85 mm \(35mm 換算 85 mm\)/.test(off), '行: 露出の並び');
  ok(/位置: あり/.test(off) && !/35\.6/.test(off), '行: 座標は、設定が切れているあいだは出さない');
  ok(/位置: 35\.68000, 139\.76000/.test(on), '行: 設定を入れると座標が出る');
  ok(/更新: 2026-10-0\d \d\d:\d\d:\d\d/.test(off) && !/作成:/.test(off), '行: 更新日時だけ出る (作成日時 0 は出さない)');
  ok(/場所: \/x\/photo_info\.jpg/.test(off), '行: 場所');
  const bare = formatInfo(null, { name: 'a.png', path: '', width: 10, height: 10, size: 0, mtime: 0, ctime: 0, frames: 0 }, {}).join('\n');
  ok(bare === 'a.png\n10 × 10', '行: 情報が無いときは、名前と大きさだけ (' + JSON.stringify(bare) + ')');
}
console.log(`\n${pass} 件 OK、${fail} 件 FAIL`);
process.exit(fail ? 1 : 0);
