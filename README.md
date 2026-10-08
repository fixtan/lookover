# Lookover

**English** | [日本語](README.ja.md)

![Lookover](docs/screenshot.png)

A small Windows image viewer that can also fix the picture you are looking at.
Most of the time it just shows images. When you need to rotate, crop, resize, tweak the colors, hide something with a mosaic or point at it with an arrow, you do it right there and export with one key. No round trip through another editor.

I built it for myself as a replacement for Honeyview, because I was tired of opening a separate app every time I had to prepare a picture for a blog post. It is a Tauri v2 app with plain JavaScript (no bundler, no UI framework).

## Features

**View**
- Folder browsing in natural order (`img2` before `img10`), with the neighbors preloaded
- Zoom, fit to window, 100% (one image pixel = one screen pixel, even at 150% display scaling), full screen
- Animated GIF / WebP
- Hold <kbd>\\</kbd> to peek at the original while editing

**Edit** (non-destructive: the file is untouched until you export)
- Rotate, flip, crop (free or fixed ratio), resize
- Brightness, contrast, saturation, temperature, tint, highlights, shadows, sharpen (WebGL)
- Mosaic, blur, fill
- Frame and arrow: line width, color, opacity, shadow; dashed and rounded frames, tapered arrows. Each tool remembers its last settings, and keys <kbd>1</kbd>–<kbd>5</kbd> recall saved presets (<kbd>Shift</kbd>+digit saves). Burned into the image on export
- Undo / redo, and edits are remembered per file while the app is open

**Export**
- WebP / JPEG / PNG
- **One-key export presets**: e.g. <kbd>Ctrl</kbd>+<kbd>1</kbd> writes a 1920 px WebP next to the original. Presets are editable
- Never overwrites the original through a preset (adds `-2`, `-3`… on name clashes)
- Copy to clipboard, paste an image from the clipboard

**Also**
- Close the app with <kbd>Ctrl</kbd>+<kbd>W</kbd> (rebindable)
- Rename (<kbd>F2</kbd>), move to Recycle Bin (<kbd>Delete</kbd>, confirmation can be turned off), reveal in Explorer
- Drag and drop to open. Opening a second image reuses the running window
- **Image info overlay** (<kbd>I</kbd>): size, format, file size, shooting date, camera, exposure, modified date at the top left. It stays on across images and restarts. GPS coordinates stay hidden ("あり" only) unless you turn them on in settings
- **Every shortcut can be rebound** (<kbd>F1</kbd> → "キー・マウスを変える"), and so can the mouse: the wheel (up / down / tilt), the middle / right button and the Back / Forward side buttons. By default the wheel zooms. <kbd>F1</kbd> also shows the full list

Supported files: PNG, JPEG, WebP, GIF, BMP, AVIF, ICO, SVG.

## Install

1. Download the installer (`.exe`) from [Releases](../../releases) and run it.
2. The installer is **not code-signed**, so Windows SmartScreen will say "unknown publisher" once. Click "More info" → "Run anyway".
3. To open images by double-click, set Lookover as the default app (Windows Settings → Default apps).

Requires WebView2 (preinstalled on Windows 11).

**macOS / Linux**: `.dmg` / `.deb` / `.AppImage` files are built too. They are unsigned: on macOS, right-click → Open the first time (if it will not open: System Settings → Privacy & Security → "Open Anyway"; if it says the app is damaged, run `xattr -cr /Applications/Lookover.app`). On Linux, `chmod +x` the AppImage and run it. These WebViews cannot encode WebP, so WebP presets fall back to JPEG automatically (a toast tells you).

## Limitations

- No HEIC / JXL / RAW. There is a hook for it (`registerDecoder` in `src/decode.js`), nothing plugged in yet
- Exporting drops EXIF and the ICC profile (orientation is baked into the pixels)
- Unsaved edits are lost when the app closes, without a prompt
- No text tool, no free-angle rotation, no batch export, no thumbnail grid, no archive (zip/rar) browsing
- Checked on Windows 11, macOS (Intel) and Linux (AppImage). Apple Silicon Macs are not verified on real hardware. The UI strings are Japanese

## Build from source

Needs Node.js and Rust (plus WebView2 on Windows).

```
npm install
npm run tauri dev        # run (the first Rust build takes a few minutes)
npx tauri build --bundles nsis   # make the installer (Windows)
```

Open an image at startup: `npx tauri dev -- C:\path\a.png`

### Tests

```
python3 test/make_images.py        # sample images (needs Pillow)
node test/serve.mjs                # dev server; the UI also runs in a browser at http://localhost:8770/?open=<path>
npm i --no-save playwright
node test/ui.mjs                   # UI tests (Chromium)
sh test/app.sh && python3 test/app-report.py   # starts the real app headless on Linux and checks the Rust side
```

How it is put together: [DESIGN.md](DESIGN.md) (Japanese).

## License

[MIT](LICENSE)
