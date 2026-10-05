// settings.js — 設定を覚えておく (アプリを閉じても残る)
//
// 置き場所は localStorage。Tauri の画面はアプリ専用のブラウザなので、ほかのアプリやサイトとは混ざらない。

const KEY = 'iv.settings.v1';

const DEFAULTS = {
  // ワンキー書き出しの設定。Ctrl + 1, 2, 3 … の順。
  //   long     : 長い辺の上限 (px)。0 なら縮めない。元が小さければ引き伸ばさない。
  //   suffix   : 元のファイル名の後ろに足す文字
  //   overwrite: 同じ名前の書き出しがすでにあるとき、置き換えるか (false なら -2, -3 … を付ける)
  //   dir      : 書き出し先のフォルダ。空なら、元の画像と同じフォルダ。
  presets: [
    { label: 'WebP 長辺 1920', long: 1920, format: 'webp', quality: 85, suffix: '_1920', overwrite: false, dir: '' },
    { label: 'WebP 原寸', long: 0, format: 'webp', quality: 90, suffix: '', overwrite: false, dir: '' },
    { label: 'JPEG 長辺 1280', long: 1280, format: 'jpeg', quality: 85, suffix: '_1280', overwrite: false, dir: '' },
  ],
  format: 'webp',   // 「名前を付けて保存」の最初の形式
  quality: 85,
  panel: false,     // 編集パネルを開いているか
  wheel: 'nav',     // ホイールの動き: 'nav' = 前後の画像へ、'zoom' = 拡大・縮小
  sort: 'name',     // 並び順: 'name' = 名前、'mtime' = 新しい順
  markSize: 16,
  markColor: '#000000', // 塗りつぶしの色
  penColor: '#ff3b30',  // 枠と矢印の色
  lastDir: '',
  info: false,      // 画像の情報を左上に重ねているか (画像を替えても、再起動しても、そのまま)
  infoGps: false,   // 情報に、撮影場所の座標まで出すか (false なら「あり」とだけ)
  confirmDelete: true, // ごみ箱へ送る前に確認するか (ごみ箱なので、消しても戻せる)
  keys: {},          // 変えたキーの割り当て { 処理の名前: [キー, …] }。keys.js が読み書きする
};

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { ...structuredClone(DEFAULTS), ...saved };
  } catch (e) {
    return structuredClone(DEFAULTS);
  }
}

export const settings = load();

export function saveSettings() {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch (e) { /* 保存できなくても、動作は続ける */ }
}

export const defaultPresets = () => structuredClone(DEFAULTS.presets);
