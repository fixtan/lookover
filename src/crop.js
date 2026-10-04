// crop.js — 切り抜きの範囲を、マウスで決める
//
// 範囲は { x, y, w, h } (絵の上の座標)。
// 四隅と四辺の「つまみ」を引くと大きさが変わり、中を引くと位置が動き、外を引くと新しく描き直す。
// 縦横比を固定しているときは、引いている点の反対側を基準にして、比率を保つ。

const HIT = 9; // つまみに触れたとみなす距離 (画面の px)

// つまみの名前。n = 上、s = 下、w = 左、e = 右。
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const CURSORS = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', move: 'move', new: 'crosshair' };

export class CropTool {
  constructor(view) {
    this.view = view;
    this.active = false;
    this.W = 0; this.H = 0;   // 絵の大きさ (この中にしか範囲を置けない)
    this.rect = null;
    this.aspect = 0;          // 幅 ÷ 高さ。0 なら自由
    this.drag = null;
    this.onChange = null;     // 範囲が変わったら呼ぶ
  }

  start(rect, W, H) {
    this.active = true;
    this.W = W; this.H = H;
    this.rect = rect ? { ...rect } : { x: 0, y: 0, w: W, h: H };
    this.drag = null;
    this.changed();
  }

  stop() { this.active = false; this.drag = null; this.view.draw(); }

  // 範囲が絵の全体と同じか (同じなら、切り抜かないのと同じ)
  get isFull() {
    const r = this.rounded();
    return r.x === 0 && r.y === 0 && r.w === this.W && r.h === this.H;
  }

  // 整数にした範囲
  rounded() {
    const r = this.rect;
    const x = Math.max(0, Math.min(this.W - 1, Math.round(r.x)));
    const y = Math.max(0, Math.min(this.H - 1, Math.round(r.y)));
    return { x, y, w: Math.max(1, Math.min(this.W - x, Math.round(r.w))), h: Math.max(1, Math.min(this.H - y, Math.round(r.h))) };
  }

  setRect(r) {
    this.rect = { x: r.x, y: r.y, w: r.w, h: r.h };
    this.fitInside();
    this.changed();
  }

  // 縦横比を変える。いまの範囲の中心を保って、比率に合う最大の形にする。
  setAspect(a) {
    this.aspect = a;
    if (!a || !this.rect) return;
    const r = this.rect, cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    let w = r.w, h = r.w / a;
    if (h > r.h) { h = r.h; w = h * a; }
    this.rect = { x: cx - w / 2, y: cy - h / 2, w, h };
    this.fitInside();
    this.changed();
  }

  // 絵からはみ出していたら、中へ戻す
  fitInside() {
    const r = this.rect;
    r.w = Math.max(1, Math.min(this.W, r.w));
    r.h = Math.max(1, Math.min(this.H, r.h));
    r.x = Math.max(0, Math.min(this.W - r.w, r.x));
    r.y = Math.max(0, Math.min(this.H - r.h, r.y));
  }

  changed() {
    this.view.draw();
    if (this.onChange) this.onChange(this.rounded());
  }

  // 画面の点 (sx, sy) が、どのつまみに当たっているか
  hit(sx, sy) {
    const v = this.view, r = this.rect;
    const a = v.toScreen(r.x, r.y), b = v.toScreen(r.x + r.w, r.y + r.h);
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const pts = { nw: [a.x, a.y], n: [mx, a.y], ne: [b.x, a.y], e: [b.x, my], se: [b.x, b.y], s: [mx, b.y], sw: [a.x, b.y], w: [a.x, my] };
    // 角を先に見る (角と辺が近いときは、角を優先)
    for (const k of ['nw', 'ne', 'se', 'sw', 'n', 'e', 's', 'w']) {
      if (Math.abs(sx - pts[k][0]) <= HIT && Math.abs(sy - pts[k][1]) <= HIT) return k;
    }
    // 辺の上 (つまみ以外の場所) でも、辺として扱う
    const inX = sx >= a.x - HIT && sx <= b.x + HIT, inY = sy >= a.y - HIT && sy <= b.y + HIT;
    if (inX && Math.abs(sy - a.y) <= HIT / 2) return 'n';
    if (inX && Math.abs(sy - b.y) <= HIT / 2) return 's';
    if (inY && Math.abs(sx - a.x) <= HIT / 2) return 'w';
    if (inY && Math.abs(sx - b.x) <= HIT / 2) return 'e';
    if (sx > a.x && sx < b.x && sy > a.y && sy < b.y) return 'move';
    return 'new';
  }

  cursor(sx, sy) { return CURSORS[this.drag ? this.drag.h : this.hit(sx, sy)]; }

  down(sx, sy) {
    const h = this.hit(sx, sy);
    const p = this.view.toImage(sx, sy);
    this.drag = { h, px: p.x, py: p.y, r0: { ...this.rect } };
    if (h === 'new') {
      // 押した点を、新しい範囲の「動かない角」にする
      const x = Math.max(0, Math.min(this.W, p.x)), y = Math.max(0, Math.min(this.H, p.y));
      this.drag = { h: 'se', px: x, py: y, r0: { x, y, w: 0, h: 0 } };
    }
  }

  move(sx, sy) {
    const d = this.drag;
    if (!d) return;
    const p = this.view.toImage(sx, sy);
    const px = Math.max(0, Math.min(this.W, p.x)), py = Math.max(0, Math.min(this.H, p.y));
    const r0 = d.r0;

    if (d.h === 'move') {
      this.rect = { x: r0.x + (p.x - d.px), y: r0.y + (p.y - d.py), w: r0.w, h: r0.h };
      this.fitInside();
      this.changed();
      return;
    }

    // 動かす辺だけを、マウスの位置に合わせる。x0〜x1、y0〜y1 が新しい範囲。
    let x0 = r0.x, x1 = r0.x + r0.w, y0 = r0.y, y1 = r0.y + r0.h;
    if (d.h.includes('w')) x0 = px;
    if (d.h.includes('e')) x1 = px;
    if (d.h.includes('n')) y0 = py;
    if (d.h.includes('s')) y1 = py;

    if (this.aspect) {
      const a = this.aspect;
      if (d.h.length === 2) {
        // 角: 反対側の角を基準にして、比率に合わせる。
        const ax = d.h.includes('w') ? r0.x + r0.w : r0.x, ay = d.h.includes('n') ? r0.y + r0.h : r0.y;
        const sxn = px >= ax ? 1 : -1, syn = py >= ay ? 1 : -1;
        let w = Math.abs(px - ax), h = Math.abs(py - ay);
        if (w / a > h) h = w / a; else w = h * a;
        // 絵からはみ出すなら、はみ出さない大きさまで縮める (比率は保つ)
        const maxW = sxn > 0 ? this.W - ax : ax, maxH = syn > 0 ? this.H - ay : ay;
        const k = Math.min(1, maxW / Math.max(w, 1e-6), maxH / Math.max(h, 1e-6));
        w *= k; h *= k;
        x0 = sxn > 0 ? ax : ax - w; x1 = x0 + w;
        y0 = syn > 0 ? ay : ay - h; y1 = y0 + h;
      } else if (d.h === 'e' || d.h === 'w') {
        // 左右の辺: 反対側の辺を基準に幅が決まるので、高さを比率から出す。上下は中心を保つ。
        const ax = d.h === 'e' ? r0.x : r0.x + r0.w, dir = px >= ax ? 1 : -1;
        const cy = r0.y + r0.h / 2;
        let w = Math.min(Math.abs(px - ax), dir > 0 ? this.W - ax : ax), h = w / a;
        const lim = 2 * Math.min(cy, this.H - cy); // 中心を保ったまま取れる高さの上限
        if (h > lim) { h = lim; w = h * a; }
        x0 = dir > 0 ? ax : ax - w; x1 = x0 + w;
        y0 = cy - h / 2; y1 = cy + h / 2;
      } else {
        // 上下の辺: 反対側の辺を基準に高さが決まるので、幅を比率から出す。左右は中心を保つ。
        const ay = d.h === 's' ? r0.y : r0.y + r0.h, dir = py >= ay ? 1 : -1;
        const cx = r0.x + r0.w / 2;
        let h = Math.min(Math.abs(py - ay), dir > 0 ? this.H - ay : ay), w = h * a;
        const lim = 2 * Math.min(cx, this.W - cx);
        if (w > lim) { w = lim; h = w / a; }
        y0 = dir > 0 ? ay : ay - h; y1 = y0 + h;
        x0 = cx - w / 2; x1 = cx + w / 2;
      }
    }

    // 辺を反対側まで引いたときは、左右 (上下) が入れ替わる
    this.rect = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.max(1, Math.abs(x1 - x0)), h: Math.max(1, Math.abs(y1 - y0)) };
    this.fitInside();
    this.changed();
  }

  up() {
    const was = this.drag;
    this.drag = null;
    if (was && this.rect) {
      // 小数のまま持っていると、表示と実際の切り抜きがずれるので、離したときに整数へそろえる
      if (!this.aspect) this.rect = this.rounded();
      this.changed();
    }
  }

  // キーで 1 画素ずつ動かす
  nudge(dx, dy) {
    this.rect.x += dx; this.rect.y += dy;
    this.fitInside();
    this.changed();
  }

  // 絵の上に、範囲の外を暗くした幕と、枠・つまみを描く
  draw(g) {
    if (!this.active || !this.rect) return;
    const v = this.view, r = this.rounded();
    const a = v.toScreen(r.x, r.y), b = v.toScreen(r.x + r.w, r.y + r.h);
    const o = v.toScreen(0, 0), e = v.toScreen(this.W, this.H);
    g.save();
    g.fillStyle = 'rgba(0, 0, 0, 0.6)';
    g.fillRect(o.x, o.y, e.x - o.x, a.y - o.y);          // 上
    g.fillRect(o.x, b.y, e.x - o.x, e.y - b.y);          // 下
    g.fillRect(o.x, a.y, a.x - o.x, b.y - a.y);          // 左
    g.fillRect(b.x, a.y, e.x - b.x, b.y - a.y);          // 右

    // 三分割の線 (構図の目安)
    g.strokeStyle = 'rgba(255, 255, 255, 0.28)';
    g.lineWidth = 1;
    g.beginPath();
    for (const t of [1 / 3, 2 / 3]) {
      const x = Math.round(a.x + (b.x - a.x) * t) + 0.5, y = Math.round(a.y + (b.y - a.y) * t) + 0.5;
      g.moveTo(x, a.y); g.lineTo(x, b.y);
      g.moveTo(a.x, y); g.lineTo(b.x, y);
    }
    g.stroke();

    g.strokeStyle = '#ffffff';
    g.strokeRect(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5, Math.round(b.x - a.x) - 1, Math.round(b.y - a.y) - 1);

    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const pts = { nw: [a.x, a.y], n: [mx, a.y], ne: [b.x, a.y], e: [b.x, my], se: [b.x, b.y], s: [mx, b.y], sw: [a.x, b.y], w: [a.x, my] };
    g.fillStyle = '#ffffff';
    g.strokeStyle = '#101216';
    for (const k of HANDLES) {
      const [x, y] = pts[k];
      g.fillRect(Math.round(x) - 4, Math.round(y) - 4, 8, 8);
      g.strokeRect(Math.round(x) - 4.5, Math.round(y) - 4.5, 9, 9);
    }

    // 大きさを枠のそばに出す
    const label = `${r.w} × ${r.h}`;
    g.font = '12px "Segoe UI", sans-serif';
    const tw = g.measureText(label).width + 10;
    const lx = Math.max(o.x, Math.min(e.x - tw, a.x)), ly = a.y - 22 > 0 ? a.y - 22 : a.y + 4;
    g.fillStyle = 'rgba(16, 18, 22, 0.85)';
    g.fillRect(lx, ly, tw, 18);
    g.fillStyle = '#ffffff';
    g.textBaseline = 'middle';
    g.fillText(label, lx + 5, ly + 9);
    g.restore();
  }
}
