// ui.js — お知らせ、確認、操作の一覧、プリセットの編集 (画面の上に重ねて出すもの)

import { FORMATS } from './export.js';
import { defaultPresets } from './settings.js';
import { ACTION_TABLE, GROUPS, bindingsOf, labelOf, isCustom, specOf, addBinding, removeBinding, resetBindings, actionById } from './keys.js';

const $ = (id) => document.getElementById(id);

// ---- お知らせ (右下に出て、数秒で消える) ----

export function toast(text, opt = {}) {
  const el = document.createElement('div');
  el.className = 'toast' + (opt.err ? ' err' : '');
  el.textContent = text;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), opt.ms || (opt.err ? 6000 : 3000));
  return el;
}

// ---- 重ねて出す枠 ----

let closer = null; // 開いている枠を閉じる関数。開いていなければ null。

export const modalOpen = () => closer !== null;

// 枠を開く。build(box, close) の中で中身を作る。close(値) で閉じて、その値が返る。
function openModal(build) {
  return new Promise((resolve) => {
    const box = $('modal-box');
    box.textContent = '';
    const close = (value) => {
      $('modal').hidden = true;
      window.removeEventListener('keydown', onKey, true);
      closer = null;
      resolve(value);
    };
    // 枠が開いている間は、キーを枠だけで受ける (裏の画像が送られたりしないように)
    const onKey = (e) => {
      // キーを押して登録している間は、押されたキーを全部その処理へ渡す (Esc も含めて)
      if (box.capture) { e.preventDefault(); e.stopPropagation(); box.capture(e); return; }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null); return; }
      if (box.onEnter && e.key === 'Enter' && !e.target.matches('textarea, button')) {
        e.preventDefault(); e.stopPropagation(); box.onEnter();
        return;
      }
      e.stopPropagation();
    };
    box.onEnter = null;
    box.onShow = null;
    box.capture = null;
    window.addEventListener('keydown', onKey, true);
    closer = close;
    build(box, close);
    $('modal').hidden = false;
    // 枠が見えてからでないと、フォーカスを当てられない
    if (box.onShow) box.onShow();
  });
}

export function closeModal() { if (closer) closer(null); }

const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  for (const k of kids) e.append(k);
  return e;
};

// 確認。OK なら true。Enter で OK、Esc でやめる。
export async function confirmBox({ title, text, ok = 'OK', cancel = 'やめる' }) {
  const r = await openModal((box, close) => {
    const yes = el('button', { textContent: ok, className: 'primary', onclick: () => close(true) });
    box.append(
      el('h2', { textContent: title }),
      el('p', { textContent: text }),
      el('div', { className: 'row' }, el('button', { textContent: cancel, onclick: () => close(false) }), yes),
    );
    box.onEnter = () => close(true);
    box.onShow = () => yes.focus();
  });
  return r === true;
}

// 1 行の文字を入れてもらう。決定したらその文字、やめたら null。
// select = [始まり, 終わり] を渡すと、その範囲を選んだ状態で出す (拡張子の前だけ選ぶ、など)。
export function promptBox({ title, text = '', value = '', ok = '決定', cancel = 'やめる', select = null }) {
  return openModal((box, close) => {
    const input = el('input', { type: 'text', value, style: 'width: 100%; margin-bottom: 12px;' });
    box.append(
      el('h2', { textContent: title }),
      ...(text ? [el('p', { textContent: text })] : []),
      input,
      el('div', { className: 'row' },
        el('button', { textContent: cancel, onclick: () => close(null) }),
        el('button', { textContent: ok, className: 'primary', onclick: () => close(input.value) })),
    );
    box.onEnter = () => close(input.value);
    box.onShow = () => { input.focus(); if (select) input.setSelectionRange(select[0], select[1]); else input.select(); };
  });
}

// ---- 操作の一覧 ----

// 割り当てを変えられない操作 (マウスや、固定のキー)
const HELP_FIXED = {
  '見る': [
    ['ホイール', '前の画像・次の画像 (設定で拡大・縮小にもできる)'],
    ['Ctrl + ホイール', '拡大・縮小'],
    ['ダブルクリック', '全体 ⇔ 等倍'],
    ['ドラッグ', '拡大中に、ずらす'],
    ['下の % をクリック', '全体 ⇔ 等倍'],
  ],
  '開く・消す': [['Ctrl + V', 'クリップボードの画像を開く']],
  '直す': [
    ['Esc', 'やめる・閉じる'],
    ['スライダーをダブルクリック', 'その項目を 0 に戻す'],
    ['切り抜き中の ← → ↑ ↓', '1 画素ずつ動かす (Shift で 10 画素)'],
  ],
  '出す': [],
};

// キーの札を並べる
function chips(id) {
  const list = bindingsOf(id);
  if (!list.length) return [el('span', { className: 'key-none', textContent: '(なし)' })];
  return list.flatMap((k, i) => [...(i ? [' '] : []), el('kbd', { textContent: labelOf(k) })]);
}

// 操作の一覧。表から作るので、キーを変えると、ここも変わる。
export function showHelp() {
  return openModal((box, close) => {
    box.append(el('h2', { textContent: '操作の一覧' }));
    const cols = el('div', { className: 'help-cols' });
    for (const g of GROUPS) {
      const sec = el('div', {}, el('h3', { textContent: g }));
      const table = el('table');
      for (const a of ACTION_TABLE.filter((x) => x.group === g)) {
        // ワンキー書き出しは 9 行も並べず、1 行にまとめる (中身は設定したプリセット)
        if (/^export[2-9]$/.test(a.id)) continue;
        if (a.id === 'export1') {
          table.append(el('tr', {}, el('td', {}, ...chips('export1')), el('td', { textContent: 'ワンキー書き出し (1 番。2〜9 番も同じ並びのキー)' })));
          continue;
        }
        table.append(el('tr', {}, el('td', {}, ...chips(a.id)), el('td', { textContent: a.label })));
      }
      for (const [key, what] of HELP_FIXED[g] || []) {
        table.append(el('tr', {}, el('td', {}, el('kbd', { textContent: key })), el('td', { textContent: what })));
      }
      sec.append(table);
      cols.append(sec);
    }
    box.append(cols, el('div', { className: 'row' },
      el('button', { textContent: 'キーを変える', onclick: () => { close(null); editKeys(); } }),
      el('button', { textContent: '閉じる', className: 'primary', onclick: () => close(null) })));
    box.onEnter = () => close(null);
  });
}

// ---- キーの設定 ----

// 返り値: 変えたかどうか (呼ぶ側が、吹き出しなどを作り直すのに使う)
// 変えたあとに呼ぶ関数 (吹き出しなどを作り直す。main.js が登録する)
let onKeysChanged = () => {};
export const setKeysHook = (fn) => { onKeysChanged = fn; };

export async function editKeys() {
  let changed = false;
  const r = await openModal((box, close) => {
    const body = el('div', { className: 'keys-body' });
    const note = el('p', { className: 'key-note', textContent: '「＋」を押してから、割り当てたいキーを押す。Esc で取りやめ。他の操作が使っているキーを選ぶと、そちらから外れる。' });

    const draw = () => {
      body.textContent = '';
      for (const g of GROUPS) {
        body.append(el('h3', { textContent: g }));
        for (const a of ACTION_TABLE.filter((x) => x.group === g)) {
          const row = el('div', { className: 'key-row' + (isCustom(a.id) ? ' custom' : '') });
          row.append(el('span', { className: 'key-label', textContent: a.label }));
          const cell = el('span', { className: 'key-cell' });
          for (const k of bindingsOf(a.id)) {
            cell.append(el('span', { className: 'key-chip' },
              el('kbd', { textContent: labelOf(k) }),
              el('button', { className: 'key-x', title: 'この割り当てを外す', textContent: '×', onclick: () => { removeBinding(a.id, k); changed = true; draw(); } })));
          }
          const add = el('button', { className: 'key-add', title: 'キーを足す', textContent: '＋' });
          add.onclick = () => {
            add.textContent = 'キーを押す…';
            add.classList.add('waiting');
            box.capture = (e) => {
              const spec = specOf(e);
              if (spec === null) return; // Ctrl だけ、などは待ち続ける
              if (spec === 'Escape') { box.capture = null; draw(); return; }
              box.capture = null;
              const from = addBinding(a.id, spec);
              changed = true;
              draw();
              if (from) note.textContent = `「${labelOf(spec)}」は「${actionById(from).label}」から外して、「${a.label}」にした。`;
            };
          };
          cell.append(add);
          row.append(cell);
          body.append(row);
        }
      }
    };
    draw();

    box.append(
      el('h2', { textContent: 'キーの設定' }), note, body,
      el('div', { className: 'row' },
        el('button', { textContent: '最初の状態に戻す', onclick: () => { resetBindings(); changed = true; draw(); } }),
        el('button', { textContent: '閉じる', className: 'primary', onclick: () => close(changed) })),
    );
    box.onEnter = null;
  });
  onKeysChanged();
  return r;
}

// ---- ワンキー書き出しの設定 ----

// いまの一覧を渡すと、編集後の一覧が返る。やめたら null。
export function editPresets(presets) {
  return openModal((box, close) => {
    const list = structuredClone(presets);
    const rows = el('div');

    const draw = () => {
      rows.textContent = '';
      rows.append(el('div', { className: 'preset-row preset-head' },
        el('span', { textContent: '名前' }), el('span', { textContent: '長い辺 (0 = 原寸)' }), el('span', { textContent: '形式' }),
        el('span', { textContent: '品質' }), el('span', { textContent: '末尾' }), el('span', { textContent: '同名' }), el('span')));
      list.forEach((p, i) => {
        const inp = (key, type, extra = {}) => el('input', {
          type, value: p[key], ...extra,
          oninput: (e) => { p[key] = type === 'number' ? Number(e.target.value) : e.target.value; },
        });
        const fmt = el('select', { onchange: (e) => { p.format = e.target.value; } });
        for (const [k, f] of Object.entries(FORMATS)) fmt.append(el('option', { value: k, textContent: f.label, selected: p.format === k }));
        const ow = el('select', { onchange: (e) => { p.overwrite = e.target.value === '1'; } },
          el('option', { value: '0', textContent: '番号を付ける', selected: !p.overwrite }),
          el('option', { value: '1', textContent: '置き換える', selected: !!p.overwrite }));
        rows.append(el('div', { className: 'preset-row' },
          inp('label', 'text'), inp('long', 'number', { min: 0 }), fmt, inp('quality', 'number', { min: 10, max: 100 }),
          inp('suffix', 'text'), ow,
          el('button', { textContent: '消す', onclick: () => { list.splice(i, 1); draw(); } })));
      });
    };
    draw();

    box.append(
      el('h2', { textContent: 'ワンキー書き出しの設定' }),
      el('p', { textContent: '上から順に Ctrl + 1, 2, 3 … で書き出す。書き出し先は、元の画像と同じフォルダ。' }),
      rows,
      el('div', { className: 'row' },
        el('button', { textContent: '追加', onclick: () => { list.push({ label: '新しいプリセット', long: 1920, format: 'webp', quality: 85, suffix: '_out', overwrite: false, dir: '' }); draw(); } }),
        el('button', { textContent: '最初の状態に戻す', onclick: () => { list.length = 0; list.push(...defaultPresets()); draw(); } }),
        el('button', { textContent: 'やめる', onclick: () => close(null) }),
        el('button', { textContent: '決定', className: 'primary', onclick: () => close(clean(list)) })),
    );
  });
}

// 入力された値を、使える形に整える
function clean(list) {
  return list.map((p) => ({
    label: String(p.label || '').trim() || '名前なし',
    long: Math.max(0, Math.round(Number(p.long) || 0)),
    format: FORMATS[p.format] ? p.format : 'webp',
    quality: Math.max(10, Math.min(100, Math.round(Number(p.quality) || 85))),
    // ファイル名に使えない文字は取り除く
    suffix: String(p.suffix || '').replace(/[\\/:*?"<>|]/g, ''),
    overwrite: !!p.overwrite,
    dir: p.dir || '',
  }));
}
