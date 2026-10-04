// export.js — 絵をファイルの形 (WebP / JPEG / PNG) にする

import { exists, dirname, stem, extname, join } from './backend.js';

export const FORMATS = {
  webp: { mime: 'image/webp', ext: 'webp', lossy: true, label: 'WebP' },
  jpeg: { mime: 'image/jpeg', ext: 'jpg', lossy: true, label: 'JPEG' },
  png: { mime: 'image/png', ext: 'png', lossy: false, label: 'PNG' },
};

// 拡張子から、書き出せる形式を決める。書き出せない形式なら null。
export function formatOfExt(ext) {
  if (ext === 'jpg' || ext === 'jpeg' || ext === 'jfif') return 'jpeg';
  if (ext === 'png' || ext === 'webp') return ext;
  return null;
}

// この WebView が WebP に書き出せるか。Windows (WebView2) は書き出せるが、
// Mac (WKWebView) や Linux (WebKitGTK) は書き出せず、黙って PNG を返してくる。
let webpOk = null;
export async function canEncodeWebp() {
  if (webpOk === null) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 1;
    const blob = await new Promise((ok) => cv.toBlob(ok, 'image/webp', 0.8));
    webpOk = !!blob && blob.type === 'image/webp';
  }
  return webpOk;
}

// 頼まれた形式で書き出せるか確かめて、だめなら JPEG にする。{ format, fellBack } を返す。
export async function usableFormat(format) {
  if (format === 'webp' && !(await canEncodeWebp())) return { format: 'jpeg', fellBack: true };
  return { format, fellBack: false };
}

// 絵を、指定の形式のバイト列にする。quality は 1 〜 100 (PNG では使わない)。
export async function encode(src, w, h, format, quality) {
  const f = FORMATS[format];
  if (!f) throw new Error('知らない形式: ' + format);
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  if (format === 'jpeg') {
    // JPEG は透明を持てない。透明な部分が黒くならないよう、白を敷いておく。
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, w, h);
  }
  g.drawImage(src, 0, 0, w, h);
  const blob = await new Promise((ok) => cv.toBlob(ok, f.mime, f.lossy ? quality / 100 : undefined));
  // 対応していない形式を頼むと、黙って PNG で返してくるブラウザがある
  if (!blob || blob.type !== f.mime) throw new Error(`${f.label} に書き出せない`);
  return { blob, bytes: new Uint8Array(await blob.arrayBuffer()) };
}

// path がすでにあるか、avoid (元の画像) と同じなら、-2, -3 … を付けて、空いている名前を探す
export async function uniquePath(path, avoid = '') {
  if (path !== avoid && !(await exists(path))) return path;
  const dir = dirname(path), s = stem(path), e = extname(path);
  for (let n = 2; n < 10000; n++) {
    const p = join(dir, `${s}-${n}.${e}`);
    if (p !== avoid && !(await exists(p))) return p;
  }
  throw new Error('空いている名前が見つからない');
}

export function fmtBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
  return (n / 1048576).toFixed(2) + ' MB';
}
