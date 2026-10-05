// lib.rs — 画面 (JavaScript) から頼まれる「ファイルまわりの仕事」をする側
//
// 画面側はブラウザと同じ仕組みで動いているので、勝手にディスクを読み書きできない。
// そこで、ここに書いた関数 (コマンド) を画面側から名前で呼んでもらう。
//   画面: invoke('list_dir', { dir: 'C:\\photos' })
//   ここ: fn list_dir(dir: String) -> ...
// 画像の中身を解釈する処理は置かない。読む・書く・一覧する・窓を操作する、だけ。

use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

/// フォルダの中の 1 件。画面側へ JSON で渡す。
#[derive(Serialize)]
struct Entry {
    name: String,  // ファイル名
    path: String,  // フルパス
    size: u64,     // バイト数
    mtime: f64,    // 更新日時 (1970 年からのミリ秒。JavaScript の Date と同じ単位)
    ctime: f64,    // 作成日時 (同じ単位。取れない環境では 0)
    is_dir: bool,  // フォルダかどうか
}

fn entry_of(path: &Path) -> Result<Entry, String> {
    let meta = fs::metadata(path).map_err(|e| format!("{}: {}", path.display(), e))?;
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as f64)
        .unwrap_or(0.0);
    let ctime = meta
        .created()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as f64)
        .unwrap_or(0.0);
    Ok(Entry {
        name: path
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default(),
        path: path.to_string_lossy().into_owned(),
        size: meta.len(),
        mtime,
        ctime,
        is_dir: meta.is_dir(),
    })
}

/// フォルダの中身を一覧する。並べ替えと、画像かどうかの判定は画面側でやる。
/// (async を付けたコマンドは、窓を動かしているスレッドとは別の所で走る。
///  件数の多いフォルダや大きいファイルを読んでいる間も、窓が固まらない)
#[tauri::command]
async fn list_dir(dir: String) -> Result<Vec<Entry>, String> {
    let mut out = Vec::new();
    for item in fs::read_dir(&dir).map_err(|e| format!("{}: {}", dir, e))? {
        // 読めない項目 (権限がないなど) は飛ばす。1 件のせいで全体を失敗にしない。
        let Ok(item) = item else { continue };
        if let Ok(e) = entry_of(&item.path()) {
            out.push(e);
        }
    }
    Ok(out)
}

/// 1 件の情報。フォルダかファイルかを画面側が知るために使う。
#[tauri::command]
fn file_info(path: String) -> Result<Entry, String> {
    entry_of(Path::new(&path))
}

/// ファイルを丸ごと読んで、バイト列のまま画面側へ返す。
/// (JSON の数値の配列にすると何倍にも膨らむので、生のバイト列で返す)
#[tauri::command]
async fn read_file(path: String) -> Result<tauri::ipc::Response, String> {
    fs::read(&path)
        .map(tauri::ipc::Response::new)
        .map_err(|e| format!("{}: {}", path, e))
}

/// 画面側から受け取ったバイト列を、ファイルに書く。
/// 本体 (body) がファイルの中身、ヘッダー x-path が書き込み先。
/// ヘッダーには英数字しか入れられないので、パスは %E3%81%82 のような形で届く。
#[tauri::command]
fn write_file(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(data) = request.body() else {
        return Err("中身がバイト列で届いていない".into());
    };
    let raw = request
        .headers()
        .get("x-path")
        .and_then(|v| v.to_str().ok())
        .ok_or("書き込み先 (x-path) がない")?;
    let path = PathBuf::from(percent_decode(raw));

    // いきなり本番の名前で書くと、途中で失敗したときに壊れたファイルが残る。
    // 隣に仮の名前で書いてから、名前を付け替える。
    let tmp = path.with_extension("tmp-write");
    fs::write(&tmp, data).map_err(|e| format!("{}: {}", tmp.display(), e))?;
    fs::rename(&tmp, &path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("{}: {}", path.display(), e)
    })
}

/// %E3%81%82 のような表記を、元の文字に戻す。
fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            let hex = |c: u8| (c as char).to_digit(16);
            if let (Some(h), Some(l)) = (hex(b[i + 1]), hex(b[i + 2])) {
                out.push((h * 16 + l) as u8);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[tauri::command]
fn path_exists(path: String) -> bool {
    Path::new(&path).exists()
}

/// ごみ箱へ送る。完全に消すのではないので、エクスプローラーから戻せる。
/// 名前を変える。同じ名前のファイルがすでにあれば、上書きせずに失敗させる。
#[tauri::command]
fn rename_file(from: String, to: String) -> Result<(), String> {
    // 大文字・小文字だけを変える場合 (a.png → A.png) は、Windows では「すでにある」に見えるので、通す
    let same = from.to_lowercase() == to.to_lowercase();
    if !same && Path::new(&to).exists() {
        return Err(format!("{}: 同じ名前のファイルがすでにある", to));
    }
    fs::rename(&from, &to).map_err(|e| format!("{}: {}", from, e))
}

/// ごみ箱の操作は Windows の仕組み (COM) を使う。窓のスレッドを巻き込まないよう、別のスレッドでやる。
#[tauri::command]
async fn trash_file(path: String) -> Result<(), String> {
    let p = path.clone();
    tauri::async_runtime::spawn_blocking(move || trash::delete(&p))
        .await
        .map_err(|e| format!("{}: {}", path, e))?
        .map_err(|e| format!("{}: {}", path, e))
}

/// エクスプローラーで、そのファイルを選んだ状態で開く。
#[tauri::command]
fn reveal(path: String) -> Result<(), String> {
    tauri_plugin_opener::reveal_item_in_dir(&path).map_err(|e| e.to_string())
}

/// 起動したときに渡されたファイル。
/// 画像をダブルクリックして開くと、Windows はそのパスを引数として渡してくる。
#[tauri::command]
fn startup_paths() -> Vec<String> {
    paths_in(std::env::args().skip(1))
}

/// 起動時の引数を、そのまま返す。
/// 自動試験の合図 (--selftest=...) を画面側が見るために使う。ふだんは使わない。
#[tauri::command]
fn startup_args() -> Vec<String> {
    std::env::args().skip(1).collect()
}

/// 引数の中から、実在するファイルやフォルダだけを拾う (-- で始まるオプションなどを除く)。
fn paths_in(args: impl Iterator<Item = String>) -> Vec<String> {
    args.filter(|a| !a.starts_with('-') && Path::new(a).exists())
        .collect()
}

// ---- 窓の操作 ----

#[tauri::command]
fn set_title(window: tauri::WebviewWindow, title: String) {
    let _ = window.set_title(&title);
}

/// 窓を閉じる。(JavaScript の窓 API を使うと権限の設定が増えるので、ここで閉じる)
#[tauri::command]
fn close_window(window: tauri::WebviewWindow) {
    let _ = window.close();
}

#[tauri::command]
fn set_fullscreen(window: tauri::WebviewWindow, on: bool) {
    let _ = window.set_fullscreen(on);
}

#[tauri::command]
fn is_fullscreen(window: tauri::WebviewWindow) -> bool {
    window.is_fullscreen().unwrap_or(false)
}

// ---- ファイルを選ぶダイアログ ----

const IMAGE_EXTS: &[&str] = &[
    "png", "jpg", "jpeg", "jfif", "webp", "gif", "bmp", "avif", "ico", "svg",
];

/// 「開く」ダイアログ。選ばなかったら None。
#[tauri::command]
async fn pick_open(app: tauri::AppHandle) -> Option<String> {
    app.dialog()
        .file()
        .add_filter("画像", IMAGE_EXTS)
        .blocking_pick_file()
        .and_then(|p| p.into_path().ok())
        .map(|p| p.to_string_lossy().into_owned())
}

/// 「名前を付けて保存」ダイアログ。default_path は最初に入れておく保存先。
#[tauri::command]
async fn pick_save(app: tauri::AppHandle, default_path: String) -> Option<String> {
    let p = PathBuf::from(&default_path);
    let mut d = app.dialog().file();
    if let Some(dir) = p.parent() {
        d = d.set_directory(dir);
    }
    if let Some(name) = p.file_name() {
        d = d.set_file_name(name.to_string_lossy());
    }
    if let Some(ext) = p.extension().and_then(|e| e.to_str()) {
        d = d.add_filter(ext.to_uppercase(), &[ext]);
    }
    d.blocking_save_file()
        .and_then(|p| p.into_path().ok())
        .map(|p| p.to_string_lossy().into_owned())
}

/// 窓を手前に出す。裏に隠れたまま開くと、開いたことに気づけない。
fn bring_to_front(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 2 つ目を起動しようとしたら、起動せずに 1 つ目へファイルを渡す。
        // (画像をダブルクリックするたびに窓が増えるのを防ぐ。これは最初に登録する決まり)
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            let paths = paths_in(argv.into_iter().skip(1));
            if !paths.is_empty() {
                let _ = app.emit("open-paths", paths);
            }
            bring_to_front(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            bring_to_front(app.handle());
            Ok(())
        })
        // 窓にファイルを落とされたら、そのパスを画面側へ知らせる
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                let list: Vec<String> = paths
                    .iter()
                    .map(|p| p.to_string_lossy().into_owned())
                    .collect();
                let _ = window.emit("open-paths", list);
            }
        })
        .invoke_handler(tauri::generate_handler![
            list_dir,
            file_info,
            read_file,
            write_file,
            path_exists,
            trash_file,
            rename_file,
            reveal,
            startup_paths,
            startup_args,
            set_title,
            close_window,
            set_fullscreen,
            is_fullscreen,
            pick_open,
            pick_save
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percent_decode_japanese_and_plain() {
        assert_eq!(percent_decode("C%3A%5Ca%20b%5C%E3%81%82.webp"), "C:\\a b\\あ.webp");
        assert_eq!(percent_decode("plain.txt"), "plain.txt");
        assert_eq!(percent_decode("100%"), "100%");
        assert_eq!(percent_decode("a%2"), "a%2");
        assert_eq!(percent_decode("%zz"), "%zz");
    }

    #[test]
    fn paths_in_keeps_existing_only() {
        let here = std::env::current_dir().unwrap().to_string_lossy().into_owned();
        let got = paths_in(vec!["--flag".to_string(), here.clone(), "no-such-file-xyz".to_string()].into_iter());
        assert_eq!(got, vec![here]);
    }
}
