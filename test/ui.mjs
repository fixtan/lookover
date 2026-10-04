// test/ui.mjs — 画面側の自動試験 (ブラウザで動かす)
//
// 先に node test/serve.mjs を起動しておく。試験用の画像は python3 test/make_images.py で作る。
// 試験は test/work/ に写した画像に対して行う (書き出しや削除をするので、元は触らない)。
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORK = path.join(HERE, 'work');
fs.rmSync(WORK, { recursive: true, force: true });
fs.cpSync(path.join(HERE, 'files'), WORK, { recursive: true });
const F = (n) => path.join(WORK, n);

const b = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await b.newContext({ viewport: { width: 1200, height: 760 }, permissions: ['clipboard-read', 'clipboard-write'] });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push('pageerror: ' + String(e)));
p.on('console', (m) => { if (m.type() === 'error' && !/favicon|404|status of 500/.test(m.text())) errs.push('console: ' + m.text()); });

let fail = 0, pass = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; } console.log((c ? 'ok   ' : 'FAIL ') + msg); };
const section = (s) => console.log('\n## ' + s);
const ev = (fn, arg) => p.evaluate(fn, arg);

// ページの中で使う小物を先に入れておく
await p.addInitScript(() => {
  // いま画面に出している絵の、指定した点の色 [r, g, b, a]
  window.T = {
    px(points) {
      const o = __iv.S.out, c = document.createElement('canvas');
      c.width = o.w; c.height = o.h;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(o.src, 0, 0);
      return points.map(([x, y]) => Array.from(g.getImageData(x, y, 1, 1).data));
    },
    // 絵の全画素
    data() {
      const o = __iv.S.out, c = document.createElement('canvas');
      c.width = o.w; c.height = o.h;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(o.src, 0, 0);
      return g.getImageData(0, 0, o.w, o.h);
    },
    // 色ごとの画素数。{ 'r,g,b': 個数 }
    hist() {
      const d = this.data().data, m = {};
      for (let i = 0; i < d.length; i += 4) { const k = d[i] + ',' + d[i + 1] + ',' + d[i + 2]; m[k] = (m[k] || 0) + 1; }
      return m;
    },
    // 四隅の色を 1 文字で (R, G, B, W, ?)
    corners() {
      const o = __iv.S.out;
      const name = ([r, g, b]) => (r > 200 && g < 60 && b < 60 ? 'R' : g > 200 && r < 60 && b < 60 ? 'G' : b > 200 && r < 60 && g < 60 ? 'B' : r > 200 && g > 200 && b > 200 ? 'W' : '?');
      return this.px([[2, 2], [o.w - 3, 2], [2, o.h - 3], [o.w - 3, o.h - 3]]).map(name).join('');
    },
    size() { const o = __iv.S.out; return [o.w, o.h]; },
    async wait(fn, ms = 20000) { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 30)); } },
  };
});

async function open(name, expect = name) {
  await ev(async (path) => { await __iv.openPath(path); }, F(name));
  await p.waitForFunction((n) => window.__iv && __iv.S.item && __iv.S.item.name === n, expect, { timeout: 30000 });
}

await p.goto('http://localhost:8770/?open=' + encodeURIComponent(F('img1.png')));
await p.waitForFunction(() => window.__iv && window.__iv.S.bmp, null, { timeout: 20000 });

// ----------------------------------------------------------------------
section('フォルダと送り');
{
  const names = await ev(() => __iv.folder.items.map((i) => i.name));
  ok(names.join('|') === 'alpha.png|broken.png|grad.png|img1.png|img2.png|img10.png|photo_exif6.jpg|pic.webp|small.bmp|zz_big.jpg|日本語 の名前.png',
    '名前順 (img2 が img10 より前)、画像以外とフォルダは除く: ' + names.length + ' 件');
  ok(await ev(() => document.title) === 'img1.png [4/11] - Lookover', '窓の題名: ' + await ev(() => document.title));
  await p.keyboard.press('ArrowRight');
  await p.waitForFunction(() => __iv.S.item.name === 'img2.png');
  await p.keyboard.press('ArrowRight');
  await p.waitForFunction(() => __iv.S.item.name === 'img10.png');
  ok(true, '→ で img1 → img2 → img10');
  await p.keyboard.press('Home');
  await p.waitForFunction(() => __iv.S.item.name === 'alpha.png');
  await p.keyboard.press('ArrowLeft');
  await p.waitForTimeout(150);
  ok(await ev(() => __iv.folder.index) === 0, '先頭で ← を押しても止まる');
  await p.keyboard.press('End');
  await p.waitForFunction(() => __iv.S.item.name === '日本語 の名前.png' && __iv.S.bmp);
  ok(await ev(() => T.corners()) === 'RGBW', '日本語と空白を含む名前のファイルを開ける');
  await p.keyboard.press('ArrowRight');
  await p.waitForTimeout(150);
  ok(await ev(() => __iv.folder.index) === 10, '末尾で → を押しても止まる');

  // 壊れたファイル
  await ev(() => __iv.goto(1));
  await p.waitForFunction(() => __iv.S.item.name === 'broken.png');
  await p.waitForSelector('.toast.err');
  ok(await ev(() => __iv.S.bmp === null) && /開けない/.test(await p.textContent('.toast.err')), '壊れた画像は、落ちずに「開けない」と出る');
  await p.keyboard.press('ArrowRight');
  await p.waitForFunction(() => __iv.S.item.name === 'grad.png' && __iv.S.bmp);
  ok(true, '壊れた画像の次へ送れる');

  // ホイール
  await p.mouse.move(400, 300);
  await p.mouse.wheel(0, 100);
  await p.waitForFunction(() => __iv.S.item.name === 'img1.png' && __iv.S.bmp);
  await p.mouse.wheel(0, -100);
  await p.waitForFunction(() => __iv.S.item.name === 'grad.png' && __iv.S.bmp);
  ok(true, 'ホイールで前後に送れる');

  // フォルダを開く
  await open('sub', 'anim.gif');
  ok(await ev(() => __iv.S.item.name === 'anim.gif' && __iv.folder.count === 3), 'フォルダを渡すと、中の最初の画像を開く');
}

// ----------------------------------------------------------------------
section('形式と、撮ったときの向き');
{
  await open('photo_exif6.jpg');
  const r = await ev(() => ({ size: T.size(), c: T.corners() }));
  // 中身は横長 400 × 300 (左上=赤)。向き 6 は「右へ 90 度回して見る」なので、縦長になり、左上は元の左下 (青)。
  ok(r.size.join('x') === '300x400' && r.c === 'BRWG', `向きの情報を反映して開く: ${r.size.join(' × ')} 四隅 ${r.c}`);
  await open('pic.webp');
  ok(await ev(() => T.size().join('x') === '200x100' && T.corners() === 'RGBW'), 'WebP');
  await open('small.bmp');
  ok(await ev(() => T.size().join('x') === '64x48'), 'BMP');
  await open('alpha.png');
  const a = await ev(() => T.px([[0, 0], [100, 100]]));
  ok(a[0][3] === 0 && a[1][3] > 150 && a[1][3] < 170, `透明を保つ (隅の不透明度 ${a[0][3]}、中央 ${a[1][3]})`);
}

// ----------------------------------------------------------------------
section('動く画像');
{
  await open('sub/anim.gif', 'anim.gif');
  ok(await ev(() => __iv.S.anim && __iv.S.anim.frames === 3 && !!__iv.S.player), '動く GIF は、コマ数が分かり、再生が始まる');
  // 画面に出ているコマの色を、しばらく集める (赤・緑・青が全部出るはず)
  const seen = await ev(async () => {
    const got = new Set(), t = Date.now();
    while (Date.now() - t < 1500 && got.size < 3) {
      const f = __iv.view.src;
      try {
        const c = document.createElement('canvas'); c.width = 4; c.height = 4;
        const g = c.getContext('2d'); g.drawImage(f, 0, 0, 4, 4);
        const d = g.getImageData(1, 1, 1, 1).data;
        got.add(d[0] > 200 ? 'R' : d[1] > 200 ? 'G' : d[2] > 200 ? 'B' : '?');
      } catch (e) { /* コマが切り替わる瞬間 */ }
      await new Promise((r) => setTimeout(r, 25));
    }
    return [...got].sort().join('');
  });
  ok(seen === 'BGR', `3 コマが順に出る (見えた色: ${seen})`);
  ok(/動く画像 \(3 コマ\)/.test(await p.textContent('#st-tool')), '下の行に「動く画像 (3 コマ)」と出る');
  await p.keyboard.press('r');
  ok(await ev(() => !__iv.S.player && __iv.view.src === __iv.S.out.src && T.size().join() === '60,80'), '編集すると再生を止めて、最初の 1 コマを直す');
  await p.keyboard.press('Control+z');
  ok(await ev(() => !!__iv.S.player), '編集を取り消すと、また動く');
  await open('sub/still.gif', 'still.gif');
  ok(await ev(() => __iv.S.anim === null && !__iv.S.player), '1 コマだけの GIF は、ふつうの画像として扱う');
  await open('pic.webp');
  ok(await ev(() => __iv.S.anim === null), '動かない WebP も、ふつうの画像');
}

// ----------------------------------------------------------------------
section('表示の拡大と位置');
{
  await open('zz_big.jpg');
  const v = await ev(() => { const v = __iv.view; return { fit: v.fitMode, s: v.scale, want: Math.min(v.cw / 4000, v.ch / 3000), ox: v.ox, oy: v.oy, cw: v.cw, ch: v.ch }; });
  ok(v.fit && Math.abs(v.s - v.want) < 1e-9, `開いた直後は全体表示 (${(v.s * 100).toFixed(1)}%)`);
  ok(Math.abs(v.ox - (v.cw - 4000 * v.s) / 2) < 1e-6 && Math.abs(v.oy - (v.ch - 3000 * v.s) / 2) < 1e-6, '中央に置く');
  // マウスの位置を中心に拡大: その点の下にある絵の位置が変わらないこと
  const z = await ev(() => {
    const v = __iv.view, ax = 300, ay = 200, before = v.toImage(ax, ay);
    v.zoomTo(1, ax, ay);
    const after = v.toImage(ax, ay);
    return { d: Math.hypot(after.x - before.x, after.y - before.y), s: v.scale, fit: v.fitMode };
  });
  ok(z.d < 1e-6 && z.s === 1 && !z.fit, 'マウスの位置を中心に拡大する (その点の絵が動かない)');
  const c = await ev(() => { const v = __iv.view; v.pan(99999, 99999); const a = [v.ox, v.oy]; v.pan(-999999, -999999); return { a, b: [v.ox, v.oy], lim: [v.cw - 4000, v.ch - 3000] }; });
  ok(c.a[0] === 0 && c.a[1] === 0 && c.b[0] === c.lim[0] && c.b[1] === c.lim[1], 'ずらしても、絵の外にすき間を作らない');
  await p.keyboard.press('0');
  ok(await ev(() => __iv.view.fitMode), '0 で全体表示に戻る');
  await p.setViewportSize({ width: 900, height: 600 });
  await p.waitForTimeout(200);
  ok(await ev(() => { const v = __iv.view; return Math.abs(v.scale - Math.min(v.cw / 4000, v.ch / 3000)) < 1e-9; }), '窓の大きさを変えると、全体表示のまま合わせ直す');
  await p.setViewportSize({ width: 1200, height: 760 });
  await p.mouse.move(400, 300);
  await p.keyboard.down('Control');
  await p.mouse.wheel(0, -100);
  await p.keyboard.up('Control');
  ok(await ev(() => !__iv.view.fitMode && __iv.S.item.name === 'zz_big.jpg'), 'Ctrl + ホイールは、送らずに拡大する');
  await open('small.bmp');
  ok(await ev(() => __iv.view.scale === 1), '小さい絵は、全体表示でも引き伸ばさない (等倍)');
}

// ----------------------------------------------------------------------
section('向き (回転・反転)');
{
  await open('img1.png');
  // 試験側の「正解」: 四隅を 2 × 2 の表として持ち、同じ操作を当てる
  let q = [['R', 'G'], ['B', 'W']], size = [400, 300];
  const ops = {
    rotR: () => { q = [[q[1][0], q[0][0]], [q[1][1], q[0][1]]]; size = [size[1], size[0]]; },
    rotL: () => { q = [[q[0][1], q[1][1]], [q[0][0], q[1][0]]]; size = [size[1], size[0]]; },
    flipH: () => { q = [[q[0][1], q[0][0]], [q[1][1], q[1][0]]]; },
    flipV: () => { q = [q[1], q[0]]; },
  };
  const seq = ['rotR', 'rotR', 'flipH', 'rotL', 'flipV', 'rotR', 'flipH', 'flipH', 'rotL', 'rotL', 'flipV', 'rotR', 'rotR', 'rotR', 'flipH', 'rotL', 'flipV', 'flipV', 'rotR', 'flipH'];
  let bad = 0;
  for (const op of seq) {
    ops[op]();
    const r = await ev((op) => {
      ({ rotR: () => __iv.doRotate(1), rotL: () => __iv.doRotate(-1), flipH: () => __iv.doFlip('h'), flipV: () => __iv.doFlip('v') })[op]();
      return { c: T.corners(), s: T.size() };
    }, op);
    const want = q[0][0] + q[0][1] + q[1][0] + q[1][1];
    if (r.c !== want || r.s.join() !== size.join()) { bad++; console.log(`     ${op}: 四隅 ${r.c} (正解 ${want}) 大きさ ${r.s} (正解 ${size})`); }
  }
  ok(bad === 0, `回転と反転を ${seq.length} 回重ねても、四隅の色と大きさが正解と合う`);
  await ev(() => __iv.resetAll());
  ok(await ev(() => T.corners() === 'RGBW' && T.size().join() === '400,300'), '「全部元に戻す」で元の向きに戻る');

  // キー
  await p.keyboard.press('r');
  ok(await ev(() => T.corners()) === 'BRWG', 'R キーで右へ 90 度');
  await p.keyboard.press('Shift+R');
  ok(await ev(() => T.corners()) === 'RGBW', 'Shift + R で左へ 90 度');
  await p.keyboard.press('h');
  ok(await ev(() => T.corners()) === 'GRWB', 'H キーで左右反転');
  await p.keyboard.press('v');
  ok(await ev(() => T.corners()) === 'WBGR', 'V キーで上下反転');
  await ev(() => __iv.resetAll());
}

// ----------------------------------------------------------------------
section('向きを変えても、切り抜きと隠す場所が同じ絵の上に残る');
{
  await open('img1.png');
  // 赤い区画 (左上 200 × 150) の中を、80 × 50 だけ紫に塗る
  await ev(() => {
    __iv.S.edit.marks.push({ type: 'fill', x: 30, y: 20, w: 80, h: 50, size: 16, color: '#ff00ff' });
    __iv.commit(); __iv.rebuild();
  });
  const count = async () => { const h = await ev(() => T.hist()); return { mag: h['255,0,255'] || 0, red: h['255,0,0'] || 0 }; };
  let c = await count();
  ok(c.mag === 4000 && c.red === 200 * 150 - 4000, `塗りつぶし: 紫 ${c.mag} 画素、赤 ${c.red} 画素`);
  let bad = 0;
  for (const op of ['rotR', 'flipH', 'rotR', 'flipV', 'rotL', 'rotL', 'flipH', 'rotR', 'flipV', 'rotL']) {
    await ev((op) => ({ rotR: () => __iv.doRotate(1), rotL: () => __iv.doRotate(-1), flipH: () => __iv.doFlip('h'), flipV: () => __iv.doFlip('v') })[op](), op);
    c = await count();
    if (c.mag !== 4000 || c.red !== 26000) { bad++; console.log(`     ${op}: 紫 ${c.mag} 赤 ${c.red}`); }
  }
  ok(bad === 0, '回転・反転を 10 回重ねても、塗った場所は赤い区画の中のまま');
  await ev(() => __iv.resetAll());

  // 緑の区画 (右上) の中を 100 × 60 で切り抜く
  await ev(() => { __iv.S.edit.crop = { x: 210, y: 10, w: 100, h: 60 }; __iv.commit(); __iv.rebuild(false); });
  bad = 0;
  for (const op of ['rotR', 'flipH', 'rotL', 'rotL', 'flipV', 'rotR', 'rotR', 'flipH']) {
    await ev((op) => ({ rotR: () => __iv.doRotate(1), rotL: () => __iv.doRotate(-1), flipH: () => __iv.doFlip('h'), flipV: () => __iv.doFlip('v') })[op](), op);
    const r = await ev(() => ({ h: T.hist(), s: T.size() }));
    const keys = Object.keys(r.h);
    if (keys.length !== 1 || keys[0] !== '0,255,0' || r.s[0] * r.s[1] !== 6000) { bad++; console.log(`     ${op}: ${JSON.stringify(r.h)} ${r.s}`); }
  }
  ok(bad === 0, '回転・反転を 8 回重ねても、切り抜きの中は緑だけ (6,000 画素)');
  await ev(() => __iv.resetAll());
}

// ----------------------------------------------------------------------
section('切り抜き (マウス操作)');
{
  await open('img1.png');
  await p.keyboard.press('c');
  ok(await ev(() => __iv.S.tool === 'crop' && __iv.crop.active && !document.getElementById('panel').hidden), 'C で切り抜きを始めると、パネルも出る');
  // 絵の上の点 → 画面の点
  const scr = (x, y) => ev(([x, y]) => { const r = document.getElementById('view').getBoundingClientRect(), s = __iv.view.toScreen(x, y); return [r.left + s.x, r.top + s.y]; }, [x, y]);
  const drag = async (a, b) => {
    const s = await scr(...a), e = await scr(...b);
    await p.mouse.move(s[0], s[1]); await p.mouse.down();
    await p.mouse.move((s[0] + e[0]) / 2, (s[1] + e[1]) / 2, { steps: 4 });
    await p.mouse.move(e[0], e[1], { steps: 4 });
    await p.mouse.up();
  };
  // 右下の角を (400, 300) → (300, 200) へ引く
  await drag([400, 300], [300, 200]);
  let r = await ev(() => __iv.crop.rounded());
  ok(r.x === 0 && r.y === 0 && Math.abs(r.w - 300) <= 1 && Math.abs(r.h - 200) <= 1, `右下の角を引く → ${JSON.stringify(r)}`);
  // 中を引いて動かす
  await drag([150, 100], [200, 150]);
  r = await ev(() => __iv.crop.rounded());
  ok(Math.abs(r.x - 50) <= 1 && Math.abs(r.y - 50) <= 1 && Math.abs(r.w - 300) <= 1, `中を引くと動く → ${JSON.stringify(r)}`);
  // 絵の外へは出ない
  await drag([200, 200], [900, 900]);
  r = await ev(() => __iv.crop.rounded());
  ok(r.x + r.w === 400 && r.y + r.h === 300, `絵の外へは出ない → ${JSON.stringify(r)}`);
  // 縦横比 1 : 1
  await p.selectOption('#crop-aspect', '1:1');
  r = await ev(() => __iv.crop.rounded());
  ok(Math.abs(r.w - r.h) <= 1, `1 : 1 を選ぶと正方形になる → ${r.w} × ${r.h}`);
  await drag([r.x, r.y], [r.x + 60, r.y + 20]);
  r = await ev(() => __iv.crop.rounded());
  ok(Math.abs(r.w - r.h) <= 1 && r.x + r.w <= 400 && r.y + r.h <= 300, `角を引いても正方形のまま → ${JSON.stringify(r)}`);
  await p.selectOption('#crop-aspect', 'free');
  // 入力欄で指定
  await p.fill('#crop-x', '200'); await p.fill('#crop-y', '0'); await p.fill('#crop-w', '200'); await p.fill('#crop-h', '150');
  await p.locator('#crop-h').blur();
  r = await ev(() => __iv.crop.rounded());
  ok(r.x === 200 && r.y === 0 && r.w === 200 && r.h === 150, '入力欄で範囲を指定できる');
  // 入力欄から注目を外して、矢印で動かす
  await p.mouse.move(5, 5);
  await p.keyboard.press('ArrowLeft');
  r = await ev(() => __iv.crop.rounded());
  ok(r.x === 199, '矢印キーで 1 画素動く');
  await p.keyboard.press('ArrowRight');
  await p.keyboard.press('Enter');
  const o = await ev(() => ({ tool: __iv.S.tool, s: T.size(), h: T.hist(), crop: __iv.S.edit.crop }));
  ok(o.tool === null && o.s.join() === '200,150' && Object.keys(o.h).join() === '0,255,0', 'Enter で決定 → 200 × 150、中は緑だけ');
  // やり直し: もう一度 C を押すと、全体が出て、前の範囲から続けられる
  await p.keyboard.press('c');
  r = await ev(() => ({ r: __iv.crop.rounded(), s: T.size() }));
  ok(r.s.join() === '400,300' && r.r.x === 200 && r.r.w === 200, 'もう一度 C を押すと、切り抜く前の全体と、前の範囲が出る');
  await p.keyboard.press('Escape');
  ok(await ev(() => __iv.S.tool === null && T.size().join() === '200,150'), 'Esc でやめると、前の切り抜きのまま');
  await p.click('#btn-crop-clear');
  ok(await ev(() => __iv.S.edit.crop === null && T.size().join() === '400,300'), '「切り抜きをやめる」で全体に戻る');
  // 全体を選んだまま決定しても、切り抜きは付かない
  await p.keyboard.press('c'); await p.keyboard.press('Enter');
  ok(await ev(() => __iv.S.edit.crop === null), '全体を選んだまま決定しても、切り抜きなしのまま');
  await ev(() => __iv.resetAll());
}

// ----------------------------------------------------------------------
section('大きさ');
{
  await open('img1.png');
  const t = async (mode, value) => ev(([m, v]) => { __iv.setResize(m, v); return T.size().join(); }, [mode, value]);
  ok(await t('width', 200) === '200,150', '幅 200 → 200 × 150');
  ok(await t('height', 600) === '800,600', '高さ 600 → 800 × 600');
  ok(await t('long', 100) === '100,75', '長い辺 100 → 100 × 75');
  ok(await t('percent', 50) === '200,150', '50% → 200 × 150');
  // 半分に縮めても、四隅の色は保たれ、境目だけが混ざる
  const c = await ev(() => ({ c: T.corners(), mid: T.px([[50, 40], [150, 40], [50, 110], [150, 110]]) }));
  ok(c.c === 'RGBW' && c.mid[0][0] === 255 && c.mid[1][1] === 255 && c.mid[2][2] === 255, '縮めても色が保たれる');
  ok(await t('none', 0) === '400,300', '「変えない」で元の大きさ');
  await p.selectOption('#rs-mode', 'long');
  await p.click('#rs-presets button[data-rs="640"]');
  ok(await ev(() => T.size().join() === '640,480' && __iv.S.edit.resize.mode === 'long'), '数字のボタン (640) は、選んである指定の仕方で効く');
  ok(/400 × 300 → 640 × 480/.test(await p.textContent('#rs-out')), 'パネルに「400 × 300 → 640 × 480」と出る');
  ok(/400 × 300 → 640 × 480/.test(await p.textContent('#st-dim')), '下の行にも出る');
  await ev(() => __iv.resetAll());
}

// ----------------------------------------------------------------------
section('色の調整');
{
  await open('grad.png');
  const { adjustGL, adjustCPU } = await ev(async () => { const m = await import('./adjust.js'); window.ADJ = m; return { adjustGL: !!m.adjustGL, adjustCPU: !!m.adjustCPU }; });
  ok(adjustGL && adjustCPU, '2 通りの計算がある');
  // GPU と CPU の結果を比べる
  const cmp = (adj) => ev((adj) => {
    const S = __iv.S, full = { brightness: 0, contrast: 0, saturation: 0, temperature: 0, tint: 0, highlights: 0, shadows: 0, sharpen: 0, ...adj };
    const a = document.createElement('canvas'), b = document.createElement('canvas');
    const gl = ADJ.adjustGL(S.bmp, S.bw, S.bh, full, a);
    ADJ.adjustCPU(S.bmp, S.bw, S.bh, full, b);
    if (!gl) return { gl: false };
    const da = a.getContext('2d').getImageData(0, 0, S.bw, S.bh).data, db = b.getContext('2d').getImageData(0, 0, S.bw, S.bh).data;
    let max = 0, sum = 0;
    for (let i = 0; i < da.length; i++) { const d = Math.abs(da[i] - db[i]); if (d > max) max = d; sum += d; }
    return { gl: true, max, mean: sum / da.length };
  }, adj);
  const cases = [
    {}, { brightness: 40 }, { brightness: -60 }, { contrast: 50 }, { contrast: -80 }, { saturation: 100 }, { saturation: -100 },
    { temperature: 70 }, { tint: -50 }, { highlights: -60 }, { shadows: 80 }, { sharpen: 100 },
    { brightness: 20, contrast: 30, saturation: -20, temperature: 15, tint: 10, highlights: -30, shadows: 40, sharpen: 60 },
  ];
  let worst = 0, gl = true;
  for (const c of cases) { const r = await cmp(c); if (!r.gl) { gl = false; break; } worst = Math.max(worst, r.max); if (r.max > 2) console.log('     ' + JSON.stringify(c) + ' → 最大差 ' + r.max); }
  ok(gl, 'GPU で計算できる');
  ok(gl && worst <= 2, `GPU と CPU の結果が合う (${cases.length} 通り、差は最大 ${worst} / 255)`);

  // 何も動かしていなければ、元の絵そのもの
  const same = await ev(() => {
    const a = document.createElement('canvas');
    ADJ.adjustGL(__iv.S.bmp, 256, 256, { brightness: 0, contrast: 0, saturation: 0, temperature: 0, tint: 0, highlights: 0, shadows: 0, sharpen: 0 }, a);
    const da = a.getContext('2d').getImageData(0, 0, 256, 256).data, o = T.data().data;
    let max = 0; for (let i = 0; i < da.length; i++) max = Math.max(max, Math.abs(da[i] - o[i]));
    return max;
  });
  ok(same === 0, '全部 0 なら、1 画素も変わらない');

  // 個々の効き方を、式から確かめる
  const before = await ev(() => T.px([[40, 60], [200, 120]]));
  const slide = async (k, v) => ev(([k, v]) => { const s = document.getElementById('adj-' + k); s.value = v; s.dispatchEvent(new Event('input')); s.dispatchEvent(new Event('change')); return T.px([[40, 60], [200, 120]]); }, [k, v]);
  let a = await slide('brightness', 100);
  ok(a.every((px, i) => [0, 1, 2].every((c) => Math.abs(px[c] - Math.min(255, before[i][c] * 2)) <= 2)), '明るさ +100 で、値が 2 倍になる');
  a = await slide('brightness', -100);
  ok(a.every((px, i) => [0, 1, 2].every((c) => Math.abs(px[c] - before[i][c] / 2) <= 2)), '明るさ -100 で、値が半分になる');
  await slide('brightness', 0);
  a = await slide('saturation', -100);
  ok(a.every((px) => Math.abs(px[0] - px[1]) <= 1 && Math.abs(px[1] - px[2]) <= 1), '彩度 -100 で、灰色になる');
  await slide('saturation', 0);
  a = await slide('contrast', -100);
  ok(a.every((px, i) => [0, 1, 2].every((c) => Math.abs(px[c] - ((before[i][c] / 255 - 0.5) * 0.2 + 0.5) * 255) <= 2)), 'コントラスト -100 で、灰色の近くに寄る');
  ok(await ev(() => __iv.S.hist.length) === 7, 'スライダーを離すたびに、履歴が 1 つ増える');
  await p.dblclick('#adj-contrast');
  ok(await ev(() => __iv.S.edit.adj.contrast === 0), 'スライダーをダブルクリックすると 0 に戻る');
  const back = await ev(() => T.px([[40, 60], [200, 120]]));
  ok(JSON.stringify(back) === JSON.stringify(before), '全部 0 に戻すと、元の色に戻る');

  // 透明は保つ
  await open('alpha.png');
  await ev(() => { __iv.S.edit.adj.brightness = 50; __iv.commit(); __iv.rebuild(); });
  const al = await ev(() => T.px([[0, 0], [100, 100]]));
  ok(al[0][3] === 0 && Math.abs(al[1][3] - 160) <= 1, `色を変えても、透明度は変わらない (${al[0][3]}, ${al[1][3]})`);
  await ev(() => __iv.resetAll());
}

// ----------------------------------------------------------------------
section('隠す (モザイク・ぼかし・塗りつぶし)');
{
  await open('grad.png');
  const before = await ev(() => Array.from(T.data().data));
  const scr = (x, y) => ev(([x, y]) => { const r = document.getElementById('view').getBoundingClientRect(), s = __iv.view.toScreen(x, y); return [r.left + s.x, r.top + s.y]; }, [x, y]);
  const drag = async (a, b) => {
    const s = await scr(...a), e = await scr(...b);
    await p.mouse.move(s[0], s[1]); await p.mouse.down();
    await p.mouse.move(e[0], e[1], { steps: 5 }); await p.mouse.up();
  };
  const diffOutside = (rect) => ev(([before, r]) => {
    const d = T.data().data; let out = 0, inn = 0;
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
      const i = (y * 256 + x) * 4, ch = d[i] !== before[i] || d[i + 1] !== before[i + 1] || d[i + 2] !== before[i + 2];
      if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) { if (ch) inn++; } else if (ch) out++;
    }
    return { out, inn };
  }, [before, rect]);

  await p.keyboard.press('m');
  ok(await ev(() => __iv.S.tool === 'mosaic'), 'M でモザイクの道具');
  await drag([32, 32], [96, 96]);
  let m = await ev(() => __iv.S.edit.marks[0]);
  ok(m && m.type === 'mosaic' && m.x === 32 && m.y === 32 && m.w === 64 && m.h === 64, `ドラッグした範囲に付く → ${JSON.stringify(m)}`);
  let d = await diffOutside(m);
  ok(d.out === 0 && d.inn > 3000, `モザイク: 範囲の外は 1 画素も変わらない (中は ${d.inn} 画素が変化)`);
  // 1 マス (16 × 16) の中は同じ色
  const uni = await ev(() => { const d = T.data().data; let bad = 0; for (let by = 32; by < 96; by += 16) for (let bx = 32; bx < 96; bx += 16) { const i0 = (by * 256 + bx) * 4; for (let y = by; y < by + 16; y++) for (let x = bx; x < bx + 16; x++) { const i = (y * 256 + x) * 4; if (d[i] !== d[i0] || d[i + 1] !== d[i0 + 1]) bad++; } } return bad; });
  ok(uni === 0, 'モザイク: 1 マス (16 × 16) の中は同じ色');
  // マスの色は、元のその区画の平均に近い
  const avg = await ev((before) => { const d = T.data().data; let worst = 0; for (let by = 32; by < 96; by += 16) for (let bx = 32; bx < 96; bx += 16) { let s = 0; for (let y = by; y < by + 16; y++) for (let x = bx; x < bx + 16; x++) s += before[(y * 256 + x) * 4]; worst = Math.max(worst, Math.abs(s / 256 - d[(by * 256 + bx) * 4])); } return worst; }, before);
  ok(avg <= 6, `モザイク: マスの色は、元の区画の平均に近い (差は最大 ${avg.toFixed(1)})`);

  await p.keyboard.press('Delete');
  ok(await ev(() => __iv.S.edit.marks.length === 0 && __iv.S.item.name === 'grad.png'), 'Delete で、選んでいる隠す場所を消す (画像は消さない)');
  d = await diffOutside({ x: 0, y: 0, w: 0, h: 0 });
  ok(d.out === 0, '消すと、元の絵に戻る');

  await p.keyboard.press('b');
  await drag([120, 40], [200, 100]);
  m = await ev(() => __iv.S.edit.marks[0]);
  d = await diffOutside(m);
  ok(m.type === 'blur' && d.out === 0 && d.inn > 3000, `ぼかし: 範囲の外は変わらない (中は ${d.inn} 画素が変化)`);
  // ぼかすと、隣り合う画素の差が小さくなる
  const rough = await ev(([before, m]) => { const d = T.data().data; let a = 0, b = 0; for (let y = m.y + 4; y < m.y + m.h - 4; y++) for (let x = m.x + 4; x < m.x + m.w - 5; x++) { const i = (y * 256 + x) * 4; a += Math.abs(before[i] - before[i + 4]); b += Math.abs(d[i] - d[i + 4]); } return { a, b }; }, [before, m]);
  ok(rough.b < rough.a * 0.3, `ぼかし: ざらつきが ${(rough.b / rough.a * 100).toFixed(0)}% に減る`);

  await p.keyboard.press('n');
  await ev(() => { __iv.settings.markColor = '#102030'; });
  await drag([10, 200], [60, 240]);
  const f = await ev(() => ({ m: __iv.S.edit.marks[1], px: T.px([[10, 200], [59, 239], [61, 200]]) }));
  ok(f.m.type === 'fill' && f.px[0].join() === '16,32,48,255' && f.px[1].join() === '16,32,48,255' && f.px[2].join() !== '16,32,48,255', '塗りつぶし: 範囲の中だけ、指定の色になる');

  // 選んで動かす
  await drag([30, 220], [130, 220]);
  const mv = await ev(() => __iv.S.edit.marks[1]);
  ok(mv.x === 110 && mv.y === 200, `引くと動く → x = ${mv.x}`);
  // 小さすぎるドラッグは無視
  const n0 = await ev(() => __iv.S.edit.marks.length);
  await drag([230, 230], [231, 231]);
  ok(await ev(() => __iv.S.edit.marks.length) === n0, '1 画素だけのドラッグでは、何も付かない');
  await p.keyboard.press('Escape');
  ok(await ev(() => __iv.S.tool === null), 'Esc で道具を終える');
  await p.click('#btn-mark-clear');
  ok(await ev(() => __iv.S.edit.marks.length === 0), '「全部消す」');

  // 切り抜いて縮めた後の絵の上でも、隠す場所が正しい位置に付く
  await ev(() => { __iv.S.edit.crop = { x: 100, y: 100, w: 100, h: 100 }; __iv.S.edit.resize = { mode: 'percent', value: 200 }; __iv.commit(); __iv.rebuild(false); });
  await p.keyboard.press('n');
  await drag([20, 40], [60, 80]); // 画面の絵 (200 × 200) の上で
  const mm = await ev(() => __iv.S.edit.marks[0]);
  ok(mm.x === 110 && mm.y === 120 && mm.w === 20 && mm.h === 20, `切り抜き + 2 倍の絵の上で描いても、元の絵の座標に直る → ${JSON.stringify({ x: mm.x, y: mm.y, w: mm.w, h: mm.h })}`);
  await p.keyboard.press('Escape');
  await ev(() => __iv.resetAll());
}

// ----------------------------------------------------------------------
section('目印 (枠・矢印)');
{
  await open('img1.png');
  const scr = (x, y) => ev(([x, y]) => { const r = document.getElementById('view').getBoundingClientRect(), s = __iv.view.toScreen(x, y); return [r.left + s.x, r.top + s.y]; }, [x, y]);
  const drag = async (a, b) => { const s = await scr(...a), e = await scr(...b); await p.mouse.move(s[0], s[1]); await p.mouse.down(); await p.mouse.move(e[0], e[1], { steps: 5 }); await p.mouse.up(); };
  await p.keyboard.press('k');
  await drag([20, 20], [120, 90]);
  let r = await ev(() => ({ m: __iv.S.edit.marks[0], px: T.px([[21, 21], [70, 55], [118, 88], [125, 55]]) }));
  ok(r.m.type === 'frame' && r.m.color === '#ff3b30' && r.px[0].join() === '255,59,48,255' && r.px[2].join() === '255,59,48,255' && r.px[1].join() === '255,0,0,255' && r.px[3].join() === '255,0,0,255',
    '枠: 縁だけに線が引かれ、中と外は元のまま');
  ok(await ev(() => document.getElementById('mark-color-label').textContent === '線の色' && document.getElementById('mark-color').value === '#ff3b30'), '色の欄は「線の色」に切り替わる');
  await p.keyboard.press('Delete');

  // 矢印: 赤い区画の中から、白い区画の中へ
  await p.keyboard.press('a');
  await drag([60, 50], [340, 250]);
  r = await ev(() => __iv.S.edit.marks[0]);
  ok(r.type === 'arrow' && r.dir === 0 && r.x === 60 && r.y === 50 && r.w === 280 && r.h === 200, `矢印: 引き始めの角を覚える → ${JSON.stringify({ x: r.x, y: r.y, w: r.w, h: r.h, dir: r.dir })}`);
  // 矢印の「出る側」と「先」が、どの色の区画にあるかを見る。向きを変えても、赤 → 白 のままのはず。
  const ends = () => ev(() => {
    const m = __iv.S.edit.marks[0], o = __iv.S.out;
    const cs = [[m.x, m.y], [m.x + m.w, m.y], [m.x + m.w, m.y + m.h], [m.x, m.y + m.h]];
    const a = cs[m.dir], b = cs[(m.dir + 2) % 4], len = Math.hypot(b[0] - a[0], b[1] - a[1]), u = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    // 両端から、少し外側へ離れた点の色
    const pts = [[a[0] - u[0] * 12, a[1] - u[1] * 12], [b[0] + u[0] * 12, b[1] + u[1] * 12]].map(([x, y]) => [Math.round(x), Math.round(y)]);
    const name = ([r, g, b]) => (r > 200 && g < 60 && b < 60 ? 'R' : g > 200 && r < 60 && b < 60 ? 'G' : b > 200 && r < 60 && g < 60 ? 'B' : r > 200 && g > 200 && b > 200 ? 'W' : '?');
    // 先端の近くの方が、塗られた画素が多い (矢じりがある) ことも確かめる
    const d = T.data(), cnt = (cx, cy) => { let n = 0; for (let y = cy - 14; y <= cy + 14; y++) for (let x = cx - 14; x <= cx + 14; x++) { if (x < 0 || y < 0 || x >= o.w || y >= o.h) continue; const i = (y * o.w + x) * 4; if (d.data[i] === 255 && d.data[i + 1] === 59 && d.data[i + 2] === 48) n++; } return n; };
    return { c: T.px(pts).map(name).join(''), head: cnt(Math.round(b[0] - u[0] * 8), Math.round(b[1] - u[1] * 8)) > cnt(Math.round(a[0] + u[0] * 8), Math.round(a[1] + u[1] * 8)) };
  });
  let e = await ends();
  ok(e.c === 'RW' && e.head, '矢印: 赤い区画から白い区画へ向き、先に矢じりがある');
  let bad = 0;
  for (const op of ['rotR', 'flipH', 'rotR', 'flipV', 'rotL', 'flipH', 'rotL', 'rotL', 'flipV', 'rotR']) {
    await ev((op) => ({ rotR: () => __iv.doRotate(1), rotL: () => __iv.doRotate(-1), flipH: () => __iv.doFlip('h'), flipV: () => __iv.doFlip('v') })[op](), op);
    e = await ends();
    if (e.c !== 'RW' || !e.head) { bad++; console.log(`     ${op}: ${JSON.stringify(e)}`); }
  }
  ok(bad === 0, '回転・反転を 10 回重ねても、矢印は赤 → 白 のまま');
  await p.keyboard.press('Escape');
  await ev(() => __iv.resetAll());
  // 逆向きに引く
  await p.keyboard.press('a');
  await drag([340, 250], [60, 50]);
  e = await ends();
  ok(await ev(() => __iv.S.edit.marks[0].dir === 2) && e.c === 'WR' && e.head, '逆向きに引くと、白 → 赤 の矢印になる');
  await p.keyboard.press('Delete');
  // 真横の矢印
  await drag([40, 40], [160, 40]);
  ok(await ev(() => __iv.S.edit.marks.length === 1 && __iv.S.edit.marks[0].h <= 1), '真横にも引ける');
  await p.keyboard.press('Escape');
  await ev(() => __iv.resetAll());
}

// ----------------------------------------------------------------------
section('取り消し・やり直し・覚えておく');
{
  // 前の試験で積んだ履歴を捨てて、まっさらな状態から始める
  await open('grad.png');
  await ev(() => __iv.kept.clear());
  await open('img1.png');
  await p.keyboard.press('r');
  await p.keyboard.press('h');
  await ev(() => __iv.setResize('width', 100));
  const e3 = await ev(() => JSON.stringify(__iv.S.edit));
  await p.keyboard.press('Control+z');
  ok(await ev(() => __iv.S.edit.resize === null && __iv.S.edit.flip === true), 'Ctrl + Z で 1 つ戻る');
  await p.keyboard.press('Control+z');
  await p.keyboard.press('Control+z');
  ok(await ev(() => T.corners() === 'RGBW' && __iv.S.hpos === 0), '3 回戻すと、最初の状態');
  await p.keyboard.press('Control+z');
  ok(await ev(() => __iv.S.hpos === 0), 'それ以上は戻らない');
  await p.keyboard.press('Control+y'); await p.keyboard.press('Control+y'); await p.keyboard.press('Control+y');
  ok(await ev(() => JSON.stringify(__iv.S.edit)) === e3, 'Ctrl + Y で 3 回やり直すと、同じ内容に戻る');
  await p.keyboard.press('Control+z');
  await p.keyboard.press('v');
  ok(await ev(() => __iv.S.hist.length === 4 && __iv.S.hpos === 3), '戻してから別の操作をすると、やり直しの分は捨てる');

  // ほかの画像へ行って戻っても、編集が残っている
  const mine = await ev(() => JSON.stringify(__iv.S.edit));
  await p.keyboard.press('ArrowRight');
  await p.waitForFunction(() => __iv.S.item.name === 'img2.png' && __iv.S.bmp);
  ok(await ev(() => __iv.S.hist.length === 1 && document.getElementById('st-edit').hidden), '次の画像は、編集なしで始まる');
  await p.keyboard.press('ArrowLeft');
  await p.waitForFunction(() => __iv.S.item.name === 'img1.png' && __iv.S.bmp);
  ok(await ev(() => JSON.stringify(__iv.S.edit)) === mine && await ev(() => __iv.S.hist.length === 4 && !document.getElementById('st-edit').hidden), '戻ると、編集と履歴が残っている (「編集あり」も出る)');

  // 元の絵を一時的に見る
  await p.mouse.move(5, 5);
  await p.keyboard.down('\\');
  ok(await ev(() => __iv.S.showOriginal && __iv.view.w === 400 && __iv.view.src === __iv.S.bmp), '\\ を押している間は、元の絵');
  await p.keyboard.up('\\');
  ok(await ev(() => !__iv.S.showOriginal && __iv.view.src !== __iv.S.bmp), '離すと、編集後の絵に戻る');
  await ev(() => __iv.resetAll());
}

// ----------------------------------------------------------------------
section('書き出し');
{
  await open('img1.png');
  // 書き出したファイルを、ブラウザでもう一度開いて確かめる
  const readBack = (file) => ev(async (path) => {
    const be = await import('./backend.js'), de = await import('./decode.js');
    const bytes = await be.readFile(path);
    const u = new Uint8Array(bytes);
    const d = await de.decode(bytes, be.extname(path));
    const c = document.createElement('canvas'); c.width = d.width; c.height = d.height;
    const g = c.getContext('2d'); g.drawImage(d.bitmap, 0, 0);
    const px = (x, y) => Array.from(g.getImageData(x, y, 1, 1).data);
    return { w: d.width, h: d.height, size: u.length, head: Array.from(u.slice(0, 12)), tl: px(2, 2), br: px(d.width - 3, d.height - 3) };
  }, file);
  const isWebp = (h) => String.fromCharCode(...h.slice(0, 4)) === 'RIFF' && String.fromCharCode(...h.slice(8, 12)) === 'WEBP';
  const isJpeg = (h) => h[0] === 0xff && h[1] === 0xd8;
  const isPng = (h) => h[0] === 0x89 && h[1] === 0x50;

  // プリセット 1 (WebP 長辺 1920): 元が小さいので、引き伸ばさない
  await p.keyboard.press('Control+1');
  await p.waitForFunction(() => /書き出した/.test(document.getElementById('toasts').textContent));
  ok(fs.existsSync(F('img1_1920.webp')), 'Ctrl + 1 → img1_1920.webp ができる');
  let r = await readBack(F('img1_1920.webp'));
  ok(isWebp(r.head) && r.w === 400 && r.h === 300, `中身は WebP、400 × 300 (小さい絵は引き伸ばさない)`);
  ok(await ev(() => __iv.S.item.name === 'img1.png' && __iv.folder.items.some((i) => i.name === 'img1_1920.webp')), '書き出したあとも同じ画像を見ていて、一覧には新しいファイルが入る');
  // 同じ名前があれば番号を付ける
  await ev(() => __iv.quickExport(0));
  ok(fs.existsSync(F('img1_1920-2.webp')), '同じ名前がすでにあれば、-2 を付ける');
  // 編集を当てて書き出し
  await ev(() => { __iv.doRotate(1); __iv.S.edit.crop = { x: 0, y: 0, w: 150, h: 200 }; __iv.commit(); __iv.rebuild(); });
  await ev(() => __iv.quickExport(2)); // JPEG 長辺 1280
  r = await readBack(F('img1_1280.jpg'));
  ok(isJpeg(r.head) && r.w === 150 && r.h === 200 && r.tl[2] > 200 && r.tl[0] < 60, `回転 + 切り抜きを当てた JPEG (${r.w} × ${r.h}、左上は青)`);
  await ev(() => __iv.resetAll());

  // 大きい絵は、長い辺を合わせて縮める
  await open('zz_big.jpg');
  let t0 = Date.now();
  await ev(() => __iv.quickExport(0));
  const tExport = Date.now() - t0;
  r = await readBack(F('zz_big_1920.webp'));
  ok(r.w === 1920 && r.h === 1440, `4000 × 3000 → 長辺 1920 で ${r.w} × ${r.h} (${tExport} ms)`);

  // プリセット 2 (WebP 原寸) を、元が WebP の画像に: 元のファイルは上書きしない
  await open('pic.webp');
  const orig = fs.readFileSync(F('pic.webp'));
  await ev(() => { __iv.settings.presets[1].overwrite = true; });
  const out = await ev(() => __iv.quickExport(1));
  ok(path.basename(out) === 'pic-2.webp' && fs.readFileSync(F('pic.webp')).equals(orig), '書き出し先が元の画像と同じ名前になるときは、「置き換える」設定でも元を上書きしない (pic-2.webp)');
  await ev(() => { __iv.settings.presets[1].overwrite = false; });

  // 透明のある絵を JPEG にすると、透明な所は白
  await open('alpha.png');
  await ev(() => __iv.quickExport(2));
  r = await readBack(F('alpha_1280.jpg'));
  ok(r.tl[0] > 250 && r.tl[1] > 250 && r.tl[2] > 250, 'JPEG にすると、透明な所は白になる');

  // 名前を付けて保存
  await open('img1.png');
  await ev((dest) => { window.__DEV_PICK = (kind, def) => { window.__pickDefault = def; return dest; }; }, F('saved copy.png'));
  await p.keyboard.press('h');
  await p.keyboard.press('Control+Shift+S');
  await p.waitForFunction(() => /保存した/.test(document.getElementById('toasts').textContent));
  r = await readBack(F('saved copy.png'));
  ok(isPng(r.head) && r.w === 400 && r.tl[1] > 200 && r.tl[0] < 60, '名前を付けて保存: 拡張子 (.png) で形式が決まり、反転が当たっている');
  ok(/img1_edit\.webp$/.test(await ev(() => window.__pickDefault)), '保存先の初期値は img1_edit.webp');
  // 拡張子なしの名前を選んだら、選んである形式の拡張子を足す
  await ev((dest) => { window.__DEV_PICK = () => dest; }, F('noext'));
  await ev(() => __iv.saveAs());
  ok(fs.existsSync(F('noext.webp')), '拡張子なしの名前には、選んである形式の拡張子を足す');
  // やめたら何もしない
  await ev(() => { window.__DEV_PICK = () => null; });
  const before = fs.readdirSync(WORK).length;
  await ev(() => __iv.saveAs());
  ok(fs.readdirSync(WORK).length === before, '保存先を選ばなければ、何も書かない');

  // 上書き保存
  await ev(() => __iv.resetAll());
  await p.keyboard.press('Control+s');
  await p.waitForFunction(() => /変更がない/.test(document.getElementById('toasts').textContent));
  ok(await ev(() => document.getElementById('modal').hidden), '変更がなければ、上書きの確認も出さない');
  const sizeBefore = fs.statSync(F('img1.png')).size;
  await ev(() => __iv.setResize('width', 200));
  await p.keyboard.press('Control+s');
  await p.waitForSelector('#modal:not([hidden])');
  ok(/元の絵には戻せない/.test(await p.textContent('#modal-box')), '上書きの前に確認が出る');
  await p.keyboard.press('Escape');
  ok(fs.statSync(F('img1.png')).size === sizeBefore && await ev(() => document.getElementById('modal').hidden), 'Esc でやめると、ファイルはそのまま');
  await p.keyboard.press('Control+s');
  await p.waitForSelector('#modal:not([hidden])');
  await p.keyboard.press('ArrowRight'); // 確認が出ている間は、裏の画像が送られない
  ok(await ev(() => __iv.S.item.name === 'img1.png'), '確認が出ている間は、キーが裏に効かない');
  await p.keyboard.press('Enter');
  await p.waitForFunction(() => /上書きした/.test(document.getElementById('toasts').textContent));
  r = await readBack(F('img1.png'));
  ok(r.w === 200 && r.h === 150 && isPng(r.head), '上書きすると、ファイルが 200 × 150 の PNG になる');
  ok(await ev(() => __iv.S.item.name === 'img1.png' && __iv.S.bw === 200 && __iv.S.hist.length === 1 && __iv.S.edit.resize === null), '上書き後は読み直して、編集なしの状態になる');
  ok(!fs.readdirSync(WORK).some((n) => n.includes('tmp-write')), '書き込み用の仮ファイルが残らない');

  // 書き出せない形式への上書き
  await open('small.bmp');
  await p.keyboard.press('r');
  await p.keyboard.press('Control+s');
  await p.waitForFunction(() => /この形式には上書きできない/.test(document.getElementById('toasts').textContent));
  ok(await ev(() => document.getElementById('modal').hidden), 'BMP には上書きできない、と出る');
  await ev(() => __iv.resetAll());

  // 見積もり
  await open('grad.png');
  await p.waitForFunction(() => /256 × 256 ／ 約/.test(document.getElementById('ex-info').textContent), null, { timeout: 5000 });
  const e1 = await p.textContent('#ex-info');
  await ev(() => { const s = document.getElementById('ex-quality'); s.value = 20; s.dispatchEvent(new Event('input')); s.dispatchEvent(new Event('change')); });
  await p.waitForFunction((e1) => document.getElementById('ex-info').textContent !== e1, e1, { timeout: 5000 });
  ok(true, `書き出しの大きさの見積もりが出て、品質を変えると変わる (${e1} → ${await p.textContent('#ex-info')})`);
  await ev(() => { const s = document.getElementById('ex-quality'); s.value = 85; s.dispatchEvent(new Event('input')); s.dispatchEvent(new Event('change')); });

  // コピー
  await ev(() => __iv.copyImage());
  await p.waitForFunction(() => /コピーした|コピーできない/.test(document.getElementById('toasts').textContent));
  const clip = await ev(async () => { try { const items = await navigator.clipboard.read(); const b = await items[0].getType('image/png'); const bm = await createImageBitmap(b); return [bm.width, bm.height]; } catch (e) { return String(e); } });
  ok(Array.isArray(clip) && clip.join() === '256,256', 'コピーすると、クリップボードに絵が入る: ' + clip);
}

// ----------------------------------------------------------------------
section('貼り付け・ごみ箱');
{
  await open('img2.png');
  // クリップボードの絵 (さっきコピーした grad) を貼る代わりに、同じ道を直接呼ぶ
  await ev(async () => { const c = document.createElement('canvas'); c.width = 50; c.height = 30; const g = c.getContext('2d'); g.fillStyle = '#00f'; g.fillRect(0, 0, 50, 30); const blob = await new Promise((r) => c.toBlob(r)); await __iv.openBlob(blob, 'clip-test.png'); });
  ok(await ev(() => __iv.S.item.virtual && T.size().join() === '50,30' && document.getElementById('st-pos').textContent === ''), '貼り付けた絵を開ける (フォルダの外の 1 枚として)');
  const out = await ev(() => __iv.quickExport(0));
  ok(out && path.basename(out) === 'clip-test_1920.webp' && fs.existsSync(out), '貼り付けた絵も、いまのフォルダへワンキーで書き出せる');
  await p.keyboard.press('ArrowRight');
  await p.waitForFunction(() => __iv.S.item.name === 'img2.png');
  ok(true, '→ で、フォルダの画像に戻る');

  // paste イベント
  await ev(async () => { const c = document.createElement('canvas'); c.width = 40; c.height = 20; const blob = await new Promise((r) => c.toBlob(r)); const dt = new DataTransfer(); dt.items.add(new File([blob], 'x.png', { type: 'image/png' })); window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt })); });
  await p.waitForFunction(() => __iv.S.item.virtual && __iv.S.bw === 40);
  ok(/^clip-\d{8}-\d{6}\.png$/.test(await ev(() => __iv.S.item.name)), '貼り付けると、日時の名前が付く: ' + await ev(() => __iv.S.item.name));

  // 名前を変える
  await open('img10.png');
  await ev(() => { __iv.doRotate(1); });
  await p.keyboard.press('F2');
  await p.waitForFunction(() => !document.getElementById('modal').hidden && document.activeElement.matches('#modal-box input'));
  const sel = await ev(() => { const i = document.querySelector('#modal-box input'); return [i.value, i.selectionStart, i.selectionEnd]; });
  ok(sel[0] === 'img10.png' && sel[1] === 0 && sel[2] === 5, 'F2 で名前の枠が出て、拡張子の前だけが選ばれている');
  await p.keyboard.type('astro-164 図 1');
  await p.keyboard.press('Enter');
  await p.waitForFunction(() => __iv.S.item && __iv.S.item.name === 'astro-164 図 1.png' && __iv.S.bmp);
  ok(fs.existsSync(F('astro-164 図 1.png')) && !fs.existsSync(F('img10.png')), '名前が変わる (拡張子はそのまま)');
  ok(await ev(() => __iv.S.edit.rot === 90 && __iv.folder.current.name === 'astro-164 図 1.png'), '変える前の編集を引き継ぎ、同じ画像を見ている');
  await ev(() => __iv.resetAll());
  // すでにある名前には変えられない
  await p.keyboard.press('F2');
  await p.waitForFunction(() => !document.getElementById('modal').hidden && document.activeElement.matches('#modal-box input'));
  await p.keyboard.type('img2');
  await p.keyboard.press('Enter');
  await p.waitForFunction(() => /名前を変えられない/.test(document.getElementById('toasts').textContent));
  ok(fs.existsSync(F('astro-164 図 1.png')) && fs.existsSync(F('img2.png')), 'すでにある名前には変えない (上書きしない)');
  // 使えない文字
  await p.keyboard.press('F2');
  await p.waitForFunction(() => !document.getElementById('modal').hidden && document.activeElement.matches('#modal-box input'));
  await p.keyboard.type('a:b');
  await p.keyboard.press('Enter');
  await p.waitForFunction(() => /使えない文字/.test(document.getElementById('toasts').textContent));
  ok(fs.existsSync(F('astro-164 図 1.png')), 'ファイル名に使えない文字は、はじく');

  await open('img2.png');
  const idx = await ev(() => __iv.folder.index), n = await ev(() => __iv.folder.count);
  await p.keyboard.press('Delete');
  await p.waitForSelector('#modal:not([hidden])');
  await p.keyboard.press('Enter');
  await p.waitForFunction(() => /ごみ箱へ送った/.test(document.getElementById('toasts').textContent));
  ok(!fs.existsSync(F('img2.png')) && fs.existsSync(F('.trash/img2.png')), 'Delete → 確認 → ごみ箱へ');
  ok(await ev(([i, n]) => __iv.folder.count === n - 1 && __iv.folder.index === i && __iv.S.item.name !== 'img2.png' && !!__iv.S.bmp, [idx, n]), '消したあとは、同じ位置の次の画像が出る: ' + await ev(() => __iv.S.item.name));
  // 確認なしにすると、Delete だけで送る
  await ev(() => { document.getElementById('panel').hidden && __iv.togglePanel(true); });
  await p.selectOption('#set-confirm', '0');
  const target = await ev(() => __iv.S.item.name);
  await p.keyboard.press('Delete');
  await p.waitForFunction((n) => __iv.S.item && __iv.S.item.name !== n, target);
  ok(!fs.existsSync(F(target)) && fs.existsSync(F('.trash/' + target)) && await ev(() => document.getElementById('modal').hidden), '「確認しない」にすると、Delete だけでごみ箱へ送る: ' + target);
  await p.selectOption('#set-confirm', '1');
}

// ----------------------------------------------------------------------
section('そのほかの操作');
{
  await open('grad.png');
  await p.keyboard.press('F1');
  await p.waitForSelector('#modal:not([hidden])');
  ok(/操作の一覧/.test(await p.textContent('#modal-box')), 'F1 で操作の一覧');
  await p.keyboard.press('Escape');
  await p.keyboard.press('e');
  ok(await ev(() => document.getElementById('panel').hidden), 'E でパネルをしまう');
  await p.keyboard.press('e');
  ok(await ev(() => !document.getElementById('panel').hidden && __iv.settings.panel === true), 'E でパネルを出す (設定に覚える)');
  // 入力欄で打っている間は、ショートカットが効かない
  await p.click('#rs-value');
  await p.keyboard.type('r');
  ok(await ev(() => __iv.S.edit.rot === 0), '入力欄で打っている間は、R で回転しない');
  await p.keyboard.press('Escape');
  await p.mouse.move(5, 5);

  // プリセットの編集
  await p.click('button[data-act="presetEdit"]');
  await p.waitForSelector('#modal:not([hidden])');
  const rows = await p.locator('#modal-box .preset-row:not(.preset-head)').count();
  await p.locator('#modal-box .preset-row:not(.preset-head) input[type="text"]').first().fill('NOTE 用');
  await p.locator('#modal-box button', { hasText: '追加' }).click();
  await p.locator('#modal-box button', { hasText: '決定' }).click();
  ok(await ev((rows) => __iv.settings.presets.length === rows + 1 && __iv.settings.presets[0].label === 'NOTE 用' && document.querySelectorAll('#presets button').length === rows + 1, rows), 'プリセットを編集・追加できる');
  ok(await ev(() => JSON.parse(localStorage.getItem('iv.settings.v1')).presets[0].label === 'NOTE 用'), '設定は保存される');

  // 読み直しても設定が残る
  await p.goto('http://localhost:8770/');
  await p.waitForFunction(() => window.__iv);
  ok(await ev(() => __iv.settings.presets[0].label === 'NOTE 用' && !document.getElementById('panel').hidden), '開き直しても、プリセットとパネルの状態が残る');
  ok(await ev(() => !document.getElementById('empty').hidden), '何も開いていないときは、案内が出る');
}

// ----------------------------------------------------------------------
section('速さ (この環境は GPU なし。数字は目安)');
{
  await ev(async (path) => { await __iv.openPath(path); }, F('zz_big.jpg'));
  await p.waitForFunction(() => __iv.S.item && __iv.S.item.name === 'zz_big.jpg' && __iv.S.bmp, null, { timeout: 30000 });
  const t = await ev(async () => {
    const out = {}, time = async (name, fn) => { const t = performance.now(); await fn(); out[name] = Math.round(performance.now() - t); };
    await time('右へ 90 度 (12 MP)', () => __iv.doRotate(1));
    await time('明るさを動かす 1 回 (初回)', () => { __iv.S.edit.adj.brightness = 10; __iv.rebuild(); });
    await time('明るさを動かす 1 回 (2 回目以降)', () => { __iv.S.edit.adj.brightness = 20; __iv.rebuild(); });
    await time('モザイクを 1 つ足す', () => { __iv.S.edit.marks.push({ type: 'mosaic', x: 100, y: 100, w: 800, h: 600, size: 16 }); __iv.rebuild(); });
    __iv.resetAll();
    return out;
  });
  for (const [k, v] of Object.entries(t)) console.log(`     ${k}: ${v} ms`);
  ok(true, '12 MP の絵で一通り動く');
}

// ----------------------------------------------------------------------
section('設定');
{
  await p.goto('http://localhost:8770/?open=' + encodeURIComponent(F('grad.png')));
  await p.waitForFunction(() => window.__iv && __iv.S.bmp);
  await ev(() => { if (document.getElementById('panel').hidden) __iv.togglePanel(true); });
  // 並び順を「新しい順」に。いま見ている画像は変わらない。
  await p.selectOption('#set-sort', 'mtime');
  const r = await ev(() => ({ cur: __iv.S.item.name, at: __iv.folder.items[__iv.folder.index].name, m: __iv.folder.items.map((i) => i.mtime) }));
  ok(r.cur === 'grad.png' && r.at === 'grad.png' && r.m.every((v, i) => i === 0 || r.m[i - 1] >= v), '並び順を「新しい順」にしても、見ている画像はそのまま');
  await p.selectOption('#set-sort', 'name');
  // ホイールを「拡大・縮小」に
  await p.selectOption('#set-wheel', 'zoom');
  await p.mouse.move(400, 300);
  await p.mouse.wheel(0, -100);
  ok(await ev(() => __iv.S.item.name === 'grad.png' && !__iv.view.fitMode), 'ホイールを「拡大・縮小」にすると、送らずに拡大する');
  await p.selectOption('#set-wheel', 'nav');
}

// ----------------------------------------------------------------------
section('キーの割り当て');
{
  const modalText = () => ev(() => document.getElementById('modal').hidden ? '' : document.getElementById('modal-box').textContent);
  const row = (label) => p.locator('.key-row', { hasText: label }).first();
  await p.goto('http://localhost:8770/?open=' + encodeURIComponent(F('grad.png')));
  await p.waitForFunction(() => window.__iv && __iv.S.bmp);
  await ev(() => __iv.resetAll());

  // 下の「操作の一覧」と、「72%」のクリック
  ok(/F1/.test(await ev(() => document.getElementById('st-help').textContent)), '下の行に「操作の一覧 F1」が出ている');
  await p.click('#st-help');
  await p.waitForFunction(() => !document.getElementById('modal').hidden);
  const help = await modalText();
  ok(/操作の一覧/.test(help) && /Ctrl \+ 1/.test(help) && /ごみ箱へ送る/.test(help), '下の行を押すと、操作の一覧が出る (表から作られている)');
  await p.keyboard.press('Escape');
  await p.waitForFunction(() => document.getElementById('modal').hidden);
  const z0 = await ev(() => __iv.view.scale);
  await p.click('#st-zoom');
  const z1 = await ev(() => __iv.view.scale);
  await p.click('#st-zoom');
  const z2 = await ev(() => __iv.view.scale);
  ok(Math.abs(z2 - z0) < 1e-9 && z1 !== z0 || Math.abs(z1 - z0) < 1e-9, '「%」を押すと、全体 ⇔ 等倍 に切り替わる');

  // F1 → 「キーを変える」
  await p.keyboard.press('F1');
  await p.waitForFunction(() => !document.getElementById('modal').hidden);
  await p.click('#modal-box button:has-text("キーを変える")');
  await p.waitForSelector('.key-row');
  ok(/キーの設定/.test(await modalText()), 'F1 → 「キーを変える」で、設定画面が出る');

  // 右回転に Alt + X を足す
  await row('右へ 90 度').locator('.key-add').click();
  await p.keyboard.press('Alt+X');
  await p.waitForFunction(() => [...document.querySelectorAll('.key-row')].some((r) => /右へ 90 度/.test(r.textContent) && /Alt \+ X/.test(r.textContent)));
  ok(true, '「＋」→ キーを押すと、割り当てが増える');
  // 衝突: 右回転に H → 左右反転から H が外れる
  await row('右へ 90 度').locator('.key-add').click();
  await p.keyboard.press('H');
  await p.waitForFunction(() => /から外して/.test(document.querySelector('.key-note').textContent));
  ok(/左右反転/.test(await ev(() => document.querySelector('.key-note').textContent)), '使われているキーを選ぶと、元の操作から外れて、そう知らせる');
  ok(!/\bH\b/.test(await row('左右反転').locator('.key-cell').textContent()), '左右反転の札から H が消えた');
  // 待っている間の Esc は、取りやめるだけで、画面は閉じない
  await row('上下反転').locator('.key-add').click();
  await p.keyboard.press('Escape');
  await p.waitForSelector('.key-row');
  ok(true, '登録を待っている間の Esc は、取りやめるだけ (画面は閉じない)');
  await p.click('#modal-box button:has-text("閉じる")');
  await p.waitForFunction(() => document.getElementById('modal').hidden);

  // 効いているか
  await ev(() => __iv.resetAll());
  await p.keyboard.press('Alt+X');
  ok(await ev(() => __iv.S.edit.rot === 90), '足したキー (Alt + X) で右回転する');
  await ev(() => __iv.resetAll());
  await p.keyboard.press('h');
  ok(await ev(() => __iv.S.edit.rot === 90 && !__iv.S.edit.flip), 'H は右回転になり、左右反転は効かなくなった');
  await ev(() => __iv.resetAll());
  await p.keyboard.press('r');
  ok(await ev(() => __iv.S.edit.rot === 90), '元のキー (R) も、外していなければ効く');
  await ev(() => __iv.resetAll());
  ok(await ev(() => document.querySelector('#panel [data-act="flipH"]').title) === '左右反転', 'ボタンの吹き出しも追従する (H を外した左右反転からキーの表示が消えた)');

  // 覚えている (読み直しても残る)
  await p.reload();
  await p.waitForFunction(() => window.__iv && __iv.S.bmp);
  await p.keyboard.press('Alt+X');
  ok(await ev(() => __iv.S.edit.rot === 90), '読み直しても、割り当てが残っている');
  await ev(() => __iv.resetAll());
  ok(await ev(() => !!JSON.parse(localStorage.getItem('iv.settings.v1')).keys.rotR), '変えた分だけ、設定に覚えている');

  // 最初の状態に戻す
  await p.keyboard.press('F1');
  await p.waitForFunction(() => !document.getElementById('modal').hidden);
  ok(/Alt \+ X/.test(await modalText()), '操作の一覧にも、変えたキーが出る');
  await p.click('#modal-box button:has-text("キーを変える")');
  await p.waitForSelector('.key-row');
  await p.click('#modal-box button:has-text("最初の状態に戻す")');
  await p.click('#modal-box button:has-text("閉じる")');
  await p.waitForFunction(() => document.getElementById('modal').hidden);
  await p.keyboard.press('h');
  ok(await ev(() => !!__iv.S.edit.flip && __iv.S.edit.rot === 0), '最初の状態に戻すと、H は左右反転に戻る');
  await ev(() => __iv.resetAll());
  await p.keyboard.press('Alt+X');
  ok(await ev(() => __iv.S.edit.rot === 0), '足したキーは、もう効かない');
  ok(await ev(() => Object.keys(JSON.parse(localStorage.getItem('iv.settings.v1')).keys).length === 0), '設定の中身も、空に戻る');
}

// ----------------------------------------------------------------------
section('WebP に書き出せない環境 (Mac / Linux の WebView)');
{
  // toBlob に WebP を頼むと、黙って PNG を返す WebView を真似る
  const ctx3 = await b.newContext({ viewport: { width: 1000, height: 700 } });
  await ctx3.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (cb, type, q) { return orig.call(this, cb, type === 'image/webp' ? 'image/png' : type, q); };
  });
  const q = await ctx3.newPage();
  await q.goto('http://localhost:8770/?open=' + encodeURIComponent(F('grad.png')));
  await q.waitForFunction(() => window.__iv && __iv.S.bmp, null, { timeout: 20000 });
  await q.evaluate(() => localStorage.clear());
  await q.reload();
  await q.waitForFunction(() => window.__iv && __iv.S.bmp, null, { timeout: 20000 });
  const out = await q.evaluate(() => __iv.quickExport(0)); // 既定のプリセット 1 番は WebP
  ok(out && out.endsWith('.jpg') && fs.existsSync(out), 'WebP のプリセットは、JPEG にして書き出す: ' + (out && path.basename(out)));
  ok(/JPEG にした/.test(await q.evaluate(() => document.getElementById('toasts').textContent)), 'そう知らせる');
  if (out) fs.rmSync(out, { force: true });
  await ctx3.close();
}

// ----------------------------------------------------------------------
section('パスの扱い (Windows の形も)');
{
  const r = await ev(async () => {
    const b = await import('./backend.js');
    return [
      b.dirname('C:\\Users\\fixjp\\Pictures\\a.png'), b.dirname('C:\\a.png'), b.dirname('/home/x/a.png'), b.dirname('/a.png'), b.dirname('\\\\server\\share\\a.png'),
      b.basename('C:\\Users\\fixjp\\Pictures\\スクショ 1.png'), b.stem('C:\\x\\a.b.PNG'), b.extname('C:\\x\\a.b.PNG'), b.extname('C:\\x\\noext'), b.extname('C:\\x\\.hidden'),
      b.join('C:\\x', 'a.png'), b.join('C:\\', 'a.png'), b.join('/home/x', 'a.png'), b.join('/', 'a.png'),
    ];
  });
  const want = ['C:\\Users\\fixjp\\Pictures', 'C:\\', '/home/x', '/', '\\\\server\\share', 'スクショ 1.png', 'a.b', 'png', '', '', 'C:\\x\\a.png', 'C:\\a.png', '/home/x/a.png', '/a.png'];
  const bad = r.map((v, i) => (v === want[i] ? null : `${i}: ${v} (正解 ${want[i]})`)).filter(Boolean);
  ok(bad.length === 0, 'フォルダ名・ファイル名・拡張子の取り出しと、つなぎ方 (14 通り)' + (bad.length ? ' ' + bad.join(' / ') : ''));
}

// ----------------------------------------------------------------------
section('画面の拡大縮小が 150% のとき (Windows の表示設定)');
{
  const ctx2 = await b.newContext({ viewport: { width: 1000, height: 700 }, deviceScaleFactor: 1.5 });
  const q = await ctx2.newPage();
  await q.goto('http://localhost:8770/?open=' + encodeURIComponent(F('grad.png')));
  await q.waitForFunction(() => window.__iv && __iv.S.bmp);
  await q.evaluate(() => __iv.togglePanel(false));
  await q.waitForTimeout(200);
  const r = await q.evaluate(async () => {
    const v = __iv.view, cv = document.getElementById('view');
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    // 元の絵の画素
    const c = document.createElement('canvas'); c.width = 256; c.height = 256;
    const g = c.getContext('2d'); g.drawImage(__iv.S.bmp, 0, 0);
    const src = g.getImageData(0, 0, 256, 256).data;
    // 画面の canvas の画素 (実際の画面の画素の単位)
    const dpr = v.dpr, x0 = Math.round(v.ox * dpr), y0 = Math.round(v.oy * dpr);
    const scr = cv.getContext('2d').getImageData(x0, y0, 256, 256).data;
    let diff = 0;
    for (let i = 0; i < src.length; i++) if (src[i] !== scr[i]) diff++;
    return { dpr, scale: v.scale, zoom: document.getElementById('st-zoom').textContent, diff, cvW: cv.width, cssW: cv.clientWidth };
  });
  ok(r.dpr === 1.5 && Math.abs(r.scale - 1 / 1.5) < 1e-9 && r.zoom === '100%', `等倍は「絵の 1 画素 = 画面の 1 画素」 (scale ${r.scale.toFixed(3)}、表示 ${r.zoom})`);
  ok(r.cvW === Math.round(r.cssW * 1.5), 'canvas の画素数は、実際の画面の画素数');
  ok(r.diff === 0, '等倍のとき、画面の画素が元の絵と 1 つも違わない (にじまない)');
  await ctx2.close();
}

console.log('');
ok(errs.length === 0, 'ページのエラーなし' + (errs.length ? ': ' + errs.join(' | ') : ''));
console.log(`\n${pass} 件 OK、${fail} 件 FAIL`);
await b.close();
process.exit(fail ? 1 : 0);
