<div align="center">

# TypeBox

**A fast, private, offline-first toolkit for text, images, media & code — entirely in your browser.**

Write Markdown, edit images, transcode audio & video, transcribe speech, run Python, and process text — with no login, no upload, and nothing leaving your device unless you explicitly opt in.

[**Live**](https://box.muran.tech) · [Report a bug](https://github.com/jiangmuran/jmr-typebox/issues) · [English](#typebox) · [中文](#中文)

![License](https://img.shields.io/badge/license-MIT-1c1c1e)
![Vue 3](https://img.shields.io/badge/Vue-3-1c1c1e)
![Vite](https://img.shields.io/badge/Vite-6-1c1c1e)
![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-1c1c1e)
![PWA](https://img.shields.io/badge/PWA-installable-1c1c1e)
![Offline first](https://img.shields.io/badge/offline-first-1c1c1e)

</div>

---

## Overview

TypeBox is a single, deliberately minimal page that hides a deep toolbox. Everything heavy is **lazy-loaded**, so the first screen opens instantly; press **⌘K / Ctrl+K** to jump to any tool, action, theme, or setting.

The defining principle is **local-first privacy**: image, audio/video, text, crypto, and document processing all run in your browser (Canvas, Web Crypto, `ffmpeg.wasm`, Pyodide, SheetJS, …). A small, fully optional, open-source backend exists only for the handful of things a browser cannot do cross-origin (CORS proxy, AI/ASR relays, image hosting) — every surface that uses it is clearly marked and can be disabled in Settings.

Every tool has its own URL and is **prerendered to static HTML for SEO** (e.g. `/`, `/image/metadata`, `/media/transcribe`, `/tools/totp`, `/python`).

## Highlights

- **Private & offline.** Your files never leave the device by default; the app keeps working offline after the first load.
- **No install.** Open a URL. Nothing to download, no account.
- **Broad & deep.** A real Markdown editor, image suite, audio/video workbench, Python IDE, Office viewer, and a developer toolbox — in one place.
- **One Cloudflare Worker.** The prerendered site and the optional `/api/*` routes ship as a single deployment.
- **Bilingual (EN / 中文)**, light/dark themes, dark-gold accent, fully responsive (mobile → desktop).
- **Installable PWA** with markdown file association and "save back to the original file".

## Features

### Markdown editor

- Multi-document tabs with autosave, live preview, split view, and Zen mode.
- **19 vendored Typora-style themes**; the writing theme and the export theme are independent, with hover preview (export defaults to *follow the writing theme*).
- **LaTeX** (KaTeX) and **Mermaid** diagrams render in the preview *and* exports.
- **Export** to PDF (vector, selectable text), DOCX, HTML, PNG (themed, with copy-as-image), TXT, and Markdown; copy as HTML/Markdown/image.
- **AI assistant** (any OpenAI-compatible endpoint): right-click selection actions (improve, polish, fix grammar, shorten, lengthen, translate, rewrite, explain), whole-document actions (polish, summarize, outline, title, generate), Copilot-style ghost-text completion, and ⌃Space "continue writing" — all undoable with Ctrl+Z.
- **Image host (图床):** paste or drop an image to upload it (with a progress bar) and insert `![](url)`.
- **Cross-module flow:** "Send to →" moves a result between tools (image → editor, transcript → subtitles/editor, …).

### Images

Compress · Convert (PNG / JPG / WebP / AVIF / GIF) · Watermark (text or image, 9-grid or tiled) · Edit (draw, add text, redact with mosaic/blur, undo/redo) · **Metadata** (view & edit EXIF / GPS / IPTC / XMP, one-click "remove all" / "remove GPS"). Every result can be downloaded or copied to the clipboard. All on-canvas, nothing uploaded.

### Audio & Video

Powered by `ffmpeg.wasm`, fully in the browser:

- **Convert** audio and video (MP3/WAV/FLAC/OGG/Opus/AAC/M4A and MP4/WebM/MOV/MKV/GIF), or extract audio from video.
- **Compress** — video (resolution, CRF, codec, fps) and audio (bitrate) with a live target-size estimate.
- **Edit** — trim, fade, normalize loudness (EBU R128).
- **Subtitles** — burn-in (hardsub) or mux a soft track from SRT/ASS/VTT.
- **Transcribe** — online ASR via any OpenAI `/audio/transcriptions`-compatible model; auto-extracts/downsamples audio, chunks long media, and exports TXT / SRT / VTT.
- **Metadata** — read & edit every tag (no re-encode) and export.
- **Player** — local library with playlists, synced `.lrc` lyrics, ID3 editing, and IndexedDB caching; plus official, playback-only embeds for NetEase / Bilibili / YouTube.

### Python IDE

A real multi-file IDE running Python in a Web Worker via **Pyodide**: streaming output, force-stop, an interactive terminal with **genuinely blocking `input()`** (via cross-origin isolation + `SharedArrayBuffer`), a navigable WSGI/ASGI preview, a package/version manager, persistent runtime caching, and a `requests`/`urllib` proxy for networking.

### Office, Toolbox & Convert

- **Office:** open `.xlsx` (preview + light editing + re-download) and `.pptx` (slide preview).
- **Toolbox:** Base64 / Hex / URL / HTML encode-decode, AES encrypt/decrypt, hashes (SHA family), JSON format, JWT decode, word count, and a live **TOTP** generator (RFC 6238).
- **Convert:** Markdown → PDF / DOCX / HTML and PDF → Markdown / Word.

## Architecture

```
Single Cloudflare Worker
├─ /api/*  → optional backend handlers (rate-limited per IP via a Durable Object)
│     /api/health   liveness
│     /api/fetch    SSRF-guarded CORS proxy (import from URL, Python requests)
│     /api/preview  Open-Graph link preview
│     /api/ai       relay to an OpenAI-compatible chat endpoint
│     /api/asr      relay to an OpenAI-compatible transcription endpoint
│     /api/upload   image-host upload proxy (key kept as a Worker secret)
└─ *       → static SSG frontend (ASSETS binding), SPA fallback
```

- **Frontend:** Vue 3 `<script setup>` + Vite 6 + [vite-ssg](https://github.com/antfu/vite-ssg) (every route prerendered to static HTML) + `@unhead/vue`. Routes/i18n/commands auto-register from a glob feature seam (`src/features/*/index.js`); composables are module-level singletons.
- **Client-side compute:** Canvas, Web Crypto, `ffmpeg.wasm`, Pyodide, SheetJS, `html-to-docx`, `jspdf`, `html2canvas`, `exifr`/`piexifjs`. The large `ffmpeg-core` and Pyodide runtimes are fetched on first use from official CDNs (they exceed Cloudflare's 25 MiB static-asset limit) and cached via the Cache API.
- **Cross-origin isolation:** `public/_headers` sets `COOP: same-origin` + `COEP: credentialless` so `SharedArrayBuffer` is available (blocking Python `input()`); third-party embeds use `credentialless` iframes.
- **Rate limiting:** a SQLite-backed Durable Object provides a strongly-consistent per-IP sliding window on the abuse-prone proxy routes.
- **Design system:** one global UI kit (`src/styles/tool-kit.css`) — a single `.card`, `.btn` (dark primary / gold CTA), `.segbar`, and two page widths — for a consistent look; monochrome + dark-gold accent; inline-SVG icons, no emoji.

## Tech stack

| Layer | Tools |
|---|---|
| UI | Vue 3, Vue Router, vite-ssg, @unhead/vue, CodeMirror |
| Build/Test | Vite 6, Vitest, @vue/test-utils, jsdom, puppeteer-core |
| Edge | Cloudflare Workers, Workers Assets, Durable Objects, Wrangler |
| Docs/Media | marked, DOMPurify, KaTeX, Mermaid, highlight.js, html-to-docx, jspdf, html2canvas, pdfjs-dist, SheetJS (xlsx), jszip |
| Image/EXIF | exifr, piexifjs |
| Audio/Video | @ffmpeg/ffmpeg, @ffmpeg/util, lamejs |
| Python | Pyodide |

## Getting started

> Requires Node.js 18+.

```bash
git clone https://github.com/jiangmuran/jmr-typebox.git
cd jmr-typebox
npm install

npm run dev        # Vite dev server  → http://localhost:5173
npm test           # run the Vitest suite
npm run build      # prerender every route + write sitemap.xml → dist/
npm run preview    # preview the production build
```

### Deploy (frontend + optional backend, one command)

```bash
npm run deploy     # vite-ssg build + wrangler deploy
```

One Worker serves the prerendered site and the `/api/*` routes — see [`wrangler.toml`](wrangler.toml). The optional image-host proxy needs a secret (skip it to disable that route):

```bash
printf '%s' '<your-image-host-api-key>' | npx wrangler secret put IMAGE_HOST_KEY
```

## Configuration

Most configuration lives in **Settings** (stored locally in your browser):

- **Backend toggle** — master switch for everything that uses `/api/*`. Off ⇒ those features cleanly disable themselves.
- **AI assistant** — base URL, API key, model (any OpenAI-compatible provider); direct or via the same-origin proxy.
- **Speech-to-text (ASR)** — model, optional separate base URL/key (reuses the AI provider if left blank).
- **Image host** — use the built-in proxy (key stays a Worker secret) or point at your own host.

Keys you enter for AI / ASR / a custom image host stay in your browser; only the shared image-host key is a server-side Worker secret.

## PWA & file handling

Install TypeBox as an app (Chromium desktop) to:

- Set it as the **open-with** handler for `.md` / `.markdown` / `.txt` files (opening one reuses the existing window).
- **Save edits back to the original file** with Ctrl/Cmd+S (File System Access API); Ctrl/Cmd+Shift+S saves a copy.

## Project structure

```
src/
├─ pages/         route pages (editor, toolbox, …)
├─ features/      drop-in tool suites — image · media · python · office · convert
├─ components/    shared UI (Workspace, SettingsPanel, ThemePicker, …)
├─ composables/   singletons (useEditor, useSettings, useAI, useHandoff, …)
├─ themes/        vendored Typora themes + registry
├─ tools/         pure text/crypto/totp helpers
└─ styles/        global.css + the tool-kit design system
worker/           the optional /api backend (one file per route)
public/_headers   cross-origin isolation headers
```

## Contributing

Issues and PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Adding a tool is usually a drop-in: create a folder under `src/features/<name>/` exporting `{ components, i18n, register }` and it auto-registers its routes, strings, and command-palette entries.

## License

[MIT](LICENSE) © Andy Jiang ([@jiangmuran](https://github.com/jiangmuran))

## Acknowledgements

[Vue](https://vuejs.org) · [vite-ssg](https://github.com/antfu/vite-ssg) · [Cloudflare Workers](https://workers.cloudflare.com) · [Pyodide](https://pyodide.org) · [ffmpeg.wasm](https://ffmpegwasm.netlify.app) · [KaTeX](https://katex.org) · [Mermaid](https://mermaid.js.org) · the [Typora theme gallery](https://theme.typora.io/) (bundled locally; see [CREDITS.md](CREDITS.md)).

---

<a name="中文"></a>

## 中文

**TypeBox** 是一个快速、私密、离线优先的浏览器工具箱:写 Markdown、编辑图片、转码音视频、语音转录、运行 Python、处理文本——无需登录、无需安装,文件默认不上传。页面刻意保持极简,重资源全部**懒加载**,首屏秒开;按 **⌘K / Ctrl+K** 即可搜索任意工具、操作、主题或设置。

核心理念是**本地优先的隐私**:图片、音视频、文本、加解密、文档处理全部在浏览器内完成(Canvas、Web Crypto、`ffmpeg.wasm`、Pyodide、SheetJS……)。一个完全可选、开源的小后端,只用于浏览器跨域做不到的少数能力(CORS 代理、AI/ASR 中转、图床上传),用到的每个入口都有明确标注,并可在设置里关闭。每个工具都有独立 URL 且**服务端预渲染**,SEO 友好。

### 亮点

- **私密 · 离线**:文件默认不出本机,首次加载后可离线使用。
- **免安装**:打开网址即用,无需下载、无需账号。
- **又广又深**:Markdown 编辑器、图片套件、音视频工作台、Python IDE、Office 预览、开发者工具箱,集于一处。
- **单个 Cloudflare Worker**:预渲染站点与可选 `/api/*` 路由一次部署。
- **中英双语**、明暗主题、暗金强调色、移动端到桌面端全响应。
- **可安装为 PWA**,支持 Markdown 文件关联与"保存回原文件"。

### 功能

- **Markdown 编辑器**:多文档标签、自动保存、实时预览、分屏、禅模式;19 套 Typora 风主题(写作主题与导出主题独立、悬停预览,导出默认*跟随写作主题*);预览与导出均支持 **LaTeX(KaTeX)+ Mermaid**;导出 PDF / DOCX / HTML / PNG / TXT / Markdown,支持复制为 HTML/Markdown/图片;**AI 助手**(任意 OpenAI 兼容接口:改写/润色/语法/缩写/扩写/翻译/解释、全文润色/总结/大纲/标题/写作、幽灵补全、⌃Space 续写,均可 Ctrl+Z 撤销);**图床**粘贴/拖拽上传;**跨模块"发送到 →"**。
- **图片**:压缩 · 转格式(PNG/JPG/WebP/AVIF/GIF) · 水印 · 编辑(涂鸦/文字/马赛克遮挡/撤销重做) · **元信息**(查看并编辑 EXIF/GPS/IPTC/XMP,一键移除全部/移除 GPS);结果可下载或复制到剪贴板,全程本地。
- **音视频**(`ffmpeg.wasm`,全在浏览器):转换(音频+视频格式、视频提取音频)· 压缩(分辨率/CRF/码率,实时体积估算)· 编辑(裁剪/淡入淡出/响度归一)· 字幕(烧录或挂载 SRT/ASS/VTT)· **在线转录**(OpenAI 兼容 ASR → TXT/SRT/VTT)· 元信息(改标签不重编码)· **播放器**(本地曲库/歌单/`.lrc` 歌词/ID3 编辑/IndexedDB 缓存,以及网易云·B 站·YouTube 官方内嵌、仅播放)。
- **Python IDE**:Web Worker + Pyodide 多文件 IDE,流式输出、强制停止、**真正阻塞的 `input()`** 交互终端(跨域隔离 + `SharedArrayBuffer`)、可导航 WSGI/ASGI 预览、包/版本管理、运行时缓存、`requests`/`urllib` 代理。
- **Office / 工具箱 / 转换**:打开 `.xlsx`(预览+轻编辑)与 `.pptx`(幻灯片预览);Base64/Hex/URL/HTML 编解码、AES、哈希、JSON 格式化、JWT 解码、字数统计、实时 **TOTP**(RFC 6238);Markdown ↔ PDF/DOCX/HTML、PDF → Markdown/Word。

### 架构

- **前端**:Vue 3 `<script setup>` + Vite 6 + vite-ssg(逐路由预渲染)+ @unhead/vue;路由/i18n/命令从 `src/features/*/index.js` 的 glob 接缝自动注册;composable 为模块级单例。
- **端侧计算**:大体积的 `ffmpeg-core` 与 Pyodide 首次使用时从官方 CDN 加载(超过 Cloudflare 25 MiB 静态资源上限)并经 Cache API 缓存;其余库本地打包。
- **跨域隔离**:`public/_headers` 设置 `COOP: same-origin` + `COEP: credentialless`,启用 `SharedArrayBuffer`(Python 阻塞 `input()`);第三方内嵌用 `credentialless` iframe。
- **限流**:基于 SQLite 的 Durable Object,为易被刷的代理接口提供强一致的按 IP 滑动窗口。
- **设计系统**:全局 `tool-kit.css`(统一 `.card`、`.btn` 深色主操作/金色 CTA、`.segbar`、两档页宽),单色 + 暗金强调色,全 SVG 图标、无 emoji。

### 快速开始(需 Node.js 18+)

```bash
git clone https://github.com/jiangmuran/jmr-typebox.git
cd jmr-typebox
npm install
npm run dev        # 开发服务器 → http://localhost:5173
npm test           # 运行 Vitest
npm run build      # 预渲染所有路由 + 生成 sitemap.xml
npm run deploy     # 构建并部署到 Cloudflare Worker(前端 + /api 一次部署)
```

可选的图床代理需要一个 Worker 密钥(不设则禁用该路由):

```bash
printf '%s' '<你的图床API密钥>' | npx wrangler secret put IMAGE_HOST_KEY
```

### 配置

绝大多数配置在**设置**里(仅存于浏览器本地):**后端总开关**(关闭后所有走 `/api/*` 的功能自动停用)、**AI 助手**(base URL / key / model,直连或走同源代理)、**语音转录 ASR**(可单独配服务商,留空复用 AI)、**图床**(内置代理或自定义)。AI/ASR/自定义图床的密钥都留在你的浏览器;只有共享图床密钥作为服务端 Worker secret。

### PWA 与文件处理

在 Chromium 桌面端把 TypeBox **安装为应用**后:可将其设为 `.md`/`.markdown`/`.txt` 的**默认打开方式**(打开时复用已有窗口);用 Ctrl/Cmd+S **保存回原文件**(File System Access API),Ctrl/Cmd+Shift+S 另存为副本。

### 许可证

[MIT](LICENSE) © Andy Jiang([@jiangmuran](https://github.com/jiangmuran))
