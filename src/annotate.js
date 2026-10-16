// annotate.js — 目印 (枠・矢印) の見た目: 描き方、道具ごとの設定、登録 (プリセット)
//
// 目印は、edit.marks の中の 1 つの記録として持つ。書き出しのときは、edit.js が絵を作る途中でここの
// drawPen を呼んで、絵に焼き込む。あとから線を動かしたり直したりする「レイヤー」は持たない。
//
// 目印 1 つの見た目の項目 (どれも m の上に直接置く):
//   color   : 線の色
//   lw      : 線の太さ (px)。矢印では「いちばん太いところ」
//   opacity : 不透明度 (10 〜 100)
//   shadow  : 影をつけるか
//   dash    : 枠だけ。点線にするか
//   radius  : 枠だけ。角の丸み (px)
//   taper   : 矢印だけ。根もとを細く、先へ向かって太くするか
// lw が無い目印は、以前の版で作ったもの。そのときの見た目 (太さは size ÷ 4、矢じりだけ別に塗る) で描く。
//
// 吹き出し・文字 (callout) は、箱・尖り・文字を 1 つの目印にまとめたもの。上の項目に加えて、
//   x y w h : 箱 (文字を入れて、はみ出した分を隠す範囲。箱なしでも、つまみと当たりの範囲として持つ)
//   tx ty   : 尖りの先端 (箱の外にあるときだけ、尖りを描く)
//   text    : 文字 (改行は \n)。fs = 文字の大きさ (絵の画素)
//   color   : 縁の色、fill : 塗りの色、textColor : 文字の色、radius : 箱の角の丸み
//   glow    : 光彩の広がり (0 でなし。色は縁の色)、root : 尖りの根もとの太さ (辺の長さに対する割合)
//   box tip : 箱を描くか、尖りを描くか (どちらも false なら、文字だけ)、outline : 文字を縁取るか、font : 字体の名前

export const PEN_TOOLS = ['frame', 'arrow', 'callout'];

export const PEN_DEFAULT = {
  frame: { color: '#ff3b30', lw: 4, opacity: 100, shadow: false, dash: false, radius: 0 },
  arrow: { color: '#ff3b30', lw: 6, opacity: 100, shadow: false, taper: true },
  callout: {
    color: '#ffffff', lw: 4, opacity: 100, shadow: true, radius: 20,
    fill: '#8fd14f', textColor: '#111111', glow: 0, root: 0.3,
    box: true, tip: true, outline: false, font: 'gothic',
  },
};

export const PEN_LIMITS = { lw: [1, 40], opacity: [10, 100], radius: [0, 80], glow: [0, 40], root: [0.1, 0.9] };

// 字体。名前で持つので、別の PC (mac / Linux) で開いても、その環境の近い字体になる
export const FONTS = {
  gothic: "'Yu Gothic UI','Meiryo UI','Hiragino Sans','Noto Sans CJK JP',sans-serif",
  mincho: "'Yu Mincho','Hiragino Mincho ProN','Noto Serif CJK JP',serif",
  mono: "'BIZ UDGothic','MS Gothic','Noto Sans Mono CJK JP',monospace",
};
export const LINE_H = 1.25; // 行の高さ (文字の大きさに対する倍率)
export const PRESET_SLOTS = 5;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const num = (v, d) => (Number.isFinite(Number(v)) && v !== '' && v !== null ? Number(v) : d);

// 保存してあった設定が欠けていても、壊れていても、使える形にする
export function normStyle(tool, s) {
  const d = PEN_DEFAULT[tool], o = s && typeof s === 'object' ? s : {};
  const out = {
    color: /^#[0-9a-fA-F]{6}$/.test(o.color) ? o.color : d.color,
    lw: Math.round(clamp(num(o.lw, d.lw), ...PEN_LIMITS.lw)),
    opacity: Math.round(clamp(num(o.opacity, d.opacity), ...PEN_LIMITS.opacity)),
    shadow: o.shadow === undefined ? d.shadow : !!o.shadow,
  };
  if (tool === 'frame') {
    out.dash = o.dash === undefined ? d.dash : !!o.dash;
    out.radius = Math.round(clamp(num(o.radius, d.radius), ...PEN_LIMITS.radius));
  } else if (tool === 'arrow') {
    out.taper = o.taper === undefined ? d.taper : !!o.taper;
  } else if (tool === 'callout') {
    const hex = (v, dv) => (/^#[0-9a-fA-F]{6}$/.test(v) ? v : dv);
    out.radius = Math.round(clamp(num(o.radius, d.radius), ...PEN_LIMITS.radius));
    out.fill = hex(o.fill, d.fill);
    out.textColor = hex(o.textColor, d.textColor);
    out.glow = Math.round(clamp(num(o.glow, d.glow), ...PEN_LIMITS.glow));
    out.root = Math.round(clamp(num(o.root, d.root), ...PEN_LIMITS.root) * 100) / 100;
    out.box = o.box === undefined ? d.box : !!o.box;
    out.tip = o.tip === undefined ? d.tip : !!o.tip;
    out.outline = o.outline === undefined ? d.outline : !!o.outline;
    out.font = FONTS[o.font] ? o.font : d.font;
  }
  return out;
}

// 目印 m の見た目を、設定の形で取り出す (以前の版の目印も、そのときの見た目のまま)
export function styleOfMark(m) {
  if (m.lw !== undefined) return normStyle(m.type, m);
  return normStyle(m.type, { color: m.color, lw: Math.max(1, Math.round((m.size || 16) / 4)), opacity: 100, shadow: false, dash: false, radius: 0, taper: false });
}

// 目印に、見た目を丸ごと当てる。以前の版の目印も、これで新しい形になる。
export function applyStyle(m, style) {
  Object.assign(m, normStyle(m.type, style));
  return m;
}

// ---- 描く ----

function roundRectPath(g, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  if (r < 0.5) { g.rect(x, y, w, h); return; }
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function applyShadow(g, lw) {
  g.shadowColor = 'rgba(0, 0, 0, 0.55)';
  g.shadowBlur = Math.max(3, lw * 1.2);
  g.shadowOffsetX = 0;
  g.shadowOffsetY = Math.max(1, lw * 0.35);
}

// 矢印の外形 (多角形の頂点)。a = 根もと、b = 先端。1 つの塗りにまとめるので、不透明度をかけても重なりで濃くならない。
export function arrowPolygon(ax, ay, bx, by, lw, taper) {
  const len = Math.hypot(bx - ax, by - ay) || 1, ux = (bx - ax) / len, uy = (by - ay) / len, nx = -uy, ny = ux;
  const head = Math.min(len * 0.6, Math.max(lw * 3.5, 12)); // 矢じりの長さ
  const hw = head * 0.5;                                    // 矢じりの根もとの半幅
  const sw = Math.min(lw, head * 0.9) / 2;                   // 軸の太いほうの半幅 (矢じりの根もと側)
  const tw = taper ? Math.max(0.4, sw * 0.12) : sw;          // 軸の根もと側の半幅
  const px = bx - ux * head, py = by - uy * head;
  return [
    [ax + nx * tw, ay + ny * tw], [px + nx * sw, py + ny * sw], [px + nx * hw, py + ny * hw], [bx, by],
    [px - nx * hw, py - ny * hw], [px - nx * sw, py - ny * sw], [ax - nx * tw, ay - ny * tw],
  ];
}

// 以前の版の矢印 (太さ t の線 + 別塗りの矢じり)。見た目を変えないため、そのまま残す。
function drawLegacyArrow(g, r, m) {
  const t = Math.max(1, Math.round(Math.max(2, m.size || 16) / 4));
  g.save();
  g.strokeStyle = g.fillStyle = m.color || '#ff3b30';
  g.lineWidth = t;
  const cs = [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]];
  const d = m.dir || 0, [ax, ay] = cs[d], [bx, by] = cs[(d + 2) % 4];
  const len = Math.hypot(bx - ax, by - ay) || 1, ux = (bx - ax) / len, uy = (by - ay) / len;
  const head = Math.min(len * 0.6, Math.max(t * 4, 14));
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(ax, ay);
  g.lineTo(bx - ux * head * 0.8, by - uy * head * 0.8);
  g.stroke();
  g.beginPath();
  g.moveTo(bx, by);
  g.lineTo(bx - ux * head - uy * head * 0.45, by - uy * head + ux * head * 0.45);
  g.lineTo(bx - ux * head + uy * head * 0.45, by - uy * head - ux * head * 0.45);
  g.closePath();
  g.fill();
  g.restore();
}

// 枠・矢印を 1 つ、g に描く。r は絵の中に収めた範囲 { x, y, w, h }。
export function drawPen(g, m, r) {
  if (m.lw === undefined) {
    if (m.type === 'arrow') { drawLegacyArrow(g, r, m); return; }
    // 以前の版の枠は、新しい描き方に以前の値 (太さ size ÷ 4、角丸なし) を渡せば同じ見た目になる
  }
  const s = styleOfMark(m);
  g.save();
  g.globalAlpha = s.opacity / 100;
  if (s.shadow) applyShadow(g, s.lw);
  if (m.type === 'frame') {
    const t = s.lw;
    // 線が範囲の内側に収まるように、太さの半分だけ内へ寄せる
    roundRectPath(g, r.x + t / 2, r.y + t / 2, Math.max(0, r.w - t), Math.max(0, r.h - t), s.radius);
    g.strokeStyle = s.color;
    g.lineWidth = t;
    g.lineJoin = s.radius ? 'round' : 'miter';
    if (s.dash) { g.setLineDash([t * 3, t * 2]); g.lineCap = 'butt'; }
    g.stroke();
  } else if (m.type === 'arrow') {
    const cs = [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]];
    const d = m.dir || 0, [ax, ay] = cs[d], [bx, by] = cs[(d + 2) % 4];
    const pts = arrowPolygon(ax, ay, bx, by, s.lw, s.taper);
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    g.fillStyle = s.color;
    g.fill();
  }
  g.restore();
}

// ---- 吹き出し・文字 ----

// 尖りの形。先端が箱の外にあるときだけ { edge, a, b, tx, ty, rad } を返す (箱の中、箱なし、尖りなしなら null)。
//   edge : 根もとのある辺 ('t' 上、'r' 右、'b' 下、'l' 左)。先端が、箱の中心から見てどちらへ寄っているかで決める。
//   a → b : 根もとの 2 点。箱のまわりを時計回りに進む向き。根もとの中心は、辺の中央。
//   rad  : 角の丸み。根もとが辺の直線部分に収まるように、必要なら小さくする。
// m は箱 (x y w h) と tx ty root radius box tip を持つ目印。r は箱の範囲。
export function calloutTip(m, r) {
  if (m.box === false || m.tip === false || m.tx === undefined || m.ty === undefined) return null;
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  const nx = (m.tx - cx) / (r.w / 2), ny = (m.ty - cy) / (r.h / 2);
  if (Math.abs(nx) <= 1 && Math.abs(ny) <= 1) return null;
  const k = clamp(num(m.root, PEN_DEFAULT.callout.root), ...PEN_LIMITS.root);
  const sideways = Math.abs(nx) >= Math.abs(ny);
  const len = sideways ? r.h : r.w;
  const half = (len * k) / 2;
  const rad = Math.max(0, Math.min(num(m.radius, 0), r.w / 2, r.h / 2, (len * (1 - k)) / 2));
  let edge, a, b;
  if (sideways && nx > 0) { edge = 'r'; a = [r.x + r.w, cy - half]; b = [r.x + r.w, cy + half]; }
  else if (sideways) { edge = 'l'; a = [r.x, cy + half]; b = [r.x, cy - half]; }
  else if (ny > 0) { edge = 'b'; a = [cx + half, r.y + r.h]; b = [cx - half, r.y + r.h]; }
  else { edge = 't'; a = [cx - half, r.y]; b = [cx + half, r.y]; }
  return { edge, a, b, tx: m.tx, ty: m.ty, rad };
}

// 画面の点 p が、吹き出しの上か (箱と、尖り)。pad = 広げる幅 (絵の画素)。尖りは、先へ行くほど細くなる円錐で近似する。
export function calloutHit(m, p, pad) {
  if (p.x >= m.x - pad && p.x <= m.x + m.w + pad && p.y >= m.y - pad && p.y <= m.y + m.h + pad) return true;
  const t = calloutTip(m, m);
  if (!t) return false;
  const ax = (t.a[0] + t.b[0]) / 2, ay = (t.a[1] + t.b[1]) / 2;
  const half = Math.hypot(t.b[0] - t.a[0], t.b[1] - t.a[1]) / 2;
  const dx = t.tx - ax, dy = t.ty - ay, len2 = dx * dx + dy * dy || 1;
  const s = clamp(((p.x - ax) * dx + (p.y - ay) * dy) / len2, 0, 1);
  return Math.hypot(p.x - (ax + dx * s), p.y - (ay + dy * s)) <= half * (1 - s) + pad;
}

// 箱と尖りを、1 本の線 (パス) にまとめる。塗りも縁も光彩も、これ 1 つにかかる。
function calloutPath(g, r, rad, tip) {
  const { x, y, w, h } = r;
  const R = tip ? tip.rad : Math.max(0, Math.min(rad, w / 2, h / 2));
  const spike = (e) => { if (tip && tip.edge === e) { g.lineTo(...tip.a); g.lineTo(tip.tx, tip.ty); g.lineTo(...tip.b); } };
  g.beginPath();
  g.moveTo(x + R, y);
  spike('t');
  g.lineTo(x + w - R, y); if (R) g.arcTo(x + w, y, x + w, y + R, R);
  spike('r');
  g.lineTo(x + w, y + h - R); if (R) g.arcTo(x + w, y + h, x + w - R, y + h, R);
  spike('b');
  g.lineTo(x + R, y + h); if (R) g.arcTo(x, y + h, x, y + h - R, R);
  spike('l');
  g.lineTo(x, y + R); if (R) g.arcTo(x, y, x + R, y, R);
  g.closePath();
}

const fontOf = (s, fs) => `bold ${fs}px ${FONTS[s.font] || FONTS.gothic}`;

// 文字を、箱の中に、中央そろえで描く。箱からはみ出した分は描かない (箱でクリップする)。
function paintCalloutText(g, m, r, s) {
  const text = String(m.text || '');
  if (!text) return;
  const fs = m.fs > 0 ? m.fs : 24;
  g.save();
  g.beginPath(); g.rect(r.x, r.y, r.w, r.h); g.clip();
  g.font = fontOf(s, fs);
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
  const lines = text.split('\n'), lh = fs * LINE_H, cx = r.x + r.w / 2;
  let y = r.y + r.h / 2 - (lines.length * lh) / 2 + lh / 2;
  const n = parseInt(s.textColor.slice(1), 16), lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  for (const line of lines) {
    if (s.outline) { g.strokeStyle = lum < 0.5 ? '#ffffff' : '#000000'; g.lineWidth = fs * 0.16; g.strokeText(line, cx, y); }
    g.fillStyle = s.textColor;
    g.fillText(line, cx, y);
    y += lh;
  }
  g.restore();
}

// 不透明度 100% で描く。o は、目印に見た目を重ねたもの。
function paintCallout(g, o, r, s) {
  g.save();
  if (s.box) {
    const tip = calloutTip(o, r);
    const noShadow = () => { g.shadowColor = 'rgba(0,0,0,0)'; g.shadowBlur = 0; g.shadowOffsetX = 0; g.shadowOffsetY = 0; };
    calloutPath(g, r, s.radius, tip);
    // 光彩 → 影 → 本体 → 縁。影も光彩も 1 回ずつ描くので、塗りは不透明のまま
    if (s.glow) { g.shadowColor = s.color; g.shadowBlur = s.glow; g.fillStyle = s.fill; g.fill(); noShadow(); }
    if (s.shadow) { applyShadow(g, s.lw); g.fillStyle = s.fill; g.fill(); noShadow(); }
    g.fillStyle = s.fill; g.fill();
    g.lineWidth = s.lw; g.lineJoin = 'round'; g.strokeStyle = s.color;
    g.stroke();
  }
  g.restore();
  paintCalloutText(g, o, r, s);
}

// 吹き出し・文字を 1 つ、g に描く。r は絵の中に収めた箱の範囲 { x, y, w, h }。
export function drawCallout(g, m, r) {
  const s = styleOfMark(m), o = { ...m, ...s };
  if (s.opacity >= 100) { paintCallout(g, o, r, s); return; }
  // 不透明度をかけるときは、いったん別の絵に描いてから重ねる (塗り・縁・影が重なって濃くならないように)
  const tip = s.box ? calloutTip(o, r) : null;
  const M = Math.ceil(s.glow * 2 + s.lw + 40), cw = g.canvas.width, ch = g.canvas.height;
  const x0 = Math.max(0, Math.floor(Math.min(r.x, tip ? tip.tx : r.x) - M)), y0 = Math.max(0, Math.floor(Math.min(r.y, tip ? tip.ty : r.y) - M));
  const x1 = Math.min(cw, Math.ceil(Math.max(r.x + r.w, tip ? tip.tx : 0) + M)), y1 = Math.min(ch, Math.ceil(Math.max(r.y + r.h, tip ? tip.ty : 0) + M));
  if (x1 <= x0 || y1 <= y0) return;
  const c = document.createElement('canvas');
  c.width = x1 - x0; c.height = y1 - y0;
  const cg = c.getContext('2d');
  cg.translate(-x0, -y0);
  paintCallout(cg, o, r, s);
  g.save(); g.globalAlpha = s.opacity / 100; g.drawImage(c, x0, y0); g.restore();
}

// 文字の大きさ (絵の画素)。文字が箱いっぱいに収まる大きさを返す。箱を作って文字を入れた直後に、1 回だけ使う。
let measureCtx = null;
export function fitFontSize(text, w, h, fontKey = 'gothic') {
  const lines = String(text).split('\n');
  let widest = 0;
  if (typeof document !== 'undefined') {
    measureCtx = measureCtx || document.createElement('canvas').getContext('2d');
    measureCtx.font = `bold 100px ${FONTS[fontKey] || FONTS.gothic}`;
    for (const l of lines) widest = Math.max(widest, measureCtx.measureText(l).width);
  } else {
    for (const l of lines) widest = Math.max(widest, [...l].length * 100); // 測れない環境 (試験など): 1 文字 = 全角の幅
  }
  const pad = Math.max(2, Math.min(w, h) * 0.1);
  const byW = ((w - 2 * pad) / Math.max(1, widest)) * 100;
  const byH = (h - 2 * pad) / (lines.length * LINE_H);
  return Math.round(clamp(Math.min(byW, byH), 6, 400));
}

// 箱を作った直後の、尖りの先端。箱の下 (下に余地がなければ上) にして、あとからつまみで動かす。
export function defaultTip(r, W, H) {
  const d = Math.max(24, Math.min(r.h * 0.7, 120));
  let ty = r.y + r.h + d;
  if (ty > H) ty = r.y - d;
  return { tx: clamp(r.x + r.w / 2, 0, W), ty: clamp(ty, 0, H) };
}

// ---- 道具ごとの設定と、登録 (プリセット) ----
//
// settings.pen        : { frame: 設定, arrow: 設定 }  最後に使った設定。描くたびにこれが使われ、変えるとすぐ覚える
// settings.penPresets : { frame: [設定 か null × 5], arrow: [...] }  数字キー 1 〜 5 で呼び出す登録

export function penStyle(settings, tool) {
  return normStyle(tool, settings.pen && settings.pen[tool]);
}

export function setPenStyle(settings, tool, patch) {
  settings.pen = settings.pen || {};
  settings.pen[tool] = normStyle(tool, { ...penStyle(settings, tool), ...patch });
  return settings.pen[tool];
}

export function presetOf(settings, tool, i) {
  const list = settings.penPresets && settings.penPresets[tool];
  return list && list[i] ? normStyle(tool, list[i]) : null;
}

export function savePreset(settings, tool, i, style) {
  settings.penPresets = settings.penPresets || {};
  const list = (settings.penPresets[tool] = Array.from({ length: PRESET_SLOTS }, (_, k) => (settings.penPresets[tool] || [])[k] || null));
  list[i] = normStyle(tool, style);
}

// 登録の中身を一言で (ボタンの吹き出し用)
export function describeStyle(tool, s) {
  if (tool === 'callout') {
    const parts = [s.box ? `箱 ${s.fill}` + (s.tip ? '・尖り' : '') : '文字だけ', `文字 ${s.textColor}`];
    if (s.box) parts.push(`縁 ${s.color} 太さ ${s.lw}`);
    if (s.opacity < 100) parts.push(`不透明度 ${s.opacity}%`);
    if (s.glow) parts.push(`光彩 ${s.glow}`);
    if (s.outline) parts.push('文字の縁取り');
    return parts.join(' ／ ');
  }
  const parts = [s.color, `太さ ${s.lw}`];
  if (s.opacity < 100) parts.push(`不透明度 ${s.opacity}%`);
  if (s.shadow) parts.push('影');
  if (tool === 'frame') { if (s.dash) parts.push('点線'); if (s.radius) parts.push(`角丸 ${s.radius}`); }
  else if (tool === 'arrow' && s.taper) parts.push('先細り');
  return parts.join(' ／ ');
}
