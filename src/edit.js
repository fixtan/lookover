// edit.js — 編集の内容と、それを絵に反映する処理 (向き・隠す・切り抜き・大きさ)
//
// 編集は「元の絵を書き換える」のではなく、「何をするかの一覧」として持つ。
// 画面に出すときも書き出すときも、元の絵にこの一覧を順に当てて、結果を作り直す。
// だから、後から切り抜きをやり直したり、全部取り消したりできる。
//
// 当てる順番は決まっている。
//   元の絵 → 向き (回転・反転) → 隠す (モザイクなど) → 切り抜き → 大きさ → 色 (adjust.js)
//
// 切り抜きの範囲と、隠す範囲は、「向きを変えた後・切り抜く前」の絵の上の座標で持つ。

export const ADJ_KEYS = ['brightness', 'contrast', 'saturation', 'temperature', 'tint', 'highlights', 'shadows', 'sharpen'];

export function emptyEdit() {
  const adj = {};
  for (const k of ADJ_KEYS) adj[k] = 0;
  return {
    rot: 0,        // 右回りに何度回すか (0 / 90 / 180 / 270)
    flip: false,   // 回す前に、左右を反転するか
    crop: null,    // { x, y, w, h } か、切り抜かないなら null
    resize: null,  // { mode: 'width' | 'height' | 'long' | 'percent', value } か null
    adj,           // 色の調整。どれも -100 〜 100 (sharpen は 0 〜 100)
    // 絵の上に描き足すもの。隠す (mosaic / blur / fill) と、目印 (frame = 枠、arrow = 矢印)。
    //   [{ type, x, y, w, h, size, color, dir }]
    //   size : モザイクの 1 マスの大きさ・ぼかしの強さ・線の太さのもと
    //   dir  : 矢印だけ。範囲の四角の、どの角から対角へ向かうか (0 = 左上、1 = 右上、2 = 右下、3 = 左下)
    marks: [],
  };
}

export const cloneEdit = (e) => JSON.parse(JSON.stringify(e));

export const hasAdjust = (e) => ADJ_KEYS.some((k) => e.adj[k] !== 0);

export function isIdentity(e) {
  return e.rot === 0 && !e.flip && !e.crop && !e.resize && !e.marks.length && !hasAdjust(e);
}

// 向きを変えた後の大きさ。90 度か 270 度なら、縦と横が入れ替わる。
export function orientedSize(w, h, e) {
  return e.rot % 180 ? { w: h, h: w } : { w, h };
}

// 範囲を、絵の中に収まる整数にする
export function clampRect(r, W, H) {
  let x = Math.round(r.x), y = Math.round(r.y);
  let w = Math.round(r.w), h = Math.round(r.h);
  x = Math.max(0, Math.min(W - 1, x));
  y = Math.max(0, Math.min(H - 1, y));
  w = Math.max(1, Math.min(W - x, w));
  h = Math.max(1, Math.min(H - y, h));
  return { x, y, w, h };
}

// 実際に切り抜く範囲 (切り抜きなしなら全体)
export function cropRect(w, h, e) {
  const o = orientedSize(w, h, e);
  return e.crop ? clampRect(e.crop, o.w, o.h) : { x: 0, y: 0, w: o.w, h: o.h };
}

// 「大きさ」の指定から、実際の縦横を出す。cw × ch は切り抜いた後の大きさ。
export function resizeTarget(cw, ch, rs) {
  if (!rs || !(rs.value > 0)) return { w: cw, h: ch };
  let k = 1;
  if (rs.mode === 'width') k = rs.value / cw;
  else if (rs.mode === 'height') k = rs.value / ch;
  else if (rs.mode === 'long') k = rs.value / Math.max(cw, ch);
  else if (rs.mode === 'percent') k = rs.value / 100;
  return { w: Math.max(1, Math.round(cw * k)), h: Math.max(1, Math.round(ch * k)) };
}

// 編集を全部当てた後の大きさ
export function outputSize(w, h, e) {
  const c = cropRect(w, h, e);
  return resizeTarget(c.w, c.h, e.resize);
}

// ---- 向きを変える ----
//
// 向きは (rot, flip) の 2 つで表す。意味は「まず左右反転 (flip なら)、そのあと rot 度回す」。
// 回転と反転を何回重ねても、この形 1 つにまとまる。
//
// 向きを変えると、切り抜きや隠す範囲も一緒に回さないと、違う場所を指してしまう。
// W × H は「変える前の、向きを反映した大きさ」。

// 矢印の「どの角から出るか」も、絵と一緒に回す。
// 右へ 90 度回すと、左上にあったものは右上へ行く (0 → 1 → 2 → 3 → 0)。
const DIR_CW = [1, 2, 3, 0], DIR_CCW = [3, 0, 1, 2], DIR_FLIP_H = [1, 0, 3, 2], DIR_FLIP_V = [3, 2, 1, 0];
const dirOf = (r, map) => (r.dir === undefined ? {} : { dir: map[r.dir] });

const rectCW = (r, W, H) => ({ ...r, x: H - r.y - r.h, y: r.x, w: r.h, h: r.w, ...dirOf(r, DIR_CW) });
const rectCCW = (r, W, H) => ({ ...r, x: r.y, y: W - r.x - r.w, w: r.h, h: r.w, ...dirOf(r, DIR_CCW) });
const rectFlipH = (r, W, H) => ({ ...r, x: W - r.x - r.w, ...dirOf(r, DIR_FLIP_H) });
const rectFlipV = (r, W, H) => ({ ...r, y: H - r.y - r.h, ...dirOf(r, DIR_FLIP_V) });

function mapRects(e, fn, W, H) {
  if (e.crop) e.crop = fn(e.crop, W, H);
  e.marks = e.marks.map((m) => fn(m, W, H));
}

// dir: +1 = 右へ 90 度、-1 = 左へ 90 度。w × h は元の絵の大きさ。新しい編集を返す。
export function rotate(edit, dir, w, h) {
  const e = cloneEdit(edit);
  const o = orientedSize(w, h, e);
  mapRects(e, dir > 0 ? rectCW : rectCCW, o.w, o.h);
  e.rot = (e.rot + (dir > 0 ? 90 : 270)) % 360;
  return e;
}

// axis: 'h' = 左右反転、'v' = 上下反転 (いま見えている絵に対して)
export function flip(edit, axis, w, h) {
  const e = cloneEdit(edit);
  const o = orientedSize(w, h, e);
  mapRects(e, axis === 'h' ? rectFlipH : rectFlipV, o.w, o.h);
  // 「回してから左右反転」は、「左右反転してから逆向きに回す」と同じ。
  // 上下反転は、「左右反転 + 180 度」と同じ。
  e.rot = (360 - e.rot) % 360;
  e.flip = !e.flip;
  if (axis === 'v') e.rot = (e.rot + 180) % 360;
  return e;
}

// ---- 絵を作る ----

function newCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// 縮めるときは、半分ずつ何回かに分ける。
// 一度に大きく縮めると、細い線が飛んだり、ざらついたりするため。
function scaleTo(src, sw, sh, tw, th) {
  let cur = src, cw = sw, ch = sh;
  while (cw / 2 >= tw && ch / 2 >= th && (cw / 2 > tw || ch / 2 > th)) {
    const nw = Math.max(tw, Math.round(cw / 2)), nh = Math.max(th, Math.round(ch / 2));
    const c = newCanvas(nw, nh);
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(cur, 0, 0, cw, ch, 0, 0, nw, nh);
    cur = c; cw = nw; ch = nh;
  }
  if (cw === tw && ch === th && cur !== src) return cur;
  const c = newCanvas(tw, th);
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(cur, 0, 0, cw, ch, 0, 0, tw, th);
  return c;
}

// 隠す場所を 1 つ描く。cv は向きを変えた後の絵。
function drawMark(cv, m) {
  const g = cv.getContext('2d');
  const r = clampRect(m, cv.width, cv.height);
  if (m.type === 'fill') {
    g.fillStyle = m.color || '#000000';
    g.fillRect(r.x, r.y, r.w, r.h);
    return;
  }
  const size = Math.max(2, m.size || 16);
  if (m.type === 'frame' || m.type === 'arrow') {
    const t = Math.max(1, Math.round(size / 4)); // 線の太さ
    g.save();
    g.strokeStyle = g.fillStyle = m.color || '#ff3b30';
    g.lineWidth = t;
    if (m.type === 'frame') {
      // 線が範囲の内側に収まるように、太さの半分だけ内へ寄せる
      g.strokeRect(r.x + t / 2, r.y + t / 2, Math.max(0, r.w - t), Math.max(0, r.h - t));
    } else {
      const cs = [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]];
      const d = m.dir || 0, [ax, ay] = cs[d], [bx, by] = cs[(d + 2) % 4];
      const len = Math.hypot(bx - ax, by - ay) || 1, ux = (bx - ax) / len, uy = (by - ay) / len;
      const head = Math.min(len * 0.6, Math.max(t * 4, 14)); // 矢じりの長さ
      // 軸 (矢じりの付け根まで)
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(ax, ay);
      g.lineTo(bx - ux * head * 0.8, by - uy * head * 0.8);
      g.stroke();
      // 矢じり (先端と、その手前の左右の 2 点を結んだ三角)
      g.beginPath();
      g.moveTo(bx, by);
      g.lineTo(bx - ux * head - uy * head * 0.45, by - uy * head + ux * head * 0.45);
      g.lineTo(bx - ux * head + uy * head * 0.45, by - uy * head - ux * head * 0.45);
      g.closePath();
      g.fill();
    }
    g.restore();
    return;
  }
  if (m.type === 'mosaic') {
    // 小さく縮めてから、ぼかさずに引き伸ばす。1 マスが size 画素の四角になる。
    const tw = Math.max(1, Math.ceil(r.w / size)), th = Math.max(1, Math.ceil(r.h / size));
    const t = newCanvas(tw, th);
    const tg = t.getContext('2d');
    tg.imageSmoothingQuality = 'high';
    tg.drawImage(cv, r.x, r.y, r.w, r.h, 0, 0, tw, th);
    g.save();
    g.imageSmoothingEnabled = false;
    g.drawImage(t, 0, 0, tw, th, r.x, r.y, r.w, r.h);
    g.restore();
    return;
  }
  // ぼかし。範囲を少し広めに写し取って、ぼかしてから、範囲の中だけに描き戻す。
  // (広めに取らないと、縁が薄くなる)
  const pad = Math.ceil(size * 2);
  const sx = Math.max(0, r.x - pad), sy = Math.max(0, r.y - pad);
  const ex = Math.min(cv.width, r.x + r.w + pad), ey = Math.min(cv.height, r.y + r.h + pad);
  const t = newCanvas(ex - sx, ey - sy);
  t.getContext('2d').drawImage(cv, sx, sy, ex - sx, ey - sy, 0, 0, ex - sx, ey - sy);
  g.save();
  g.beginPath();
  g.rect(r.x, r.y, r.w, r.h);
  g.clip();
  if ('filter' in g) {
    g.filter = `blur(${size * 0.75}px)`;
    g.drawImage(t, sx, sy);
  } else {
    // filter が使えない環境: 縮めてから、なめらかに引き伸ばして代わりにする
    const k = Math.max(2, size / 2);
    const s = scaleTo(t, t.width, t.height, Math.max(1, Math.round(t.width / k)), Math.max(1, Math.round(t.height / k)));
    g.imageSmoothingQuality = 'high';
    g.drawImage(s, 0, 0, s.width, s.height, sx, sy, t.width, t.height);
  }
  g.restore();
}

// 元の絵に、向き・隠す・切り抜き・大きさを当てた絵を作る。色の調整はここではしない。
//   bmp, w, h : 元の絵と、その大きさ
//   opt.noCrop: true なら、切り抜きと大きさを当てない (切り抜きの範囲を選んでいる最中の表示用)
// 返すのは { src, w, h }。何も当てるものがなければ、元の絵をそのまま返す。
export function renderGeometry(bmp, w, h, e, opt = {}) {
  const o = orientedSize(w, h, e);
  const needOrient = e.rot !== 0 || e.flip || e.marks.length > 0;

  let cur = bmp, cw = w, ch = h;
  if (needOrient) {
    const c = newCanvas(o.w, o.h);
    const g = c.getContext('2d');
    // 絵の中心を原点にして、反転 → 回転 の順に当てる。
    // (canvas の変形は、書いた順と逆に効く。だから rotate を先に書く)
    g.translate(o.w / 2, o.h / 2);
    g.rotate((e.rot * Math.PI) / 180);
    if (e.flip) g.scale(-1, 1);
    g.drawImage(bmp, -w / 2, -h / 2);
    g.setTransform(1, 0, 0, 1, 0, 0);
    for (const m of e.marks) drawMark(c, m);
    cur = c; cw = o.w; ch = o.h;
  }
  if (opt.noCrop) return { src: cur, w: cw, h: ch };

  if (e.crop) {
    const r = clampRect(e.crop, cw, ch);
    if (r.w !== cw || r.h !== ch) {
      const c = newCanvas(r.w, r.h);
      c.getContext('2d').drawImage(cur, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
      cur = c; cw = r.w; ch = r.h;
    }
  }
  const t = resizeTarget(cw, ch, e.resize);
  if (t.w !== cw || t.h !== ch) {
    cur = scaleTo(cur, cw, ch, t.w, t.h);
    cw = t.w; ch = t.h;
  }
  return { src: cur, w: cw, h: ch };
}

// 書き出しプリセット用: 長い辺が long を超えていたら、そこまで縮める (引き伸ばしはしない)
export function fitLong(src, w, h, long) {
  if (!(long > 0) || Math.max(w, h) <= long) return { src, w, h };
  const k = long / Math.max(w, h);
  const tw = Math.max(1, Math.round(w * k)), th = Math.max(1, Math.round(h * k));
  return { src: scaleTo(src, w, h, tw, th), w: tw, h: th };
}
