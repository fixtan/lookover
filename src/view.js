// view.js — 絵を画面に出す。拡大・縮小と、ずらす操作の計算もここ。
//
// 位置の決め方は 3 つの数だけ。
//   scale : 絵の 1 画素を、画面の何 px (CSS の px) で描くか
//   ox, oy: 絵の左上が、画面のどこに来るか (px)
// 絵の上の点 (ix, iy) は、画面の (ox + ix * scale, oy + iy * scale) に描かれる。

export class View {
  constructor(canvas) {
    this.cv = canvas;
    this.g = canvas.getContext('2d');
    this.src = null;        // 描くもの (ImageBitmap か canvas)
    this.w = 0; this.h = 0; // その大きさ
    this.scale = 1; this.ox = 0; this.oy = 0;
    this.pad = 0;           // 全体表示のとき、まわりに空ける幅 (px)
    this.fitMode = true;    // true の間は、窓の大きさが変わっても全体が収まるように保つ
    this.overlay = null;    // 絵の上に重ねて描くもの (切り抜きの枠など)。(g, view) => void
    this.onChange = null;   // 拡大率が変わったときに呼ぶ
    this.raf = 0;
    this.pattern = null;
    new ResizeObserver(() => this.layout()).observe(canvas);
    this.layout();
  }

  // 画面の大きさ (CSS の px)
  get cw() { return this.cv.clientWidth; }
  get ch() { return this.cv.clientHeight; }

  // Windows の「拡大縮小 125%」などでは、CSS の 1 px が、実際の画面の 1.25 画素になる。
  // この比率を dpr と呼ぶ。「等倍」は、絵の 1 画素を、実際の画面の 1 画素で描くこと。
  // (CSS の px を基準にすると、スクリーンショットを等倍で見たときに、にじんでしまう)
  get dpr() { return window.devicePixelRatio || 1; }
  get actual() { return 1 / this.dpr; }            // 等倍のときの scale
  get percent() { return this.scale * this.dpr * 100; } // 画面に出す「何 %」

  // 描くものを替える。
  // keep = true なら、今の拡大率と位置を保つ (編集で絵を描き直したとき)。
  // 大きさが変わった場合は、見ている中心が同じ割合の場所に来るようにする。
  setSource(src, w, h, keep = false) {
    const had = this.src && this.w && this.h;
    const cx = had ? (this.cw / 2 - this.ox) / this.scale / this.w : 0.5;
    const cy = had ? (this.ch / 2 - this.oy) / this.scale / this.h : 0.5;
    const sameSize = had && this.w === w && this.h === h;
    this.src = src; this.w = w; this.h = h;
    if (!src) { this.draw(); return; }
    if (!keep || this.fitMode || !had) { this.fit(); return; }
    if (!sameSize) {
      this.ox = this.cw / 2 - cx * w * this.scale;
      this.oy = this.ch / 2 - cy * h * this.scale;
    }
    this.clamp();
    this.draw();
  }

  // 窓の大きさに合わせて canvas の画素数を決める。
  // 高精細な画面では、CSS の 1 px が実際の 2 画素などになるので、その分だけ増やす。
  layout() {
    const dpr = this.dpr;
    const w = Math.max(1, Math.round(this.cw * dpr)), h = Math.max(1, Math.round(this.ch * dpr));
    if (this.cv.width !== w || this.cv.height !== h) { this.cv.width = w; this.cv.height = h; }
    if (this.fitMode) this.fit(); else { this.clamp(); this.draw(); }
  }

  // 全体が収まる拡大率。小さい絵は引き伸ばさない (等倍まで)。
  fitScale() {
    if (!this.w || !this.h) return 1;
    const p = this.pad * 2;
    return Math.min(Math.max(1, this.cw - p) / this.w, Math.max(1, this.ch - p) / this.h, this.actual);
  }

  fit() {
    this.fitMode = true;
    this.scale = this.fitScale();
    this.ox = (this.cw - this.w * this.scale) / 2;
    this.oy = (this.ch - this.h * this.scale) / 2;
    this.changed();
  }

  // 拡大率を s にする。画面の (ax, ay) にある絵の点が、動かないようにする。
  // (マウスの位置を中心に拡大する、という動きになる)
  zoomTo(s, ax = this.cw / 2, ay = this.ch / 2) {
    s = Math.max(0.02 * this.actual, Math.min(64 * this.actual, s));
    const ix = (ax - this.ox) / this.scale, iy = (ay - this.oy) / this.scale;
    this.scale = s;
    this.ox = ax - ix * s;
    this.oy = ay - iy * s;
    this.fitMode = false;
    this.clamp();
    this.changed();
  }

  zoomBy(factor, ax, ay) { this.zoomTo(this.scale * factor, ax, ay); }

  pan(dx, dy) {
    this.ox += dx; this.oy += dy;
    this.fitMode = false;
    this.clamp();
    this.draw();
  }

  // 絵が画面より小さい向きは中央に置き、大きい向きは、すき間ができない範囲に収める
  clamp() {
    const iw = this.w * this.scale, ih = this.h * this.scale;
    this.ox = iw <= this.cw ? (this.cw - iw) / 2 : Math.min(0, Math.max(this.cw - iw, this.ox));
    this.oy = ih <= this.ch ? (this.ch - ih) / 2 : Math.min(0, Math.max(this.ch - ih, this.oy));
  }

  // 絵が画面からはみ出しているか (はみ出していれば、ドラッグでずらせる)
  get pannable() {
    return this.w * this.scale > this.cw + 0.5 || this.h * this.scale > this.ch + 0.5;
  }

  // 画面の点 → 絵の上の点
  toImage(x, y) { return { x: (x - this.ox) / this.scale, y: (y - this.oy) / this.scale }; }
  // 絵の上の点 → 画面の点
  toScreen(x, y) { return { x: this.ox + x * this.scale, y: this.oy + y * this.scale }; }

  changed() {
    this.draw();
    if (this.onChange) this.onChange();
  }

  // 描き直しは 1 フレームに 1 回にまとめる
  draw() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.paint(); });
  }

  paint() {
    const { g, cv } = this;
    const dpr = cv.width / Math.max(1, this.cw);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#101216';
    g.fillRect(0, 0, cv.width, cv.height);
    if (!this.src) return;

    // ここから先は CSS の px で考えられるようにする
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    let x = this.ox, y = this.oy;
    const w = this.w * this.scale, h = this.h * this.scale;
    // 等倍のときは、画面の画素の境目にぴったり合わせる (半端な位置に描くと、にじむ)
    const exact = Math.abs(this.scale * dpr - 1) < 1e-6;
    if (exact) { x = Math.round(x * dpr) / dpr; y = Math.round(y * dpr) / dpr; }

    // 透明な部分が分かるように、市松模様を下に敷く
    g.fillStyle = this.checker();
    g.fillRect(x, y, w, h);

    // 縮めるときはなめらかに。大きく拡大したときは、画素の四角が見えるように。
    g.imageSmoothingEnabled = !exact && this.scale * dpr < 3;
    g.imageSmoothingQuality = 'high';
    try {
      g.drawImage(this.src, x, y, w, h);
    } catch (e) {
      // 絵が閉じられていた、など。落ちるよりは、何も描かない方がいい。
    }
    if (this.overlay) this.overlay(g, this);
  }

  checker() {
    if (this.pattern) return this.pattern;
    const c = document.createElement('canvas');
    c.width = c.height = 16;
    const p = c.getContext('2d');
    p.fillStyle = '#2a2d33'; p.fillRect(0, 0, 16, 16);
    p.fillStyle = '#33373e'; p.fillRect(0, 0, 8, 8); p.fillRect(8, 8, 8, 8);
    this.pattern = this.g.createPattern(c, 'repeat');
    return this.pattern;
  }
}
