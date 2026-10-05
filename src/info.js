// info.js — 画像ファイルの「中身の情報」を読む (形式・色・撮影情報など)
//
// ファイルの先頭の部分 (数百 KB) だけを見て、PNG / JPEG / WebP / GIF / BMP のヘッダーと、
// EXIF (撮影日時・カメラ・露出・位置) を読む。ブラウザの機能では取れない情報なので、自前で読む。
// 画面にも Rust にも触らない純粋な関数だけなので、node でそのままテストできる。
//
//   parseInfo(bytes, ext) → { format, detail:[…], exif:{…}|null }   読めなくても例外は出さない
//   formatInfo(info, ctx, opts) → 表示用の行の配列

export const HEAD_BYTES = 512 * 1024; // 先頭のこれだけ見る (大きい ICC や XMP の後ろに本体の情報が来ることがあるため、余裕を持たせた)

const u8 = (b) => (b instanceof Uint8Array ? b : new Uint8Array(b));
const ascii = (a, o, n) => { let s = ''; for (let i = 0; i < n && o + i < a.length; i++) s += String.fromCharCode(a[o + i]); return s; };

// ---- 入口 ----

export function parseInfo(bytes, ext = '') {
  const out = { format: '', detail: [], exif: null };
  try {
    const a = u8(bytes);
    if (a.length < 12) return out;
    if (a[0] === 0x89 && ascii(a, 1, 3) === 'PNG') png(a, out);
    else if (a[0] === 0xff && a[1] === 0xd8) jpeg(a, out);
    else if (ascii(a, 0, 4) === 'RIFF' && ascii(a, 8, 4) === 'WEBP') webp(a, out);
    else if (ascii(a, 0, 3) === 'GIF') gif(a, out);
    else if (a[0] === 0x42 && a[1] === 0x4d) bmp(a, out);
    else if (ascii(a, 4, 4) === 'ftyp') out.format = /avif|avis/.test(ascii(a, 8, 8)) ? 'AVIF' : ascii(a, 8, 4).trim();
    else if (a[0] === 0 && a[1] === 0 && a[2] === 1 && a[3] === 0) { out.format = 'ICO'; out.detail.push(`${a[4] | (a[5] << 8)} 種類の大きさ`); }
    else if (ext === 'svg') out.format = 'SVG';
  } catch (e) { /* 読めなかった分は、出さないだけ */ }
  return out;
}

// ---- PNG ----

const PNG_COLOR = { 0: 'グレー', 2: 'RGB', 3: 'パレット', 4: 'グレー + 透明', 6: 'RGB + 透明' };

function png(a, out) {
  out.format = 'PNG';
  const dv = new DataView(a.buffer, a.byteOffset, a.byteLength);
  let o = 8;
  while (o + 12 <= a.length) {
    const len = dv.getUint32(o), type = ascii(a, o + 4, 4), d = o + 8;
    if (type === 'IHDR') {
      const bits = a[d + 8], ct = a[d + 9];
      out.detail.push(`${PNG_COLOR[ct] || '?'} ${bits} bit${a[d + 12] ? ' ／ インターレース' : ''}`);
    } else if (type === 'pHYs' && a[d + 8] === 1) {
      const dpi = Math.round(dv.getUint32(d) * 0.0254);
      if (dpi > 0) out.detail.push(`${dpi} dpi`);
    } else if (type === 'acTL') out.detail.push(`APNG ${dv.getUint32(d)} コマ`);
    else if (type === 'iCCP') out.detail.push('色プロファイルあり');
    else if (type === 'eXIf') out.exif = readTiff(a, d, d + Math.min(len, a.length - d));
    else if (type === 'IDAT' || type === 'IEND') { if (out.exif || type === 'IEND') break; }
    o += 12 + len;
  }
}

// ---- JPEG ----

function jpeg(a, out) {
  out.format = 'JPEG';
  const dv = new DataView(a.buffer, a.byteOffset, a.byteLength);
  let o = 2, prog = false, icc = false;
  while (o + 4 <= a.length) {
    if (a[o] !== 0xff) { o++; continue; }
    const m = a[o + 1];
    if (m === 0xff) { o++; continue; }
    if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) { o += 2; continue; }
    if (m === 0xd9 || m === 0xda) break;
    const len = dv.getUint16(o + 2), d = o + 4;
    if (m === 0xe0 && ascii(a, d, 4) === 'JFIF') {
      const unit = a[d + 7], x = dv.getUint16(d + 8);
      if (unit === 1 && x > 1) out.detail.push(`${x} dpi`);
      else if (unit === 2 && x > 1) out.detail.push(`${Math.round(x * 2.54)} dpi`);
    } else if (m === 0xe1 && ascii(a, d, 6) === 'Exif\0\0') {
      if (!out.exif) out.exif = readTiff(a, d + 6, o + 2 + len);
    } else if (m === 0xe2 && ascii(a, d, 11) === 'ICC_PROFILE') icc = true;
    else if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      prog = m === 0xc2 || m === 0xc6 || m === 0xca || m === 0xce;
      const prec = a[d], n = a[d + 5];
      let s = n === 1 ? 'グレー' : n === 3 ? 'YCbCr' : n === 4 ? 'CMYK' : `${n} 成分`;
      if (n === 3) {
        const hv = a[d + 7], rest = a[d + 10] === 0x11 && a[d + 13] === 0x11;
        const sub = rest ? ({ 0x11: '4:4:4', 0x21: '4:2:2', 0x12: '4:4:0', 0x22: '4:2:0', 0x41: '4:1:1' })[hv] : '';
        if (sub) s += ' ' + sub;
      }
      out.detail.unshift(`${s} ${prec} bit${prog ? ' ／ プログレッシブ' : ''}`);
    }
    o += 2 + len;
  }
  if (icc) out.detail.push('色プロファイルあり');
}

// ---- WebP ----

function webp(a, out) {
  out.format = 'WebP';
  const dv = new DataView(a.buffer, a.byteOffset, a.byteLength);
  let o = 12, kind = '', flags = 0;
  while (o + 8 <= a.length) {
    const type = ascii(a, o, 4), len = dv.getUint32(o + 4, true), d = o + 8;
    if (type === 'VP8X') flags = a[d];
    else if (type === 'VP8 ') kind = '非可逆';
    else if (type === 'VP8L') kind = '可逆';
    else if (type === 'EXIF') {
      const s = ascii(a, d, 6) === 'Exif\0\0' ? 6 : 0;
      out.exif = readTiff(a, d + s, d + Math.min(len, a.length - d));
    }
    if (kind && (out.exif || !(flags & 0x08))) break; // 画像の本体まで来て、EXIF が無い (または読めた)
    o += 8 + len + (len & 1);
  }
  if (kind) out.detail.push(kind);
  if (flags & 0x02) out.detail.push('アニメーション');
  if (flags & 0x10) out.detail.push('透明あり');
  if (flags & 0x20) out.detail.push('色プロファイルあり');
}

// ---- GIF / BMP ----

function gif(a, out) {
  out.format = 'GIF';
  out.detail.push(ascii(a, 0, 6));
  if (a[10] & 0x80) out.detail.push(`${2 << (a[10] & 7)} 色`);
}

function bmp(a, out) {
  out.format = 'BMP';
  const dv = new DataView(a.buffer, a.byteOffset, a.byteLength);
  if (a.length >= 30 && dv.getUint32(14, true) >= 40) out.detail.push(`${dv.getUint16(28, true)} bit`);
}

// ---- EXIF (TIFF の入れ物) ----

const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8 };

// a の [start, end) が TIFF。読めたものだけを入れた { … } を返す。何も読めなければ null。
export function readTiff(a, start, end) {
  end = Math.min(end, a.length);
  if (end - start < 8) return null;
  const le = ascii(a, start, 2) === 'II';
  if (!le && ascii(a, start, 2) !== 'MM') return null;
  const dv = new DataView(a.buffer, a.byteOffset, a.byteLength);
  const u16 = (o) => dv.getUint16(o, le), u32 = (o) => dv.getUint32(o, le);
  const ok = (o, n) => o >= start && o + n <= end;

  // 1 つの IFD を { タグ番号: 値 } にする。値は、数なら number (複数なら配列)、文字なら string。
  function ifd(off) {
    const r = {};
    off += start;
    if (!ok(off, 2)) return r;
    const n = Math.min(u16(off), 500);
    for (let i = 0; i < n; i++) {
      const e = off + 2 + i * 12;
      if (!ok(e, 12)) break;
      const tag = u16(e), type = u16(e + 2), cnt = u32(e + 4), sz = (TYPE_SIZE[type] || 0) * cnt;
      if (!sz || cnt > 100000) continue;
      const v = sz <= 4 ? e + 8 : start + u32(e + 8);
      if (!ok(v, sz)) continue;
      if (type === 2) { r[tag] = ascii(a, v, cnt).replace(/\0.*$/s, '').trim(); continue; }
      const vals = [];
      for (let k = 0; k < Math.min(cnt, 8); k++) {
        if (type === 3) vals.push(u16(v + k * 2));
        else if (type === 4) vals.push(u32(v + k * 4));
        else if (type === 9) vals.push(dv.getInt32(v + k * 4, le));
        else if (type === 5) { const d = u32(v + k * 8 + 4); vals.push(d ? u32(v + k * 8) / d : 0); }
        else if (type === 10) { const d = dv.getInt32(v + k * 8 + 4, le); vals.push(d ? dv.getInt32(v + k * 8, le) / d : 0); }
        else if (type === 1 || type === 7) vals.push(a[v + k]);
      }
      if (vals.length) r[tag] = vals.length === 1 ? vals[0] : vals;
    }
    r.__next = ok(off + 2 + n * 12, 4) ? u32(off + 2 + n * 12) : 0;
    return r;
  }

  const i0 = ifd(u32(start + 4));
  const ex = i0[0x8769] ? ifd(i0[0x8769]) : {};
  const gp = i0[0x8825] ? ifd(i0[0x8825]) : {};

  const e = {};
  const put = (k, v) => { if (v !== undefined && v !== '' && !(typeof v === 'number' && isNaN(v))) e[k] = v; };
  put('make', i0[0x010f]); put('model', i0[0x0110]); put('software', i0[0x0131]);
  put('orientation', i0[0x0112]);
  put('date', ex[0x9003] || i0[0x0132]);
  put('lens', ex[0xa434]);
  put('exposure', ex[0x829a]); put('fnumber', ex[0x829d]);
  put('iso', Array.isArray(ex[0x8827]) ? ex[0x8827][0] : ex[0x8827]);
  put('focal', ex[0x920a]); put('focal35', ex[0xa405]);
  put('bias', ex[0x9204]);
  put('flash', ex[0x9209] === undefined ? undefined : !!(ex[0x9209] & 1));
  if (Array.isArray(gp[2]) && Array.isArray(gp[4]) && gp[2].length === 3 && gp[4].length === 3) {
    const dms = (v) => v[0] + v[1] / 60 + v[2] / 3600;
    let lat = dms(gp[2]), lon = dms(gp[4]);
    if (String(gp[1]).toUpperCase().startsWith('S')) lat = -lat;
    if (String(gp[3]).toUpperCase().startsWith('W')) lon = -lon;
    if (isFinite(lat) && isFinite(lon) && (lat || lon)) e.gps = { lat, lon };
  }
  return Object.keys(e).length ? e : null;
}

// ---- 表示用の行 ----

const pad2 = (n) => String(n).padStart(2, '0');
export function fmtDate(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

const exifDate = (s) => String(s).replace(/^(\d{4}):(\d\d):(\d\d)/, '$1-$2-$3');

function shutter(t) {
  if (!(t > 0)) return '';
  if (t >= 1) return `${+t.toFixed(1)} 秒`;
  return `1/${Math.round(1 / t)} 秒`;
}

const ORIENT = { 2: '左右反転', 3: '180 度回転', 4: '上下反転', 5: '転置', 6: '右へ 90 度', 7: '逆転置', 8: '左へ 90 度' };

// ctx : { name, path, width, height, size, mtime, ctime, frames, virtual } と fmtBytes
// opts: { gps: 座標まで出すか }
// 返すのは、1 行ずつの文字列の配列
export function formatInfo(info, ctx, opts = {}, fmtBytes = (n) => n + ' B') {
  const L = [];
  L.push(ctx.name);
  const px = ctx.width && ctx.height ? `${ctx.width} × ${ctx.height}` : '';
  const mp = ctx.width * ctx.height >= 100000 ? ` (${(ctx.width * ctx.height / 1e6).toFixed(1)} MP)` : '';
  L.push([px + mp, info && info.format, ctx.size ? fmtBytes(ctx.size) : ''].filter(Boolean).join('  ／  '));
  if (info && info.detail.length) L.push(info.detail.join(' ／ '));
  if (ctx.frames) L.push(`動く画像 ${ctx.frames} コマ`);

  const e = info && info.exif;
  if (e) {
    if (e.date) L.push('撮影: ' + exifDate(e.date));
    const cam = [e.make && e.model && e.model.startsWith(e.make) ? '' : e.make, e.model].filter(Boolean).join(' ');
    if (cam) L.push('カメラ: ' + cam);
    if (e.lens) L.push('レンズ: ' + e.lens);
    const set = [];
    if (e.exposure) set.push(shutter(e.exposure));
    if (e.fnumber) set.push('f/' + +e.fnumber.toFixed(1));
    if (e.iso) set.push('ISO ' + e.iso);
    if (e.focal) set.push(`${+e.focal.toFixed(1)} mm` + (e.focal35 ? ` (35mm 換算 ${e.focal35} mm)` : ''));
    if (e.bias) set.push(`露出補正 ${e.bias > 0 ? '+' : ''}${+e.bias.toFixed(1)}`);
    if (e.flash) set.push('フラッシュ');
    if (set.length) L.push(set.join('   '));
    if (e.orientation > 1 && ORIENT[e.orientation]) L.push('向き: ' + ORIENT[e.orientation] + ' (反映して表示)');
    if (e.software) L.push('ソフト: ' + e.software);
    if (e.gps) L.push(opts.gps ? `位置: ${e.gps.lat.toFixed(5)}, ${e.gps.lon.toFixed(5)}` : '位置: あり (設定で表示できる)');
  }
  if (ctx.mtime) L.push('更新: ' + fmtDate(ctx.mtime));
  if (ctx.ctime) L.push('作成: ' + fmtDate(ctx.ctime));
  if (ctx.path) L.push('場所: ' + ctx.path);
  return L;
}
