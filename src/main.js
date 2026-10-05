// main.js — 全体の組み立て。キーやマウスを受けて、各部品に仕事を頼む。
//
//   backend.js … ディスクと窓 (Rust 側へ頼む)
//   folder.js  … フォルダの中の画像の並び
//   view.js    … 絵を画面に出す。拡大・ずらす
//   edit.js    … 編集の内容と、向き・隠す・切り抜き・大きさの反映
//   adjust.js  … 色の調整
//   crop.js    … 切り抜きの範囲を選ぶ操作
//   export.js  … ファイルの形にする
//   ui.js      … お知らせ・確認・一覧

import * as be from './backend.js';
import { dirname, basename, extname, stem, join } from './backend.js';
import { Folder } from './folder.js';
import { decodeBlob } from './decode.js';
import { formatInfo } from './info.js';
import { View } from './view.js';
import {
  ADJ_KEYS, emptyEdit, cloneEdit, isIdentity, hasAdjust, orientedSize, clampRect, cropRect,
  resizeTarget, rotate, flip, renderGeometry, fitLong,
} from './edit.js';
import { applyAdjust } from './adjust.js';
import { CropTool } from './crop.js';
import { FORMATS, formatOfExt, encode, usableFormat, uniquePath, fmtBytes } from './export.js';
import { settings, saveSettings } from './settings.js';
import { toast, confirmBox, promptBox, showHelp, editKeys, setKeysHook, editPresets, modalOpen } from './ui.js';
import { Player } from './anim.js';
import { specOf, baseKey, actionFor, bindingsOf, firstLabel } from './keys.js';

const $ = (id) => document.getElementById(id);
const cv = $('view');

const view = new View(cv);
const folder = new Folder();
const crop = new CropTool(view);
const adjCanvas = document.createElement('canvas'); // 色を調整した後の絵を置く場所 (使い回す)

folder.sort = settings.sort;

// いま開いている 1 枚についての状態
const S = {
  item: null,          // { name, path, size, mtime, ctime }。貼り付けた画像は { virtual: true, path: '' }
  bmp: null, bw: 0, bh: 0, // 元の絵と、その大きさ
  edit: emptyEdit(),   // 編集の内容
  hist: [emptyEdit()], // 取り消し用の履歴
  hpos: 0,             // 履歴のどこにいるか
  tool: null,          // 使っている道具: null | 'crop' | 'mosaic' | 'blur' | 'fill'
  geom: null, geomKey: '', // 向き・切り抜きなどを当てた絵と、その条件 (同じ条件なら作り直さない)
  out: null,           // 画面に出している絵 { src, w, h }
  showOriginal: false, // 元の絵を一時的に見ているか
  selMark: -1,         // 選んでいる「隠す場所」の番号
  drag: null,          // マウスで引いている最中の情報
  loading: false,      // 読み込みに時間がかかっている最中か
  seq: 0,              // 読み込みの通し番号 (古い読み込みの結果を捨てるため)
  full: false,
  anim: null,          // 動く画像なら { bytes, type, frames }
  player: null,        // 再生中なら Player
  frame: null,         // いま画面に出しているコマ
};

// ほかの画像へ移っても、編集の内容を覚えておく。path → { edit, hist, hpos }
const kept = new Map();

const MARK_TOOLS = ['mosaic', 'blur', 'fill', 'frame', 'arrow'];
const PEN_TOOLS = ['frame', 'arrow']; // 隠すのではなく、目印を描く道具 (色は penColor)
const TOOL_NAMES = { mosaic: 'モザイク', blur: 'ぼかし', fill: '塗りつぶし', frame: '枠', arrow: '矢印' };
const isMarkTool = () => MARK_TOOLS.includes(S.tool);

// ======================================================================
// 絵を作って、画面に出す
// ======================================================================

// 編集の内容から絵を作り直して、画面に出す。
// keep = true なら、拡大率と位置を保つ。
function rebuild(keep = true) {
  if (!S.bmp) {
    stopAnim();
    S.out = null;
    view.setSource(null, 0, 0);
    updateUI();
    return;
  }
  if (S.showOriginal) {
    stopAnim();
    view.setSource(S.bmp, S.bw, S.bh, true);
    updateUI();
    return;
  }
  const e = S.edit, cropMode = S.tool === 'crop';
  // 切り抜きの範囲を選んでいる間は、切り抜く前の全体を出す
  const key = JSON.stringify([e.rot, e.flip, e.marks, cropMode ? 0 : [e.crop, e.resize]]);
  const same = key === S.geomKey && !!S.geom;
  if (!same) {
    S.geom = renderGeometry(S.bmp, S.bw, S.bh, e, { noCrop: cropMode });
    S.geomKey = key;
  }
  let out = S.geom;
  if (hasAdjust(e)) {
    applyAdjust(S.geom.src, S.geom.w, S.geom.h, e.adj, adjCanvas, same);
    out = { src: adjCanvas, w: S.geom.w, h: S.geom.h };
  }
  S.out = out;
  view.setSource(out.src, out.w, out.h, keep);
  syncAnim();
  updateUI();
}

// 動く画像の再生。編集していない・道具を使っていないときだけ動かす。
// (編集は最初の 1 コマに対して行うので、編集中に動いていると、何を直しているのか分からなくなる)
function syncAnim() {
  const want = !!S.bmp && !!S.anim && isIdentity(S.edit) && !S.tool && !S.showOriginal;
  if (want && !S.player) {
    S.player = new Player(S.anim, (frame) => {
      const old = S.frame;
      S.frame = frame;
      view.setSource(frame, frame.displayWidth, frame.displayHeight, true);
      // 前のコマは、次の描画が済んでから閉じる (描く前に閉じると、一瞬何も出なくなる)
      if (old) requestAnimationFrame(() => requestAnimationFrame(() => old.close()));
    });
  } else if (!want && S.player) {
    stopAnim();
  }
}

function stopAnim() {
  if (S.player) { S.player.stop(); S.player = null; }
  if (S.frame) {
    const f = S.frame;
    S.frame = null;
    // 画面がまだこのコマを出しているなら、止まった絵に差し替えてから閉じる
    if (view.src === f && S.out) view.setSource(S.out.src, S.out.w, S.out.h, true);
    requestAnimationFrame(() => requestAnimationFrame(() => f.close()));
  }
}

// 書き出す絵。切り抜きの範囲を選んでいる最中なら、先に決定する。
function finalOut() {
  if (S.tool === 'crop') cropApply();
  if (S.showOriginal) { S.showOriginal = false; rebuild(); }
  return S.out;
}

// ======================================================================
// 開く・送る
// ======================================================================

// いまの編集を覚えておく (ほかの画像へ移る前に呼ぶ)
function stash() {
  const it = S.item;
  if (!it || it.virtual) return;
  if (S.hist.length > 1) kept.set(it.path, { edit: S.edit, hist: S.hist, hpos: S.hpos });
  else kept.delete(it.path);
}

// 1 枚を画面に出す状態にする。bmp が null なら「開けなかった」。
function setImage(item, bmp, w, h, anim = null, info = null) {
  stash();
  stopAnim();
  S.item = item; S.bmp = bmp; S.bw = w; S.bh = h; S.anim = anim; S.info = info;
  const k = item && !item.virtual ? kept.get(item.path) : null;
  if (k) { S.edit = k.edit; S.hist = k.hist; S.hpos = k.hpos; }
  else { S.edit = emptyEdit(); S.hist = [emptyEdit()]; S.hpos = 0; }
  if (S.tool === 'crop') crop.stop();
  S.tool = null; S.selMark = -1; S.showOriginal = false;
  S.geom = null; S.geomKey = '';
  view.pad = 0;
  $('empty').hidden = !!item;
  rebuild(false);
  syncPanel();
  drawInfo();
}

// フォルダが指している 1 枚を読んで出す
async function show() {
  const item = folder.current;
  const seq = ++S.seq;
  if (!item) { setImage(null, null, 0, 0); return; }
  // 読むのに時間がかかるときだけ、「読み込み中」と出す (すぐ出る画像でちらつかないように)
  const slow = setTimeout(() => { if (seq === S.seq) { S.loading = true; updateUI(); } }, 150);
  try {
    const d = await folder.load1(item);
    clearTimeout(slow);
    S.loading = false;
    if (seq !== S.seq) return; // 読んでいる間に、別の画像へ送られた
    folder.pinned = item.path;
    setImage(item, d.bitmap, d.width, d.height, d.anim, d.info);
    folder.preload();
  } catch (err) {
    clearTimeout(slow);
    S.loading = false;
    if (seq !== S.seq) return;
    setImage(item, null, 0, 0);
    toast(`開けない: ${item.name}\n${err && err.message ? err.message : err}`, { err: true });
  }
}

// ファイルかフォルダを開く
async function openPath(path) {
  try {
    await folder.open(path);
    settings.lastDir = folder.dir;
    saveSettings();
    if (!folder.count) toast('このフォルダに画像がない: ' + folder.dir, { err: true });
    await show();
  } catch (err) {
    toast(`開けない: ${path}\n${err && err.message ? err.message : err}`, { err: true });
  }
}

// ファイルを持たない絵 (貼り付けた画像など) を開く
async function openBlob(blob, name) {
  try {
    const bmp = await decodeBlob(blob);
    S.seq++;
    setImage({ name, path: '', size: blob.size, mtime: Date.now(), virtual: true }, bmp, bmp.width, bmp.height);
  } catch (err) {
    toast('開けない: ' + (err && err.message ? err.message : err), { err: true });
  }
}

function go(step) {
  // 貼り付けた画像を見ているときは、フォルダの「いまの 1 枚」へ戻る
  if (S.item && S.item.virtual) { if (folder.current) show(); return; }
  if (folder.move(step)) show();
}

function goto(i) {
  if (S.item && S.item.virtual) { if (folder.current) { folder.index = Math.max(0, Math.min(folder.count - 1, i)); show(); } return; }
  if (folder.goto(i)) show();
}

// フォルダを読み直して、いまの 1 枚も読み直す (外で書き換えられたとき用)
async function reload() {
  if (!S.item || S.item.virtual) return;
  try {
    stash();
    folder.forget(S.item.path);
    S.item = null;
    await folder.refresh();
    await show();
  } catch (err) {
    toast('読み直せない: ' + (err && err.message ? err.message : err), { err: true });
  }
}

async function pickAndOpen() {
  const p = await be.pickOpen();
  if (p) openPath(p);
}

// 貼り付けた画像に付ける名前。clip-20261004-173000.png のような形。
function clipName() {
  const d = new Date(), z = (n) => String(n).padStart(2, '0');
  return `clip-${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}.png`;
}

// ======================================================================
// 編集
// ======================================================================

// 編集を 1 回ぶん確定して、履歴に積む
function commit() {
  S.hist = S.hist.slice(0, S.hpos + 1);
  S.hist.push(cloneEdit(S.edit));
  if (S.hist.length > 200) S.hist.shift();
  S.hpos = S.hist.length - 1;
}

function jumpHistory(pos) {
  if (pos < 0 || pos >= S.hist.length) return;
  S.hpos = pos;
  S.edit = cloneEdit(S.hist[pos]);
  S.selMark = -1;
  if (S.tool === 'crop') restartCrop();
  rebuild(true);
  syncPanel();
}
const undo = () => jumpHistory(S.hpos - 1);
const redo = () => jumpHistory(S.hpos + 1);

function resetAll() {
  if (!S.bmp || isIdentity(S.edit)) return;
  if (S.tool === 'crop') cropCancel();
  S.edit = emptyEdit();
  S.selMark = -1;
  commit();
  rebuild(false);
  syncPanel();
}

function doRotate(dir) {
  if (!S.bmp) return;
  S.edit = rotate(S.edit, dir, S.bw, S.bh);
  commit();
  if (S.tool === 'crop') restartCrop();
  rebuild(false);
  syncPanel();
}

function doFlip(axis) {
  if (!S.bmp) return;
  S.edit = flip(S.edit, axis, S.bw, S.bh);
  commit();
  if (S.tool === 'crop') restartCrop();
  rebuild(true);
  syncPanel();
}

// ---- 道具の切り替え ----

function setTool(t) {
  if (!S.bmp) return;
  if (S.tool === t) t = null; // 同じ道具をもう一度選んだら、やめる
  if (S.tool === 'crop') { cropCancel(); }
  S.tool = t;
  S.selMark = -1;
  if (t === 'crop') {
    restartCrop();
    rebuild(false);
  } else {
    view.draw();
  }
  // 道具を使うときは、設定が見えるようにパネルを出す
  if (t && $('panel').hidden) togglePanel(true);
  updateUI();
}

// ---- 切り抜き ----

function aspectValue() {
  const v = $('crop-aspect').value;
  if (v === 'free') return 0;
  const o = orientedSize(S.bw, S.bh, S.edit);
  if (v === 'orig') return o.w / o.h;
  const [a, b] = v.split(':').map(Number);
  return a / b;
}

// 切り抜きの道具を、いまの編集の内容で始め直す
function restartCrop() {
  const o = orientedSize(S.bw, S.bh, S.edit);
  view.pad = 24; // つまみが画面の端に掛からないよう、まわりを少し空ける
  S.geomKey = '';
  crop.start(S.edit.crop ? clampRect(S.edit.crop, o.w, o.h) : null, o.w, o.h);
  crop.setAspect(aspectValue());
}

function cropApply() {
  if (S.tool !== 'crop') return;
  S.edit.crop = crop.isFull ? null : crop.rounded();
  crop.stop();
  S.tool = null;
  view.pad = 0;
  commit();
  rebuild(false);
  syncPanel();
}

function cropCancel() {
  if (S.tool !== 'crop') return;
  crop.stop();
  S.tool = null;
  view.pad = 0;
  rebuild(false);
  syncPanel();
}

function cropClear() {
  if (S.tool === 'crop') { crop.stop(); S.tool = null; view.pad = 0; }
  if (S.edit.crop) { S.edit.crop = null; commit(); }
  rebuild(false);
  syncPanel();
}

crop.onChange = (r) => {
  // 入力欄を、いまの範囲に合わせる (入力中の欄は触らない)
  for (const [id, v] of [['crop-x', r.x], ['crop-y', r.y], ['crop-w', r.w], ['crop-h', r.h]]) {
    if (document.activeElement !== $(id)) $(id).value = v;
  }
};

// ---- 大きさ ----

function setResize(mode, value) {
  if (!S.bmp) return;
  const rs = mode === 'none' || !(value > 0) ? null : { mode, value };
  if (JSON.stringify(rs) === JSON.stringify(S.edit.resize)) return;
  S.edit.resize = rs;
  commit();
  rebuild(true);
  syncPanel();
}

// ---- 隠す (モザイク・ぼかし・塗りつぶし) ----
//
// 画面に出ている絵は、切り抜きと大きさを当てた後のもの。
// 隠す場所は「切り抜く前」の座標で持つので、行き来するための換算が要る。

function outToOri(p) {
  const c = cropRect(S.bw, S.bh, S.edit), o = S.out;
  return { x: c.x + (p.x * c.w) / o.w, y: c.y + (p.y * c.h) / o.h };
}
function oriToOut(p) {
  const c = cropRect(S.bw, S.bh, S.edit), o = S.out;
  return { x: ((p.x - c.x) * o.w) / c.w, y: ((p.y - c.y) * o.h) / c.h };
}

// 画面の点が、どの「隠す場所」の上にあるか。上に描かれたものを優先する。
function markAt(sx, sy) {
  const p = outToOri(view.toImage(sx, sy));
  for (let i = S.edit.marks.length - 1; i >= 0; i--) {
    const m = S.edit.marks[i];
    if (p.x >= m.x && p.x <= m.x + m.w && p.y >= m.y && p.y <= m.y + m.h) return i;
  }
  return -1;
}

function markDown(sx, sy) {
  const i = markAt(sx, sy);
  const p = outToOri(view.toImage(sx, sy));
  S.selMark = i;
  if (i >= 0) S.drag = { kind: 'markMove', i, px: p.x, py: p.y, m0: { ...S.edit.marks[i] }, cur: { ...S.edit.marks[i] } };
  else S.drag = { kind: 'markNew', x0: p.x, y0: p.y, x1: p.x, y1: p.y };
  view.draw();
  syncPanel();
}

function markMove(sx, sy) {
  const d = S.drag, p = outToOri(view.toImage(sx, sy));
  if (d.kind === 'markNew') { d.x1 = p.x; d.y1 = p.y; }
  else { d.cur.x = d.m0.x + (p.x - d.px); d.cur.y = d.m0.y + (p.y - d.py); }
  view.draw();
}

function markUp() {
  const d = S.drag;
  S.drag = null;
  const o = orientedSize(S.bw, S.bh, S.edit);
  if (d.kind === 'markNew') {
    const x = Math.min(d.x0, d.x1), y = Math.min(d.y0, d.y1), w = Math.abs(d.x1 - d.x0), h = Math.abs(d.y1 - d.y0);
    // 矢印は、真横や真下にも引けるように、長さで判定する。ほかは、縦横とも 3 画素以上。
    const big = S.tool === 'arrow' ? Math.hypot(w, h) >= 8 : w >= 3 && h >= 3;
    if (big) {
      const r = clampRect({ x, y, w, h }, o.w, o.h);
      const m = { type: S.tool, ...r, size: settings.markSize, color: PEN_TOOLS.includes(S.tool) ? settings.penColor : settings.markColor };
      // 矢印は、引き始めた角を覚えておく (0 = 左上、1 = 右上、2 = 右下、3 = 左下)
      if (S.tool === 'arrow') m.dir = d.x1 >= d.x0 ? (d.y1 >= d.y0 ? 0 : 3) : (d.y1 >= d.y0 ? 1 : 2);
      S.edit.marks.push(m);
      S.selMark = S.edit.marks.length - 1;
      commit();
    }
  } else if (d.cur.x !== d.m0.x || d.cur.y !== d.m0.y) {
    const r = clampRect(d.cur, o.w, o.h);
    Object.assign(S.edit.marks[d.i], { x: r.x, y: r.y });
    commit();
  }
  rebuild(true);
  syncPanel();
}

function markDelete() {
  if (S.selMark < 0) return false;
  S.edit.marks.splice(S.selMark, 1);
  S.selMark = -1;
  commit();
  rebuild(true);
  syncPanel();
  return true;
}

function markClear() {
  if (!S.edit.marks.length) return;
  S.edit.marks = [];
  S.selMark = -1;
  commit();
  rebuild(true);
  syncPanel();
}

// 隠す場所の枠を、絵の上に描く (道具を使っている間だけ)
function drawMarks(g) {
  const box = (m, color, dash) => {
    const a = oriToOut({ x: m.x, y: m.y }), b = oriToOut({ x: m.x + m.w, y: m.y + m.h });
    const p = view.toScreen(a.x, a.y), q = view.toScreen(b.x, b.y);
    g.setLineDash(dash);
    g.strokeStyle = '#101216'; g.lineWidth = 3;
    g.strokeRect(p.x, p.y, q.x - p.x, q.y - p.y);
    g.strokeStyle = color; g.lineWidth = 1;
    g.strokeRect(p.x, p.y, q.x - p.x, q.y - p.y);
  };
  g.save();
  S.edit.marks.forEach((m, i) => {
    const moving = S.drag && S.drag.kind === 'markMove' && S.drag.i === i;
    box(moving ? S.drag.cur : m, i === S.selMark ? '#ff3b6b' : '#ffffff', i === S.selMark ? [] : [4, 3]);
  });
  if (S.drag && S.drag.kind === 'markNew') {
    const d = S.drag;
    box({ x: Math.min(d.x0, d.x1), y: Math.min(d.y0, d.y1), w: Math.abs(d.x1 - d.x0), h: Math.abs(d.y1 - d.y0) }, '#ff3b6b', []);
  }
  g.restore();
}

view.overlay = (g) => {
  if (S.tool === 'crop') crop.draw(g);
  else if (isMarkTool() && S.out) drawMarks(g);
};

// ======================================================================
// 書き出す
// ======================================================================

// いまの絵を、形式と品質を指定してバイト列にする
async function encodeOut(format, quality, long = 0) {
  const o = finalOut();
  const r = fitLong(o.src, o.w, o.h, long);
  const { bytes, blob } = await encode(r.src, r.w, r.h, format, quality);
  return { bytes, blob, w: r.w, h: r.h };
}

// 書き出したあとの後始末。フォルダを読み直して、下の表示を更新する。
async function afterWrite() {
  try { await folder.refresh(); } catch (e) { /* 読み直せなくても、書き出し自体はできている */ }
  updateUI();
}

// ワンキー書き出し。n は 0 から。
async function quickExport(n) {
  const p = settings.presets[n];
  if (!p || !S.bmp) return;
  try {
    const dir = p.dir || (S.item.virtual ? folder.dir || settings.lastDir : dirname(S.item.path));
    if (!dir) { toast('書き出し先のフォルダが決まらない。「名前を付けて保存」を使う。', { err: true }); return; }
    const u = await usableFormat(p.format);
    const r = await encodeOut(u.format, p.quality, p.long);
    let path = join(dir, stem(S.item.name) + p.suffix + '.' + FORMATS[u.format].ext);
    // 元の画像そのものは、ここでは絶対に上書きしない
    if (path === S.item.path || !p.overwrite) path = await uniquePath(path, S.item.path);
    await be.writeFile(path, r.bytes);
    toast(`書き出した: ${basename(path)}\n${r.w} × ${r.h} ／ ${fmtBytes(r.bytes.length)}` + (u.fellBack ? '\nこの環境は WebP に書き出せないので、JPEG にした' : ''));
    await afterWrite();
    return path;
  } catch (err) {
    toast('書き出せない: ' + (err && err.message ? err.message : err), { err: true });
  }
}

async function saveAs() {
  if (!S.bmp) return;
  try {
    const dir = S.item.virtual ? folder.dir || settings.lastDir : dirname(S.item.path);
    const base = stem(S.item.name) + (S.item.virtual ? '' : '_edit') + '.' + FORMATS[settings.format].ext;
    let path = await be.pickSave(dir ? join(dir, base) : base);
    if (!path) return;
    // 拡張子で形式を決める。知らない拡張子・拡張子なしなら、選んである形式の拡張子を足す。
    let format = formatOfExt(extname(path));
    if (!format) { format = settings.format; path += '.' + FORMATS[format].ext; }
    // WebP に書き出せない環境では JPEG にして、拡張子も合わせる
    const u = await usableFormat(format);
    if (u.fellBack) { path = path.replace(/\.webp$/i, '') + '.' + FORMATS.jpeg.ext; format = u.format; }
    const r = await encodeOut(format, settings.quality);
    await be.writeFile(path, r.bytes);
    toast(`保存した: ${basename(path)}\n${r.w} × ${r.h} ／ ${fmtBytes(r.bytes.length)}`);
    folder.forget(path);
    await afterWrite();
    return path;
  } catch (err) {
    toast('保存できない: ' + (err && err.message ? err.message : err), { err: true });
  }
}

// 元のファイルを、編集後の絵で置き換える
async function saveOver() {
  if (!S.bmp) return;
  if (S.item.virtual) return saveAs();
  if (S.tool === 'crop') cropApply();
  if (isIdentity(S.edit)) { toast('変更がないので、保存しなかった'); return; }
  const format = formatOfExt(extname(S.item.path));
  if (!format) { toast('この形式には上書きできない。「名前を付けて保存」を使う。', { err: true }); return; }
  const ok = await confirmBox({
    title: '上書き保存',
    text: `${S.item.name} を、編集後の絵で置き換える。\n元の絵には戻せない。`,
    ok: '上書きする',
  });
  if (!ok) return;
  try {
    const path = S.item.path;
    const r = await encodeOut(format, settings.quality);
    await be.writeFile(path, r.bytes);
    // 置き換えたので、覚えていた編集と絵を捨てて、読み直す
    kept.delete(path);
    folder.forget(path);
    S.item = null;
    await folder.refresh();
    await show();
    toast(`上書きした: ${basename(path)}\n${r.w} × ${r.h} ／ ${fmtBytes(r.bytes.length)}`);
  } catch (err) {
    toast('保存できない: ' + (err && err.message ? err.message : err), { err: true });
  }
}

async function copyImage() {
  if (!S.bmp) return;
  try {
    const o = finalOut();
    const { blob } = await encode(o.src, o.w, o.h, 'png', 100);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    toast(`コピーした (${o.w} × ${o.h})`);
  } catch (err) {
    toast('コピーできない: ' + (err && err.message ? err.message : err), { err: true });
  }
}

// 名前を変える。拡張子はそのままにする (打ち込まれた名前に拡張子が無ければ、元のものを足す)。
async function renameCurrent() {
  if (!S.item || S.item.virtual) return;
  const item = S.item, ext = extname(item.name);
  const typed = await promptBox({ title: '名前を変える', value: item.name, select: [0, stem(item.name).length] });
  if (typed === null) return;
  let name = typed.trim();
  if (!name || name === item.name) return;
  if (/[\\/:*?"<>|]/.test(name)) { toast('ファイル名に使えない文字がある:  \\ / : * ? " < > |', { err: true }); return; }
  if (ext && extname(name) !== ext) name += '.' + ext;
  const to = join(dirname(item.path), name);
  try {
    await be.rename(item.path, to);
    // 覚えていた編集は、新しい名前へ引き継ぐ
    stash();
    if (kept.has(item.path)) { kept.set(to, kept.get(item.path)); kept.delete(item.path); }
    folder.forget(item.path);
    S.item = null;
    await folder.load(folder.dir);
    folder.index = Math.max(0, folder.items.findIndex((e) => e.path === to));
    await show();
    toast('名前を変えた: ' + name);
  } catch (err) {
    toast('名前を変えられない: ' + (err && err.message ? err.message : err), { err: true });
  }
}

async function removeCurrent() {
  if (!S.item || S.item.virtual) return;
  const item = S.item;
  if (settings.confirmDelete) {
    const ok = await confirmBox({ title: 'ごみ箱へ', text: `${item.name} を、ごみ箱へ送る。`, ok: 'ごみ箱へ送る' });
    if (!ok) return;
  }
  try {
    await be.trash(item.path);
    kept.delete(item.path);
    folder.forget(item.path);
    S.item = null;
    await folder.refresh();
    await show();
    toast('ごみ箱へ送った: ' + item.name);
  } catch (err) {
    toast('消せない: ' + (err && err.message ? err.message : err), { err: true });
  }
}

// ======================================================================
// 画面の表示を、状態に合わせる
// ======================================================================

const ADJ_LABELS = {
  brightness: '明るさ', contrast: 'コントラスト', saturation: '彩度', temperature: '色温度',
  tint: '色かぶり', highlights: 'ハイライト', shadows: 'シャドウ', sharpen: 'シャープ',
};

// 色のスライダーを作る (起動時に 1 回)
function buildAdjSliders() {
  const box = $('adj');
  for (const k of ADJ_KEYS) {
    const label = document.createElement('label');
    label.className = 'slider';
    label.innerHTML = `${ADJ_LABELS[k]} <span id="adj-${k}-v">0</span>`;
    const r = Object.assign(document.createElement('input'), { type: 'range', min: k === 'sharpen' ? 0 : -100, max: 100, step: 1, value: 0, id: 'adj-' + k });
    // 動かしている間は絵だけ更新して、離したときに履歴へ積む
    r.addEventListener('input', () => {
      if (!S.bmp) return;
      S.edit.adj[k] = Number(r.value);
      $(`adj-${k}-v`).textContent = r.value;
      rebuild(true);
    });
    r.addEventListener('change', () => { if (S.bmp) { commit(); updateUI(); } });
    r.addEventListener('dblclick', () => {
      if (!S.bmp || S.edit.adj[k] === 0) return;
      S.edit.adj[k] = 0;
      commit(); rebuild(true); syncPanel();
    });
    label.appendChild(r);
    box.appendChild(label);
  }
}

function buildPresetButtons() {
  const box = $('presets');
  box.textContent = '';
  settings.presets.forEach((p, i) => {
    const b = document.createElement('button');
    b.dataset.preset = i;
    const name = document.createElement('span');
    name.textContent = p.label;
    const key = document.createElement('kbd');
    key.textContent = i < 9 ? firstLabel('export' + (i + 1)) : '';
    b.append(name, key);
    b.addEventListener('click', () => quickExport(i));
    box.appendChild(b);
  });
}

// パネルの中身を、編集の内容に合わせる
function syncPanel() {
  const e = S.edit, has = !!S.bmp;
  for (const k of ADJ_KEYS) {
    $('adj-' + k).value = e.adj[k];
    $(`adj-${k}-v`).textContent = e.adj[k];
  }
  $('rs-mode').value = e.resize ? e.resize.mode : 'none';
  if (e.resize) $('rs-value').value = e.resize.value;

  if (has) {
    const c = S.tool === 'crop' ? crop.rounded() : cropRect(S.bw, S.bh, e);
    for (const [id, v] of [['crop-x', c.x], ['crop-y', c.y], ['crop-w', c.w], ['crop-h', c.h]]) {
      if (document.activeElement !== $(id)) $(id).value = v;
    }
    const cr = cropRect(S.bw, S.bh, e), t = resizeTarget(cr.w, cr.h, e.resize);
    $('rs-out').textContent = e.resize ? `${cr.w} × ${cr.h} → ${t.w} × ${t.h}` : `${cr.w} × ${cr.h}`;
    $('mark-info').textContent = e.marks.length ? `${e.marks.length} か所` + (S.selMark >= 0 ? ' ／ 1 つ選択中 (Delete で消す)' : '') : '';
  }
  $('btn-crop').classList.toggle('on', S.tool === 'crop');
  $('btn-crop-apply').disabled = S.tool !== 'crop';
  $('btn-crop-clear').disabled = !(e.crop || S.tool === 'crop');
  $('btn-mark-clear').disabled = !e.marks.length;
  for (const b of document.querySelectorAll('[data-tool]')) b.classList.toggle('on', b.dataset.tool === S.tool);
  // 色の欄: 選んでいる目印があればその色、なければ、いまの道具で使う色
  const sel = S.selMark >= 0 ? e.marks[S.selMark] : null;
  const pen = sel ? PEN_TOOLS.includes(sel.type) : PEN_TOOLS.includes(S.tool);
  $('mark-color-label').textContent = pen ? '線の色' : '塗る色';
  $('mark-color').value = sel && sel.color ? sel.color : pen ? settings.penColor : settings.markColor;
  if (sel) { $('mark-size').value = sel.size; $('mark-size-v').textContent = sel.size; }
  updateUI();
}

// 画像の情報を左上に重ねる。出すかどうかは settings.info (画像を替えても、再起動しても、そのまま)
function drawInfo() {
  const el = $('info');
  const on = settings.info && !!S.item && !!S.bmp;
  el.hidden = !on;
  if (!on) return;
  const it = S.item;
  el.textContent = formatInfo(S.info, {
    name: it.name, path: it.virtual ? '' : it.path, width: S.bw, height: S.bh,
    size: it.size, mtime: it.virtual ? 0 : it.mtime, ctime: it.ctime, frames: S.anim ? S.anim.frames : 0,
  }, { gps: settings.infoGps }, fmtBytes).join('\n');
}

function toggleInfo() { settings.info = !settings.info; saveSettings(); drawInfo(); }

let estTimer = 0, estSeq = 0;

// 下の 1 行・窓の題名・ボタンの状態を更新する
function updateUI() {
  const it = S.item;
  $('st-name').textContent = it ? it.name : '';
  $('st-pos').textContent = it && !it.virtual && folder.count ? `${folder.index + 1} / ${folder.count}` : '';
  let dim = '';
  if (S.bmp) {
    dim = `${S.bw} × ${S.bh}`;
    if (S.out && !S.showOriginal && S.tool !== 'crop' && (S.out.w !== S.bw || S.out.h !== S.bh)) dim += ` → ${S.out.w} × ${S.out.h}`;
  }
  $('st-dim').textContent = dim;
  $('st-size').textContent = it && it.size ? fmtBytes(it.size) : '';
  $('st-zoom').textContent = S.bmp ? Math.round(view.percent) + '%' : '';
  $('st-edit').hidden = !S.bmp || isIdentity(S.edit);
  $('st-tool').textContent = S.showOriginal ? '元の絵を表示中'
    : S.tool === 'crop' ? '切り抜き: Enter で決定 ／ Esc でやめる'
    : isMarkTool() ? `${TOOL_NAMES[S.tool]}: ドラッグで描く ／ Delete で消す ／ Esc で終わる`
    : S.loading ? '読み込み中…'
    : S.anim ? `動く画像 (${S.anim.frames} コマ)${S.player ? '' : ' ／ 編集中は最初の 1 コマ'}`
    : '';

  const title = it ? `${it.name}${it.virtual || !folder.count ? '' : ` [${folder.index + 1}/${folder.count}]`} - Lookover` : 'Lookover';
  if (title !== updateUI.title) { updateUI.title = title; be.setTitle(title); }

  $('btn-undo').disabled = S.hpos <= 0;
  $('btn-redo').disabled = S.hpos >= S.hist.length - 1;
  $('btn-reset').disabled = !S.bmp || isIdentity(S.edit);

  cv.classList.toggle('cross', isMarkTool());
  cv.classList.toggle('grab', !S.tool && view.pannable && !S.drag);

  // 書き出したときの大きさの見積もり。パネルを開いているときだけ、少し待ってから計算する。
  clearTimeout(estTimer);
  if (!$('panel').hidden && S.out && S.tool !== 'crop') estTimer = setTimeout(estimate, 350);
  else if (!S.out) $('ex-info').textContent = '';
}

async function estimate() {
  const seq = ++estSeq, o = S.out;
  if (!o) return;
  try {
    const { bytes } = await encode(o.src, o.w, o.h, settings.format, settings.quality);
    if (seq === estSeq) $('ex-info').textContent = `${o.w} × ${o.h} ／ 約 ${fmtBytes(bytes.length)}`;
  } catch (err) {
    if (seq === estSeq) $('ex-info').textContent = String(err && err.message ? err.message : err);
  }
}

view.onChange = updateUI;

function togglePanel(on) {
  const p = $('panel');
  p.hidden = on === undefined ? !p.hidden : !on;
  settings.panel = !p.hidden;
  saveSettings();
  view.layout();
  updateUI();
}

async function toggleFull() {
  try {
    S.full = !(await be.isFullscreen());
    await be.setFullscreen(S.full);
  } catch (e) { /* 全画面にできない環境もある */ }
  document.body.classList.toggle('full', S.full);
  view.layout();
}

// ======================================================================
// パネルのボタンと入力欄
// ======================================================================

const ACTIONS = {
  rotL: () => doRotate(-1), rotR: () => doRotate(1),
  flipH: () => doFlip('h'), flipV: () => doFlip('v'),
  crop: () => setTool('crop'), cropApply, cropClear,
  adjReset: () => {
    if (!S.bmp || !hasAdjust(S.edit)) return;
    for (const k of ADJ_KEYS) S.edit.adj[k] = 0;
    commit(); rebuild(true); syncPanel();
  },
  'mark-mosaic': () => setTool('mosaic'), 'mark-blur': () => setTool('blur'), 'mark-fill': () => setTool('fill'),
  'mark-frame': () => setTool('frame'), 'mark-arrow': () => setTool('arrow'),
  help: () => showHelp(),
  keys: () => editKeys(),
  markClear,
  save: saveOver, saveAs, copy: copyImage,
  presetEdit: async () => {
    const list = await editPresets(settings.presets);
    if (!list) return;
    settings.presets = list;
    saveSettings();
    buildPresetButtons();
  },
  undo, redo, resetAll,
};

// ボタンの吹き出しと、下の「操作の一覧」の札を、いまの割り当てに合わせる
const HINT_ACTIONS = {
  rotL: 'rotL', rotR: 'rotR', flipH: 'flipH', flipV: 'flipV', crop: 'crop',
  'mark-mosaic': 'mosaic', 'mark-blur': 'blur', 'mark-fill': 'fill', 'mark-frame': 'frame', 'mark-arrow': 'arrow',
  saveAs: 'saveAs', save: 'save', copy: 'copy', undo: 'undo', redo: 'redo', help: 'help',
};

function refreshKeyHints() {
  for (const b of document.querySelectorAll('#panel button[data-act]')) {
    const id = HINT_ACTIONS[b.dataset.act];
    if (!id) continue;
    if (b.dataset.base === undefined) b.dataset.base = b.title.replace(/\s*\(.*\)\s*$/, '').replace(/^(F1|Ctrl.*)$/, '');
    const key = firstLabel(id);
    b.title = key ? (b.dataset.base ? `${b.dataset.base} (${key})` : key) : b.dataset.base;
  }
  const hk = firstLabel('help');
  $('st-help').textContent = hk ? `操作の一覧 ${hk}` : '操作の一覧';
  buildPresetButtons();
}

function wirePanel() {
  buildAdjSliders();
  setKeysHook(refreshKeyHints);
  refreshKeyHints();

  $('panel').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.act && ACTIONS[b.dataset.act]) ACTIONS[b.dataset.act]();
    else if (b.dataset.rs) {
      // 数字のボタン: いまの指定の仕方 (幅・高さ・長い辺) のまま、値だけ入れる。未指定なら「幅」。
      const mode = $('rs-mode').value === 'none' || $('rs-mode').value === 'percent' ? 'width' : $('rs-mode').value;
      $('rs-value').value = b.dataset.rs;
      setResize(mode, Number(b.dataset.rs));
    }
    // ボタンを押したあと、キー操作が画像に効くように、ボタンから注目を外す
    b.blur();
  });

  $('crop-aspect').addEventListener('change', () => { if (S.tool === 'crop') crop.setAspect(aspectValue()); });
  for (const id of ['crop-x', 'crop-y', 'crop-w', 'crop-h']) {
    $(id).addEventListener('change', () => {
      if (!S.bmp) return;
      if (S.tool !== 'crop') setTool('crop');
      crop.setRect({ x: Number($('crop-x').value), y: Number($('crop-y').value), w: Number($('crop-w').value), h: Number($('crop-h').value) });
    });
  }

  const rs = () => setResize($('rs-mode').value, Number($('rs-value').value));
  $('rs-mode').addEventListener('change', () => {
    // ％に切り替えたとき、1920 のような値が残っていると巨大になるので、100 に直す
    if ($('rs-mode').value === 'percent' && Number($('rs-value').value) > 400) $('rs-value').value = 50;
    rs();
  });
  $('rs-value').addEventListener('change', rs);

  $('mark-size').value = settings.markSize;
  $('mark-size-v').textContent = settings.markSize;
  $('mark-color').value = settings.markColor;
  // 強さと色は、これから描く分の設定。1 つ選んでいるときは、それにも当てる。
  $('mark-size').addEventListener('input', () => {
    settings.markSize = Number($('mark-size').value);
    $('mark-size-v').textContent = settings.markSize;
    if (S.selMark >= 0) { S.edit.marks[S.selMark].size = settings.markSize; rebuild(true); }
  });
  $('mark-size').addEventListener('change', () => { saveSettings(); if (S.selMark >= 0) commit(); });
  // 色の欄は 1 つ。塗りつぶしの色と、枠・矢印の色を、道具に合わせて切り替えて使う。
  $('mark-color').addEventListener('input', () => {
    const v = $('mark-color').value, m = S.selMark >= 0 ? S.edit.marks[S.selMark] : null;
    const pen = m ? PEN_TOOLS.includes(m.type) : PEN_TOOLS.includes(S.tool);
    if (pen) settings.penColor = v; else settings.markColor = v;
    if (m && ['fill', 'frame', 'arrow'].includes(m.type)) { m.color = v; rebuild(true); }
  });
  $('mark-color').addEventListener('change', () => { saveSettings(); if (S.selMark >= 0) commit(); });

  $('set-confirm').value = settings.confirmDelete ? '1' : '0';
  $('set-confirm').addEventListener('change', () => { settings.confirmDelete = $('set-confirm').value === '1'; saveSettings(); });
  $('set-gps').value = settings.infoGps ? '1' : '0';
  $('set-gps').addEventListener('change', () => { settings.infoGps = $('set-gps').value === '1'; saveSettings(); drawInfo(); });
  $('set-wheel').value = settings.wheel;
  $('set-sort').value = settings.sort;
  $('set-wheel').addEventListener('change', () => { settings.wheel = $('set-wheel').value; saveSettings(); });
  $('set-sort').addEventListener('change', async () => {
    settings.sort = folder.sort = $('set-sort').value;
    saveSettings();
    // 並べ直しても、いま見ている画像を指したままにする
    const cur = folder.current;
    folder.order();
    if (cur) folder.index = folder.items.findIndex((e) => e.path === cur.path);
    updateUI();
  });

  $('ex-format').value = settings.format;
  $('ex-quality').value = settings.quality;
  $('ex-quality-v').textContent = settings.quality;
  $('ex-format').addEventListener('change', () => { settings.format = $('ex-format').value; saveSettings(); updateUI(); });
  $('ex-quality').addEventListener('input', () => {
    settings.quality = Number($('ex-quality').value);
    $('ex-quality-v').textContent = settings.quality;
    updateUI();
  });
  $('ex-quality').addEventListener('change', saveSettings);

  $('panel').hidden = !settings.panel;
}

// ======================================================================
// マウス
// ======================================================================

// 画面全体の座標を、canvas の左上からの座標に直す
const local = (e) => {
  const r = cv.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
};

function wirePointer() {
  cv.addEventListener('pointerdown', (e) => {
    if (!S.out || e.button === 2) return;
    const p = local(e);
    cv.setPointerCapture(e.pointerId);
    // 中ボタンは、どの道具を使っていても「ずらす」
    if (e.button === 1) { e.preventDefault(); S.drag = { kind: 'pan', x: e.clientX, y: e.clientY }; }
    else if (S.tool === 'crop') { crop.down(p.x, p.y); S.drag = { kind: 'crop' }; }
    else if (isMarkTool()) markDown(p.x, p.y);
    else if (view.pannable) S.drag = { kind: 'pan', x: e.clientX, y: e.clientY };
    if (S.drag && S.drag.kind === 'pan') cv.classList.add('grabbing');
  });

  cv.addEventListener('pointermove', (e) => {
    const p = local(e), d = S.drag;
    if (!d) {
      if (S.tool === 'crop' && crop.active) cv.style.cursor = crop.cursor(p.x, p.y);
      else cv.style.cursor = '';
      return;
    }
    if (d.kind === 'pan') { view.pan(e.clientX - d.x, e.clientY - d.y); d.x = e.clientX; d.y = e.clientY; }
    else if (d.kind === 'crop') crop.move(p.x, p.y);
    else markMove(p.x, p.y);
  });

  const end = () => {
    const d = S.drag;
    if (!d) return;
    cv.classList.remove('grabbing');
    if (d.kind === 'crop') { S.drag = null; crop.up(); }
    else if (d.kind === 'pan') { S.drag = null; updateUI(); }
    else markUp();
  };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);

  // 下の「72%」を押すと、全体 ⇔ 等倍 (ダブルクリックと同じ)
  $('st-zoom').addEventListener('click', () => {
    if (!S.out || S.tool) return;
    const one = view.actual;
    if (Math.abs(view.scale - one) < 1e-6 && view.fitScale() < one) view.fit();
    else if (view.fitScale() < one) view.zoomTo(one);
  });
  $('st-help').addEventListener('click', () => HANDLERS.help());

  cv.addEventListener('dblclick', (e) => {
    if (!S.out || S.tool) return;
    const p = local(e);
    // 等倍なら全体表示へ、そうでなければ、押した場所を中心に等倍へ
    const one = view.actual;
    if (Math.abs(view.scale - one) < 1e-6 && view.fitScale() < one) view.fit();
    else if (view.fitScale() < one) view.zoomTo(one, p.x, p.y);
  });

  // ホイール。ふだんは前後の画像へ送る。Ctrl を押しているとき・道具を使っているときは拡大。
  let acc = 0;
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (!S.out) return;
    if (e.ctrlKey || S.tool || settings.wheel === 'zoom') {
      const p = local(e);
      view.zoomBy(e.deltaY < 0 ? 1.2 : 1 / 1.2, p.x, p.y);
      return;
    }
    // タッチパッドは細かい値が何度も来るので、ためてから 1 枚送る
    acc += e.deltaY;
    if (Math.abs(acc) >= 50) { go(acc > 0 ? 1 : -1); acc = 0; }
  }, { passive: false });

  // 右クリックで、ブラウザのメニュー (戻る・再読み込みなど) を出さない。入力欄では出す (貼り付けなどに使う)。
  window.addEventListener('contextmenu', (e) => { if (!(e.target.matches && e.target.matches('input, textarea'))) e.preventDefault(); });

  // ブラウザで開いているとき (開発用): ファイルを落とすと、その絵を開く。
  // Tauri では、落とされたファイルは Rust 側が受けて、パスで知らせてくる (下の onOpenPaths)。
  window.addEventListener('dragover', (e) => { e.preventDefault(); document.body.classList.add('dropping'); });
  window.addEventListener('dragleave', () => document.body.classList.remove('dropping'));
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    document.body.classList.remove('dropping');
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f && !be.isTauri) openBlob(f, f.name);
  });

  window.addEventListener('paste', (e) => {
    if (e.target.matches && e.target.matches('input, textarea')) return;
    const it = [...(e.clipboardData ? e.clipboardData.items : [])].find((i) => i.type.startsWith('image/'));
    if (!it) return;
    e.preventDefault();
    openBlob(it.getAsFile(), clipName());
  });
}

// ======================================================================
// キー
// ======================================================================

// キーを押したときの処理。名前は keys.js の表と同じ。
// 返り値が false なら「何もしなかった」ので、ブラウザ本来の動きを止めない。
const HANDLERS = {
  next: () => go(1), prev: () => go(-1),
  first: () => goto(0), last: () => goto(folder.count - 1),
  zoomIn: () => view.zoomBy(1.25), zoomOut: () => view.zoomBy(1 / 1.25),
  fit: () => view.fit(), actual: () => view.zoomTo(view.actual),
  full: () => (S.tool === 'crop' ? cropApply() : toggleFull()),
  original: (e) => {
    if (e.repeat || !S.bmp || S.tool || isIdentity(S.edit)) return false;
    S.showOriginal = true; rebuild(true);
  },
  help: () => showHelp(),
  info: () => toggleInfo(),
  quit: () => be.closeWindow(),
  open: () => pickAndOpen(),
  copy: () => copyImage(),
  rename: () => renameCurrent(),
  remove: () => { if (!(isMarkTool() && markDelete())) { if (!S.tool) removeCurrent(); } },
  reveal: () => { if (S.item && !S.item.virtual) be.reveal(S.item.path); },
  reload: () => reload(),
  panel: () => togglePanel(),
  rotR: () => doRotate(1), rotL: () => doRotate(-1),
  flipH: () => doFlip('h'), flipV: () => doFlip('v'),
  crop: () => setTool('crop'),
  mosaic: () => setTool('mosaic'), blur: () => setTool('blur'), fill: () => setTool('fill'),
  frame: () => setTool('frame'), arrow: () => setTool('arrow'),
  undo: () => undo(), redo: () => redo(),
  save: () => saveOver(), saveAs: () => saveAs(),
  ...Object.fromEntries(Array.from({ length: 9 }, (_, i) => ['export' + (i + 1), () => quickExport(i)])),
};

function wireKeys() {
  window.addEventListener('keydown', (e) => {
    if (modalOpen()) return;
    const inField = e.target.matches && e.target.matches('input:not([type="range"]), select, textarea');
    const ctrl = e.ctrlKey || e.metaKey, k = e.key;

    if (k === 'Escape') {
      if (inField) { e.target.blur(); return; }
      if (S.tool === 'crop') cropCancel();
      else if (S.tool) setTool(S.tool);
      else if (S.full) toggleFull();
      else if (!$('panel').hidden) togglePanel(false);
      return;
    }
    if (inField) return; // 入力欄で打っている間は、ショートカットを効かせない

    // 切り抜きの範囲を選んでいる間は、矢印で 1 画素ずつ動かす (Shift で 10 画素)。割り当てより優先。
    if (S.tool === 'crop' && !ctrl && k.startsWith('Arrow')) {
      const n = e.shiftKey ? 10 : 1;
      crop.nudge(k === 'ArrowLeft' ? -n : k === 'ArrowRight' ? n : 0, k === 'ArrowUp' ? -n : k === 'ArrowDown' ? n : 0);
      e.preventDefault();
      return;
    }

    const spec = specOf(e);
    const id = spec && actionFor(spec);
    if (id && HANDLERS[id]) {
      if (HANDLERS[id](e) !== false) e.preventDefault();
      return;
    }
    // 割り当てが無いキー。ブラウザとしてのショートカット (印刷・検索・ページの拡大など) だけ止める。
    // Ctrl + V は paste イベントで受けるので止めない。Ctrl + Shift + I (開発者ツール) も残す。
    if (ctrl) {
      const lower = k.toLowerCase();
      if (lower !== 'v' && !(e.shiftKey && lower === 'i')) e.preventDefault();
    } else if (k === 'F3' || k === 'F7') {
      e.preventDefault(); // ブラウザの検索やカーソル移動モードを出さない
    }
  });

  window.addEventListener('keyup', (e) => {
    // 「押している間、元の絵を見る」のキーを離したら戻す。修飾キーが先に離れても戻るよう、キーそのものだけで比べる。
    if (!S.showOriginal) return;
    const b = baseKey(e);
    if (bindingsOf('original').some((sp) => sp === b || sp.endsWith('+' + b))) { S.showOriginal = false; rebuild(true); }
  });

  // 別の窓へ移っている間にキーを離すと、keyup が来ない。戻ってきたときに直す。
  window.addEventListener('blur', () => { if (S.showOriginal) { S.showOriginal = false; rebuild(true); } });

  // 窓に戻ってきたら、フォルダを読み直す (その間に増えたスクリーンショットなどを拾う)
  window.addEventListener('focus', async () => {
    if (!folder.dir || modalOpen()) return;
    try { await folder.refresh(); updateUI(); } catch (e) { /* フォルダが消えていても、表示は続ける */ }
  });

  document.addEventListener('fullscreenchange', () => {
    if (be.isTauri) return;
    S.full = !!document.fullscreenElement;
    document.body.classList.toggle('full', S.full);
  });
}

// ======================================================================
// 起動
// ======================================================================

async function start() {
  wirePanel();
  wirePointer();
  wireKeys();
  syncPanel();

  be.onOpenPaths((paths) => { if (paths && paths[0]) openPath(paths[0]); });

  // 試験や、コンソールからの確認用
  window.__iv = {
    S, view, folder, crop, settings, kept,
    openPath, openBlob, go, goto, rebuild, commit, undo, redo, resetAll, doRotate, doFlip, setTool,
    cropApply, cropCancel, cropClear, setResize, markDelete, markClear,
    quickExport, saveAs, saveOver, copyImage, removeCurrent, renameCurrent, togglePanel, toggleFull, syncPanel, reload,
  };

  let args = [];
  try { args = await be.startupArgs(); } catch (e) { /* 取れなくても起動は続ける */ }
  const selftest = args.find((a) => a.startsWith('--selftest='));

  try {
    const paths = await be.startupPaths();
    if (paths[0]) await openPath(paths[0]);
  } catch (err) {
    toast('起動時のファイルを開けない: ' + (err && err.message ? err.message : err), { err: true });
  }

  // 自動試験の合図があれば、試験を走らせる (ふだんは読み込まれない)
  if (selftest) (await import('./selftest.js')).run(selftest.slice('--selftest='.length), window.__iv, args);
}

start();
