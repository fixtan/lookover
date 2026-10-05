// folder.js — いま見ているフォルダと、その中の画像の並び
//
// 画像を 1 枚開くと、同じフォルダの画像を全部並べて、← → で送れるようにする。
// 前後の画像は先に読んでおくので、送ったときにすぐ出る。

import { listDir, fileInfo, readFile, dirname, extname } from './backend.js';
import { decode, isImageExt } from './decode.js';

// 「img2」が「img10」より前に来る並べ方 (エクスプローラーと同じ)
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

const KEEP = 5;                   // 開いた絵を何枚まで覚えておくか
const PRELOAD_MAX = 40 * 1048576; // これより大きいファイルは先読みしない (40 MB)

export class Folder {
  constructor() {
    this.dir = '';
    this.items = [];   // 画像だけ。[{ name, path, size, mtime, ctime }]
    this.index = -1;
    this.sort = 'name'; // 'name' | 'mtime'
    this.cache = new Map(); // path → Promise<{ bitmap, width, height }>
    this.pinned = '';       // 画面に出している絵のパス。これは捨てない (捨てると描けなくなる)
  }

  get current() { return this.items[this.index] || null; }
  get count() { return this.items.length; }

  // path がファイルなら、そのフォルダを並べて、そのファイルを指す。
  // フォルダなら、その中の最初の画像を指す。
  async open(path) {
    const info = await fileInfo(path);
    const dir = info.isDir ? path : dirname(path);
    await this.load(dir);
    if (info.isDir) {
      this.index = this.items.length ? 0 : -1;
    } else {
      this.index = this.items.findIndex((e) => e.path === path);
      // 一覧に無い (知らない拡張子) 場合も、そのファイルだけは開けるようにする
      if (this.index < 0) {
        this.items.push({ name: info.name, path, size: info.size, mtime: info.mtime, ctime: info.ctime });
        this.order();
        this.index = this.items.findIndex((e) => e.path === path);
      }
    }
    return this.current;
  }

  async load(dir) {
    const all = await listDir(dir);
    this.dir = dir;
    this.items = all.filter((e) => !e.isDir && isImageExt(extname(e.name)));
    this.order();
  }

  order() {
    if (this.sort === 'mtime') this.items.sort((a, b) => b.mtime - a.mtime || collator.compare(a.name, b.name));
    else this.items.sort((a, b) => collator.compare(a.name, b.name));
  }

  // フォルダを読み直す (書き出しや削除のあと)。いま指しているファイルは保つ。
  // 無くなっていたら、同じ位置の次のファイルを指す。
  async refresh() {
    if (!this.dir) return;
    const cur = this.current, at = this.index;
    await this.load(this.dir);
    const i = cur ? this.items.findIndex((e) => e.path === cur.path) : -1;
    this.index = i >= 0 ? i : Math.min(at, this.items.length - 1);
  }

  // 送る。step は +1 / -1 など。端では止まる。動いたら true。
  move(step) {
    if (!this.items.length) return false;
    const i = Math.max(0, Math.min(this.items.length - 1, this.index + step));
    if (i === this.index) return false;
    this.index = i;
    return true;
  }

  goto(i) {
    if (i < 0 || i >= this.items.length || i === this.index) return false;
    this.index = i;
    return true;
  }

  // 1 枚を開いて絵にする。同じファイルを二度読まないよう、結果を覚えておく。
  load1(item) {
    let p = this.cache.get(item.path);
    if (p) {
      // 使ったものを末尾へ回す (古い順に捨てるため)
      this.cache.delete(item.path);
      this.cache.set(item.path, p);
      return p;
    }
    p = readFile(item.path).then((bytes) => decode(bytes, extname(item.name)));
    this.cache.set(item.path, p);
    // 失敗したものは覚えない (次に開いたとき、もう一度試せるように)
    p.catch(() => { if (this.cache.get(item.path) === p) this.cache.delete(item.path); });
    this.trim();
    return p;
  }

  // 覚えすぎたら、古いものから捨てる。絵はメモリを食うので、閉じてから捨てる。
  trim() {
    let kept = 0;
    while (this.cache.size > KEEP) {
      const [path, p] = this.cache.entries().next().value;
      if ((this.current && path === this.current.path) || path === this.pinned) {
        // いま指しているもの・画面に出ているものは捨てない。末尾へ回して次を見る。
        this.cache.delete(path); this.cache.set(path, p);
        if (++kept > this.cache.size) break; // 全部が「捨てない」ものだった
        continue;
      }
      this.cache.delete(path);
      p.then((d) => d.bitmap.close && d.bitmap.close()).catch(() => {});
    }
  }

  // 覚えている絵を捨てる (ファイルを書き換えたあとなど)
  forget(path) {
    // ここでは絵を閉じない。まだ画面に出ているかもしれないので、片づけはブラウザに任せる。
    this.cache.delete(path);
  }

  // 前後の 1 枚ずつを先に読んでおく
  preload() {
    for (const d of [1, -1]) {
      const it = this.items[this.index + d];
      if (it && it.size <= PRELOAD_MAX) this.load1(it).catch(() => {});
    }
  }
}
