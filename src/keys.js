// keys.js — キーの割り当て (どのキーで、何が起きるか)
//
// 「操作の表」を 1 か所に置く。キーを押したときの処理 (main.js)、操作の一覧 (F1)、キーの設定画面は、
// どれもこの表から作る。だから、キーを変えれば、一覧や吹き出しの表示も一緒に変わる。
//
// キーは文字列で持つ。例: 'R'、'Shift+R'、'Ctrl+Shift+S'、'ArrowRight'、'F11'
//   修飾キーは Ctrl, Alt, Shift の順。Mac の Cmd は Ctrl として扱う。
//   英字と数字は、キーボードの配列に関わらず、キーの位置で決める (日本語配列でも英語配列でも同じ)。
//   記号 (+ - ? など) は、出る文字で決める。Shift は文字に含まれているので付けない。

import { settings, saveSettings } from './settings.js';

// id        : 処理の名前 (main.js の HANDLERS と同じ)
// group     : 一覧での見出し
// label     : 一覧に出す説明
// keys      : 最初に割り当てるキー
// ほかに固定のキー (Esc、Ctrl + V、切り抜き中の矢印) は、ここに入れない。
export const ACTION_TABLE = [
  // ---- 見る ----
  { id: 'next', group: '見る', label: '次の画像', keys: ['ArrowRight', 'ArrowDown', 'PageDown', 'Space'] },
  { id: 'prev', group: '見る', label: '前の画像', keys: ['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'] },
  { id: 'first', group: '見る', label: '最初の画像', keys: ['Home'] },
  { id: 'last', group: '見る', label: '最後の画像', keys: ['End'] },
  { id: 'zoomIn', group: '見る', label: '拡大', keys: ['+', ';', '='] },
  { id: 'zoomOut', group: '見る', label: '縮小', keys: ['-'] },
  { id: 'fit', group: '見る', label: '全体を表示 (窓に合わせる)', keys: ['0', 'F', 'Ctrl+0'] },
  { id: 'actual', group: '見る', label: '等倍 (100%)', keys: ['1'] },
  { id: 'full', group: '見る', label: '全画面 (切り抜き中は「決定」)', keys: ['Enter', 'F11'] },
  { id: 'original', group: '見る', label: '押している間、元の絵を見る', keys: ['\\', '`'] },
  { id: 'info', group: '見る', label: '画像の情報を重ねて出す・消す', keys: ['I'] },
  { id: 'help', group: '見る', label: '操作の一覧', keys: ['F1', '?'] },
  // ---- 開く・消す ----
  { id: 'open', group: '開く・消す', label: '開く', keys: ['Ctrl+O'] },
  { id: 'copy', group: '開く・消す', label: '画像をコピー', keys: ['Ctrl+C'] },
  { id: 'rename', group: '開く・消す', label: '名前を変える', keys: ['F2'] },
  { id: 'remove', group: '開く・消す', label: 'ごみ箱へ送る', keys: ['Delete'] },
  { id: 'reveal', group: '開く・消す', label: 'エクスプローラーで場所を開く', keys: ['Ctrl+Shift+E'] },
  { id: 'quit', group: '開く・消す', label: 'アプリを閉じる', keys: ['Ctrl+W'] },
  { id: 'reload', group: '開く・消す', label: '読み直す', keys: ['F5', 'Ctrl+R'] },
  // ---- 直す ----
  { id: 'panel', group: '直す', label: '編集パネルを出す・しまう', keys: ['E'] },
  { id: 'rotR', group: '直す', label: '右へ 90 度', keys: ['R'] },
  { id: 'rotL', group: '直す', label: '左へ 90 度', keys: ['Shift+R'] },
  { id: 'flipH', group: '直す', label: '左右反転', keys: ['H'] },
  { id: 'flipV', group: '直す', label: '上下反転', keys: ['V'] },
  { id: 'crop', group: '直す', label: '切り抜き (Enter で決定、Esc でやめる)', keys: ['C'] },
  { id: 'mosaic', group: '直す', label: 'モザイク', keys: ['M'] },
  { id: 'blur', group: '直す', label: 'ぼかし', keys: ['B'] },
  { id: 'fill', group: '直す', label: '塗りつぶし', keys: ['N'] },
  { id: 'frame', group: '直す', label: '枠で囲む', keys: ['K'] },
  { id: 'arrow', group: '直す', label: '矢印', keys: ['A'] },
  { id: 'undo', group: '直す', label: '取り消す', keys: ['Ctrl+Z'] },
  { id: 'redo', group: '直す', label: 'やり直す', keys: ['Ctrl+Shift+Z', 'Ctrl+Y'] },
  // ---- 出す ----
  { id: 'save', group: '出す', label: '上書き保存', keys: ['Ctrl+S'] },
  { id: 'saveAs', group: '出す', label: '名前を付けて保存', keys: ['Ctrl+Shift+S'] },
  // ワンキー書き出し。1 〜 9 番目のプリセット (中身は設定で変える)
  ...Array.from({ length: 9 }, (_, i) => ({
    id: 'export' + (i + 1), group: '出す', label: `ワンキー書き出し ${i + 1} 番`,
    keys: i === 0 ? ['Ctrl+1', 'Ctrl+E'] : ['Ctrl+' + (i + 1)],
  })),
];

export const GROUPS = ['見る', '開く・消す', '直す', '出す'];
export const actionById = (id) => ACTION_TABLE.find((a) => a.id === id);

// ---- イベント → キーの文字列 ----

const MOD_ONLY = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'OS']);

// 修飾キーだけのときは null。
// base: 修飾キーを除いた、キーそのものの名前。
export function baseKey(e) {
  if (MOD_ONLY.has(e.key)) return null;
  const c = e.code || '';
  if (/^Key[A-Z]$/.test(c)) return c.slice(3);     // KeyR → R
  if (/^Digit[0-9]$/.test(c)) return c.slice(5);   // Digit1 → 1
  if (e.key === ' ') return 'Space';
  return e.key;                                    // 記号は出る文字、特殊キーは名前 (ArrowRight, F5 …)
}

export function specOf(e) {
  const b = baseKey(e);
  if (b === null) return null;
  const mods = [];
  if (e.ctrlKey || e.metaKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  // 記号は Shift が文字に含まれる (Shift + ; → +)。付けると、配列によって別のキーになってしまう。
  const printable = b.length === 1 && !/[A-Za-z0-9]/.test(b);
  if (e.shiftKey && !printable) mods.push('Shift');
  return [...mods, b].join('+');
}

// 'Ctrl+Shift+S' → 'Ctrl + Shift + S'。矢印は記号で。
const NAMES = { ArrowRight: '→', ArrowLeft: '←', ArrowUp: '↑', ArrowDown: '↓', Space: 'Space', ' ': 'Space' };
export function labelOf(spec) {
  // '+' そのものがキーのこともあるので、split ではなく、前から修飾キーを剥がす
  const out = [];
  let rest = spec;
  for (const m of ['Ctrl+', 'Alt+', 'Shift+']) if (rest.startsWith(m) && rest.length > m.length) { out.push(m.slice(0, -1)); rest = rest.slice(m.length); }
  out.push(NAMES[rest] || rest);
  return out.join(' + ');
}

// ---- いまの割り当て ----

// 変えたところだけを settings.keys に覚える ({ 処理の名前: [キー, …] })。
// 最初の割り当てを後で見直しても、変えていないところは自然に追いつく。
let map = new Map(); // キーの文字列 → 処理の名前

export function bindingsOf(id) {
  const saved = settings.keys && settings.keys[id];
  return Array.isArray(saved) ? saved : actionById(id).keys;
}

export function isCustom(id) { return !!(settings.keys && Array.isArray(settings.keys[id])); }

function rebuild() {
  map = new Map();
  for (const a of ACTION_TABLE) for (const k of bindingsOf(a.id)) if (!map.has(k)) map.set(k, a.id);
}
rebuild();

export const actionFor = (spec) => map.get(spec) || null;

// 一番目のキーの表示 (吹き出し用)。割り当てが無ければ ''。
export function firstLabel(id) {
  const b = bindingsOf(id);
  return b.length ? labelOf(b[0]) : '';
}

function store(id, list) {
  if (!settings.keys) settings.keys = {};
  const def = actionById(id).keys;
  // 最初の状態と同じなら、覚えない
  if (list.length === def.length && list.every((k, i) => k === def[i])) delete settings.keys[id];
  else settings.keys[id] = list;
}

// id にキーを足す。すでに別の処理が使っていれば、そこから外す。外した先の処理の名前を返す (なければ null)。
export function addBinding(id, spec) {
  let taken = null;
  const owner = map.get(spec);
  if (owner && owner !== id) {
    store(owner, bindingsOf(owner).filter((k) => k !== spec));
    taken = owner;
  }
  const cur = bindingsOf(id);
  if (!cur.includes(spec)) store(id, [...cur, spec]);
  saveSettings();
  rebuild();
  return taken;
}

export function removeBinding(id, spec) {
  store(id, bindingsOf(id).filter((k) => k !== spec));
  saveSettings();
  rebuild();
}

export function resetBindings(id) {
  if (id) { if (settings.keys) delete settings.keys[id]; } else settings.keys = {};
  saveSettings();
  rebuild();
}
