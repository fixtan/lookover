// backend.js — ディスクや窓に触る仕事を、1 か所にまとめる
//
// 画面側のほかのファイルは、ここの関数だけを呼ぶ。相手は 2 通りある。
//   1. Tauri (本番)      … Rust 側のコマンドを invoke で呼ぶ
//   2. 開発用サーバー     … ブラウザで開いたとき。/api/... へ HTTP で頼む (test/serve.mjs)
// 2 があるおかげで、Tauri を起動しなくても、ブラウザと自動試験で画面側を確かめられる。

const T = window.__TAURI__;
export const isTauri = !!T;

const invoke = (cmd, args, opt) => T.core.invoke(cmd, args, opt);
const api = (name, params) => '/api/' + name + '?' + new URLSearchParams(params);

async function http(name, params, init) {
  const res = await fetch(api(name, params), init);
  if (!res.ok) throw new Error(await res.text());
  return res;
}

// Rust 側の名前 (is_dir) を、画面側の呼び方 (isDir) にそろえる
const entry = (e) => ({ name: e.name, path: e.path, size: e.size, mtime: e.mtime, ctime: e.ctime || 0, isDir: e.is_dir });

// ---- ファイル ----

// フォルダの中身。[{ name, path, size, mtime, ctime, isDir }]
export async function listDir(dir) {
  const list = isTauri ? await invoke('list_dir', { dir }) : await (await http('list', { dir })).json();
  return list.map(entry);
}

export async function fileInfo(path) {
  return entry(isTauri ? await invoke('file_info', { path }) : await (await http('info', { path })).json());
}

// ファイルの中身を ArrayBuffer で
export async function readFile(path) {
  if (isTauri) return await invoke('read_file', { path });
  return await (await http('read', { path })).arrayBuffer();
}

// bytes (Uint8Array) をファイルに書く。
// Tauri では、中身をそのままのバイト列で送り、書き込み先はヘッダーに入れる。
// ヘッダーには日本語を入れられないので、encodeURIComponent で英数字だけの形にする。
export async function writeFile(path, bytes) {
  if (isTauri) return await invoke('write_file', bytes, { headers: { 'x-path': encodeURIComponent(path) } });
  await http('write', { path }, { method: 'POST', body: bytes });
}

export async function exists(path) {
  if (isTauri) return await invoke('path_exists', { path });
  return (await (await http('exists', { path })).json()).exists;
}

// ごみ箱へ送る
export async function trash(path) {
  if (isTauri) return await invoke('trash_file', { path });
  await http('trash', { path }, { method: 'POST' });
}

// 名前を変える (同じ名前がすでにあれば失敗する)
export async function rename(from, to) {
  if (isTauri) return await invoke('rename_file', { from, to });
  await http('rename', { from, to }, { method: 'POST' });
}

// エクスプローラーで場所を開く
export async function reveal(path) {
  if (isTauri) return await invoke('reveal', { path });
}

// ---- 起動と、外から渡されるファイル ----

// 起動時に渡されたファイル (画像をダブルクリックして開いたとき)
export async function startupPaths() {
  if (isTauri) return await invoke('startup_paths');
  const p = new URLSearchParams(location.search).get('open');
  return p ? [p] : [];
}

// 起動時の引数をそのまま。試験用の合図 (--selftest=...) を見るために使う。
export async function startupArgs() {
  if (isTauri) return await invoke('startup_args');
  return [];
}

// ファイルを落とされた / 2 つ目の起動から渡された、を受け取る
export function onOpenPaths(fn) {
  if (isTauri) T.event.listen('open-paths', (e) => fn(e.payload));
}

// ---- 窓 ----

export function setTitle(title) {
  document.title = title;
  if (isTauri) invoke('set_title', { title });
}

// 窓を閉じる (開発用のブラウザでは、閉じられるときだけ閉じる)
export async function closeWindow() {
  if (isTauri) return await invoke('close_window');
  window.close();
}

export async function setFullscreen(on) {
  if (isTauri) return await invoke('set_fullscreen', { on });
  if (on) await document.documentElement.requestFullscreen?.();
  else if (document.fullscreenElement) await document.exitFullscreen();
}

export async function isFullscreen() {
  if (isTauri) return await invoke('is_fullscreen');
  return !!document.fullscreenElement;
}

// ---- ファイルを選ぶ ----

// 開くファイルを選ばせる。選ばなければ null。
export async function pickOpen() {
  if (isTauri) return await invoke('pick_open');
  return window.__DEV_PICK ? window.__DEV_PICK('open') : prompt('開くファイルのパス');
}

// 保存先を選ばせる。選ばなければ null。
export async function pickSave(defaultPath) {
  if (isTauri) return await invoke('pick_save', { defaultPath });
  return window.__DEV_PICK ? window.__DEV_PICK('save', defaultPath) : prompt('保存先のパス', defaultPath);
}

// ---- パスの文字列を扱う小物 (Windows の \ と、それ以外の / の両方に対応) ----

const lastSep = (p) => Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
const sepOf = (p) => (p.includes('\\') ? '\\' : '/');

// 'C:\a\b.png' → 'C:\a'、'C:\b.png' → 'C:\'、'/b.png' → '/'
export function dirname(p) {
  const i = lastSep(p);
  if (i < 0) return '';
  const head = p.slice(0, i);
  if (head === '' || /^[A-Za-z]:$/.test(head)) return p.slice(0, i + 1);
  return head;
}

export const basename = (p) => p.slice(lastSep(p) + 1);

// 拡張子 (小文字、点なし)。無ければ ''
export function extname(p) {
  const b = basename(p), i = b.lastIndexOf('.');
  return i <= 0 ? '' : b.slice(i + 1).toLowerCase();
}

// 拡張子を除いた名前
export function stem(p) {
  const b = basename(p), i = b.lastIndexOf('.');
  return i <= 0 ? b : b.slice(0, i);
}

export function join(dir, name) {
  if (!dir) return name;
  return /[\\/]$/.test(dir) ? dir + name : dir + sepOf(dir) + name;
}
