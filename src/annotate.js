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

export const PEN_TOOLS = ['frame', 'arrow'];

export const PEN_DEFAULT = {
  frame: { color: '#ff3b30', lw: 4, opacity: 100, shadow: false, dash: false, radius: 0 },
  arrow: { color: '#ff3b30', lw: 6, opacity: 100, shadow: false, taper: true },
};

export const PEN_LIMITS = { lw: [1, 40], opacity: [10, 100], radius: [0, 80] };
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
  } else {
    out.taper = o.taper === undefined ? d.taper : !!o.taper;
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
  } else {
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
  const parts = [s.color, `太さ ${s.lw}`];
  if (s.opacity < 100) parts.push(`不透明度 ${s.opacity}%`);
  if (s.shadow) parts.push('影');
  if (tool === 'frame') { if (s.dash) parts.push('点線'); if (s.radius) parts.push(`角丸 ${s.radius}`); }
  else if (s.taper) parts.push('先細り');
  return parts.join(' ／ ');
}
