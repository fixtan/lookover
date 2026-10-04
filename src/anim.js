// anim.js — 動く画像 (アニメーション GIF / WebP) を、コマ送りで再生する
//
// ブラウザの ImageDecoder という機能で、1 コマずつ取り出す。
// この機能が無い環境では、decode.js が「動かない画像」として扱うので、ここは呼ばれない。

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Player {
  // anim   : { bytes, type, frames } (decode.js が調べたもの)
  // onFrame: 新しいコマが取れるたびに呼ぶ。(frame, 何コマ目か)
  //          frame は使い終わったら close() すること (呼ぶ側の責任)。
  constructor(anim, onFrame) {
    this.dec = new ImageDecoder({ data: anim.bytes, type: anim.type });
    this.n = anim.frames;
    this.i = 0;
    this.stopped = false;
    this.onFrame = onFrame;
    this.loop();
  }

  async loop() {
    try {
      while (!this.stopped) {
        const t0 = performance.now();
        const { image } = await this.dec.decode({ frameIndex: this.i });
        if (this.stopped) { image.close(); break; }
        // 1 コマを出しておく時間。単位はマイクロ秒で入っている。
        // 0 や極端に短い値は、ブラウザと同じく 0.1 秒として扱う。
        let ms = (image.duration || 0) / 1000;
        if (ms < 20) ms = 100;
        this.onFrame(image, this.i);
        this.i = (this.i + 1) % this.n;
        await sleep(Math.max(0, ms - (performance.now() - t0)));
      }
    } catch (e) {
      // 途中で止められた・コマを取り出せなかった。再生をやめるだけで、表示は最初の 1 コマに戻る。
    }
  }

  stop() {
    this.stopped = true;
    try { this.dec.close(); } catch (e) { /* すでに閉じている */ }
  }
}
