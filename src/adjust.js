// adjust.js — 色の調整 (明るさ・コントラスト・彩度・色温度・色かぶり・ハイライト・シャドウ・シャープ)
//
// 同じ計算を 2 通りに書いてある。
//   adjustGL  … GPU で計算する (WebGL2)。速い。ふだんはこちら。
//   adjustCPU … JavaScript で 1 画素ずつ計算する。遅いが、どこでも動く。
// GPU が使えないとき・絵が大きすぎて GPU に載らないときは、CPU に切り替わる。
// 2 つが同じ結果になることは、自動試験で確かめている。
//
// どの値も画面では -100 〜 100 で、ここでは -1 〜 1 に直して使う。

// ---- 計算の中身 (この順に当てる) ----
//   1. シャープ     : 上下左右の画素との差を足して、輪郭を強める
//   2. 色温度・色かぶり: 赤と青、緑の強さを変える
//   3. 明るさ       : 全体を 2 の累乗で掛ける (+100 で 2 倍、-100 で半分)
//   4. シャドウ・ハイライト: 暗い所だけ・明るい所だけを持ち上げる (または下げる)
//   5. コントラスト  : 中間の灰色 (0.5) からの離れ方を伸び縮みさせる
//   6. 彩度         : 灰色からの離れ方を伸び縮みさせる

const norm = (adj) => ({
  br: adj.brightness / 100, co: adj.contrast / 100, sa: adj.saturation / 100,
  te: adj.temperature / 100, ti: adj.tint / 100,
  hi: adj.highlights / 100, sh: adj.shadows / 100, sp: Math.max(0, adj.sharpen) / 100,
});

const FRAG = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uPx;      // 1 画素ぶんの大きさ (テクスチャ座標で)
uniform float br, co, sa, te, ti, hi, sh, sp;
in vec2 vUv;
out vec4 outColor;
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
void main() {
  vec4 t = texture(uTex, vUv);
  vec3 c = t.rgb;
  if (sp > 0.0) {
    vec3 n = texture(uTex, vUv + vec2(uPx.x, 0.0)).rgb + texture(uTex, vUv - vec2(uPx.x, 0.0)).rgb
           + texture(uTex, vUv + vec2(0.0, uPx.y)).rgb + texture(uTex, vUv - vec2(0.0, uPx.y)).rgb;
    c = c + sp * 0.5 * (4.0 * c - n);
  }
  c.r *= 1.0 + 0.25 * te;
  c.b *= 1.0 - 0.25 * te;
  c.g *= 1.0 - 0.25 * ti;
  c *= pow(2.0, br);
  float L = clamp(luma(c), 0.0, 1.0);
  c *= 1.0 + sh * 0.8 * (1.0 - L) * (1.0 - L);
  c *= 1.0 + hi * 0.5 * L * L;
  c = (c - 0.5) * (1.0 + co * 0.8) + 0.5;
  float g = luma(c);
  c = vec3(g) + (c - vec3(g)) * (1.0 + sa);
  outColor = vec4(clamp(c, 0.0, 1.0), t.a);
}`;

// 画面いっぱいの三角形を 1 枚描くだけ。絵の上端が canvas の上端に来るよう、縦を反転して対応させる。
const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = vec2((aPos.x + 1.0) * 0.5, (1.0 - aPos.y) * 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

let glc = null; // { cv, gl, prog, loc, tex, max }。一度作ったら使い回す。
let glBroken = false;

function initGL() {
  if (glc || glBroken) return glc;
  try {
    const cv = document.createElement('canvas');
    // premultipliedAlpha: false … 半透明の画素の色を、透明度で掛けない形のまま扱う
    const gl = cv.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false });
    if (!gl) throw new Error('webgl2 が使えない');
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const a = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    const loc = {};
    for (const n of ['uTex', 'uPx', 'br', 'co', 'sa', 'te', 'ti', 'hi', 'sh', 'sp']) loc[n] = gl.getUniformLocation(prog, n);
    cv.addEventListener('webglcontextlost', () => { glc = null; });
    glc = { cv, gl, loc, tex, max: gl.getParameter(gl.MAX_TEXTURE_SIZE), srcOf: null };
  } catch (e) {
    console.warn('GPU での色調整は使えない。CPU で計算する。', e);
    glBroken = true;
    glc = null;
  }
  return glc;
}

// GPU で計算して、結果を out (2D の canvas) に描く。できなければ false。
// same = true なら、前回と同じ絵なので、GPU への転送を省く (スライダーを動かしている間)。
export function adjustGL(src, w, h, adj, out, same = false) {
  const c = initGL();
  if (!c || w > c.max || h > c.max) return false;
  const { cv, gl, loc } = c;
  try {
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; c.srcOf = null; }
    gl.viewport(0, 0, w, h);
    if (!same || c.srcOf !== src) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      c.srcOf = src;
    }
    const n = norm(adj);
    gl.uniform1i(loc.uTex, 0);
    gl.uniform2f(loc.uPx, 1 / w, 1 / h);
    for (const k of ['br', 'co', 'sa', 'te', 'ti', 'hi', 'sh', 'sp']) gl.uniform1f(loc[k], n[k]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (gl.getError() !== gl.NO_ERROR) throw new Error('描画に失敗');
    if (out.width !== w || out.height !== h) { out.width = w; out.height = h; }
    const g = out.getContext('2d');
    g.globalCompositeOperation = 'copy'; // 透明な部分も含めて、そのまま置き換える
    g.drawImage(cv, 0, 0);
    g.globalCompositeOperation = 'source-over';
    return true;
  } catch (e) {
    console.warn('GPU での色調整に失敗。CPU で計算する。', e);
    return false;
  }
}

// CPU で計算して、結果を out に描く。GLSL と同じ式を、同じ順に。
export function adjustCPU(src, w, h, adj, out) {
  const tmp = document.createElement('canvas');
  tmp.width = w; tmp.height = h;
  const tg = tmp.getContext('2d', { willReadFrequently: true });
  tg.drawImage(src, 0, 0);
  const img = tg.getImageData(0, 0, w, h);
  const d = img.data;
  const n = norm(adj);
  const o = n.sp > 0 ? new Uint8ClampedArray(d) : d; // シャープは「元の値」の隣を見るので、控えを取る
  const kr = 1 + 0.25 * n.te, kb = 1 - 0.25 * n.te, kg = 1 - 0.25 * n.ti;
  const ev = 2 ** n.br, kc = 1 + n.co * 0.8, ks = 1 + n.sa;
  const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  for (let y = 0, p = 0; y < h; y++) {
    // 端の画素は、外側の代わりに自分自身を見る (GPU の CLAMP_TO_EDGE と同じ)
    const up = y > 0 ? -w * 4 : 0, dn = y < h - 1 ? w * 4 : 0;
    for (let x = 0; x < w; x++, p += 4) {
      let r = o[p] / 255, g = o[p + 1] / 255, b = o[p + 2] / 255;
      if (n.sp > 0) {
        const lf = x > 0 ? -4 : 0, rt = x < w - 1 ? 4 : 0;
        const k = n.sp * 0.5;
        r += k * (4 * r - (o[p + lf] + o[p + rt] + o[p + up] + o[p + dn]) / 255);
        g += k * (4 * g - (o[p + 1 + lf] + o[p + 1 + rt] + o[p + 1 + up] + o[p + 1 + dn]) / 255);
        b += k * (4 * b - (o[p + 2 + lf] + o[p + 2 + rt] + o[p + 2 + up] + o[p + 2 + dn]) / 255);
      }
      r *= kr * ev; g *= kg * ev; b *= kb * ev;
      const L = Math.max(0, Math.min(1, luma(r, g, b)));
      const m = (1 + n.sh * 0.8 * (1 - L) * (1 - L)) * (1 + n.hi * 0.5 * L * L);
      r = (r * m - 0.5) * kc + 0.5; g = (g * m - 0.5) * kc + 0.5; b = (b * m - 0.5) * kc + 0.5;
      const gr = luma(r, g, b);
      d[p] = (gr + (r - gr) * ks) * 255;
      d[p + 1] = (gr + (g - gr) * ks) * 255;
      d[p + 2] = (gr + (b - gr) * ks) * 255;
    }
  }
  if (out.width !== w || out.height !== h) { out.width = w; out.height = h; }
  out.getContext('2d').putImageData(img, 0, 0);
  return true;
}

// 色の調整を当てて、out に描く。GPU が使えればそちらで。
export function applyAdjust(src, w, h, adj, out, same = false) {
  return adjustGL(src, w, h, adj, out, same) || adjustCPU(src, w, h, adj, out);
}
