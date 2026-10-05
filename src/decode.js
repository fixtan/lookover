// decode.js — ファイルの中身 (バイト列) を、描ける絵 (ImageBitmap) にする
//
// ふつうの形式 (PNG / JPEG / WebP / GIF / BMP / AVIF / ICO) は、ブラウザの機能でそのまま開ける。
// ブラウザが開けない形式 (HEIC / JXL / RAW など) は、あとから registerDecoder で足せるようにしてある。

const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg',
  webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', avif: 'image/avif',
  ico: 'image/x-icon', svg: 'image/svg+xml',
};

import { parseInfo, HEAD_BYTES } from './info.js';

// 追加のデコーダー。拡張子 → (bytes) => Promise<ImageBitmap>
const extra = new Map();

export function registerDecoder(exts, fn) {
  for (const e of exts) extra.set(e, fn);
}

// 開ける拡張子かどうか (フォルダの一覧から画像だけを拾うのに使う)
export const isImageExt = (ext) => ext in MIME || extra.has(ext);

export const mimeOf = (ext) => MIME[ext] || 'application/octet-stream';

// bytes: ArrayBuffer、ext: 拡張子 (小文字)。
// 返すのは { bitmap, width, height, anim, info }。失敗したら例外。
//   info  : ファイルの先頭から読んだ形式・撮影情報 (info.js)。読めなければ null
//   bitmap: 絵 (動く画像なら、最初の 1 コマ)
//   anim  : 動く画像なら { bytes, type, frames }、そうでなければ null
export async function decode(bytes, ext) {
  if (extra.has(ext)) {
    const bitmap = await extra.get(ext)(bytes);
    return { bitmap, width: bitmap.width, height: bitmap.height, anim: null, info: headInfo(bytes, ext) };
  }
  const blob = new Blob([bytes], { type: mimeOf(ext) });
  const bitmap = ext === 'svg' ? await decodeViaImg(blob) : await decodeBlob(blob);
  return { bitmap, width: bitmap.width, height: bitmap.height, anim: await probeAnim(bytes, ext), info: headInfo(bytes, ext) };
}

// 先頭だけを見て、形式や撮影情報を読む (info.js)。失敗しても開くのには関係ない。
function headInfo(bytes, ext) {
  try { return parseInfo(new Uint8Array(bytes, 0, Math.min(bytes.byteLength, HEAD_BYTES)), ext); } catch (e) { return null; }
}

// 動く画像 (コマが 2 つ以上ある GIF / WebP) かどうかを調べる。
// 調べるのに ImageDecoder を使う。無い環境では、動かない画像として扱う。
async function probeAnim(bytes, ext) {
  if (ext !== 'gif' && ext !== 'webp') return null;
  if (typeof ImageDecoder === 'undefined') return null;
  try {
    const type = mimeOf(ext);
    if (!(await ImageDecoder.isTypeSupported(type))) return null;
    const dec = new ImageDecoder({ data: bytes, type });
    await dec.tracks.ready; // これを待たないと、コマの情報がまだ空
    await dec.completed;    // 全部読み終わるまで、コマ数が確定しない
    const t = dec.tracks.selectedTrack;
    const frames = t ? t.frameCount : 0, animated = !!t && t.animated && frames > 1;
    dec.close();
    return animated ? { bytes, type, frames } : null;
  } catch (e) {
    return null;
  }
}

// Blob (貼り付けられた画像など) から
export async function decodeBlob(blob) {
  try {
    // 写真に入っている「撮ったときの向き」を反映して開く
    return await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch (e) {
    // createImageBitmap が開けない形式でも、<img> なら開けることがある
    return await decodeViaImg(blob);
  }
}

// <img> に読ませてから ImageBitmap にする (SVG はこの道しか通れない)
async function decodeViaImg(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    // 大きさを持たない SVG は 0 × 0 になるので、仮の大きさを与える
    const w = img.naturalWidth || 1024, h = img.naturalHeight || 1024;
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    cv.getContext('2d').drawImage(img, 0, 0, w, h);
    return await createImageBitmap(cv);
  } finally {
    URL.revokeObjectURL(url);
  }
}
