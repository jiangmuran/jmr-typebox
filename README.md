<div align="center">

# TypeBox

**A fast, private, offline-first toolkit for text, images, files & code — all in your browser.**

No login. No upload. Nothing leaves your device (unless you explicitly opt into an optional backend).

[Live site](https://typebox.jiangmuran.com) · [Report a bug](https://github.com/jiangmuran/jmr-typebox/issues) · [中文](#中文)

![License: MIT](https://img.shields.io/badge/license-MIT-black)
![Vue 3](https://img.shields.io/badge/Vue-3-black)
![Offline first](https://img.shields.io/badge/offline-first-black)

</div>

---

## What is it?

TypeBox is a single, beautifully simple page that hides a deep toolbox. Write Markdown, convert documents, edit images, transcode audio, run Python, and process text — without installing anything and without your files ever being uploaded. Everything heavy is **lazy-loaded** so the first screen opens instantly.

The page stays minimal on purpose; press **⌘K / Ctrl+K** to find any tool, action, or setting.

## Features

| Area | What you get |
|---|---|
| **✍️ Editor** | Markdown editor with live preview, split view, Zen mode, autosave, and one-click export to **PDF / DOCX / HTML / PNG**. |
| **🔤 TXT** | Quick plain-text file creator — handy on mobile. |
| **🖼️ Image** | **Compress** · **Convert** (PNG/JPG/WebP/AVIF) · **Watermark** (text/image, 9-grid) · **Edit** (doodle, add text, redact with mosaic/blur, undo/redo). All on-canvas, no upload. |
| **🔄 Convert** | Markdown → PDF (vector, selectable text) / DOCX / HTML, and PDF → Markdown / Word. Export themes inspired by Typora, with hover preview. |
| **🎵 Media** | Audio conversion (MP3 ↔ WAV) in your browser via Web Audio + **lamejs** — fully local. |
| **🧰 Toolbox** | Base64 / Hex / URL / HTML encode-decode, **AES** encrypt/decrypt, **hashes** (MD5/SHA/HMAC), JSON formatter, JWT decoder, word count. |
| **🐍 Python** | Run Python in the browser via **Pyodide** — plots, packages, and HTML output, fully sandboxed. |
| **🔌 Right-click plugins** | Select text in the editor and transform it in place (encode, case, JSON, sort/dedupe lines, hash…). |
| **⌘K Command palette** | Search and jump to any tool, action, theme, or setting. |
| **🎨 Customizable** | Theme (light/dark/system), accent color, editor font/size, density, which tabs show, default tool, and more. |
| **🔒 Private & offline** | Files are processed locally. Works offline after first load. Optional backend features are clearly marked and can be disabled. |

Every tool has its own URL and is server-rendered for SEO (e.g. `/tools/aes`, `/convert/markdown-to-pdf`, `/python`).

## Quick start

```bash
git clone https://github.com/jiangmuran/jmr-typebox.git
cd jmr-typebox
npm install
npm run dev        # http://localhost:5173
```

Build and preview the static site:

```bash
npm run build      # prerenders every route + writes sitemap.xml
npm run preview
```

## Architecture

```
Single Cloudflare Worker
├─ /api/*   → optional backend handlers (URL fetch proxy, link preview)
└─ *        → static SSG frontend (ASSETS binding), SPA fallback
```

- **Frontend:** Vue 3 + Vite + [vite-ssg](https://github.com/antfu/vite-ssg) (every route prerendered to static HTML for SEO) + `@unhead/vue`.
- **Everything client-side by default:** image/audio/text/crypto/conversions run in your browser (Canvas, Web Crypto, Web Audio + lamejs, Pyodide, html-to-docx). No library is loaded from a CDN — all are bundled or self-hosted. (The one exception is the privacy-friendly Cloudflare Web Analytics beacon.)
- **Heavy assets are lazy-loaded and cached** (ffmpeg core, Pyodide, etc.) so the editor opens fast.

## Optional backend

A few features need a tiny server because browsers can't do them cross-origin:

- **Import from URL** — `/api/fetch` proxies a remote image/file/markdown (SSRF-guarded: http(s) only, private hosts blocked, size/time limits).
- **Link preview** — `/api/preview` extracts Open Graph metadata.

The backend is **100% optional and open source** ([`/worker`](worker/)). If it isn't deployed, or you turn it off in Settings, the app still works — those specific features just hide themselves. Any UI that uses the backend shows an **ⓘ** explaining this.

### Deploy the Worker (frontend + optional backend, one command)

```bash
npm run deploy     # vite-ssg build + wrangler deploy
```

The Worker serves the prerendered site and the `/api/*` routes from one deployment. See [`wrangler.toml`](wrangler.toml).

## Privacy

Your documents and files are processed entirely in your browser. The only network calls are: loading the app, lazy-loading a heavy library the first time you use a feature that needs it, and—if you opt in—the optional backend above. Usage is measured with [Cloudflare Web Analytics](https://www.cloudflare.com/web-analytics/) (cookieless, no personal data).

## Themes

Export and writing themes are inspired by the [Typora theme gallery](https://theme.typora.io/) (community themes, open-source licensed) and bundled locally — see [CREDITS.md](CREDITS.md).

## Contributing

Issues and PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Adding a tool is usually a drop-in: create a folder under `src/features/<name>/` and it auto-registers (routes, i18n, commands).

## License

[MIT](LICENSE) © Andy Jiang ([@jiangmuran](https://github.com/jiangmuran))

---

<a name="中文"></a>

## 中文

**TypeBox** 是一个快速、私密、离线优先的浏览器工具箱:写 Markdown、转换文档、处理图片、转码音频、运行 Python、处理文本——无需安装、文件不上传。页面保持极简,按 **⌘K / Ctrl+K** 搜索任意工具、操作或设置。

- **本地优先**:图片/音频/文本/加解密/转换都在浏览器里完成,默认不上传;所有库本地打包或自托管,不走 CDN(仅保留隐私友好的 Cloudflare Web Analytics)。
- **可选后端**(开源、可在设置一键关闭):仅用于"从网址导入"(CORS 代理)与"链接预览"(OG 抓取),用到的地方都有 **ⓘ** 说明。
- **每个工具都有独立 URL 且服务端预渲染**,SEO 友好。
- **重资源懒加载 + 缓存**,首页秒开。

快速开始:`npm install && npm run dev`;构建:`npm run build`;部署(单个 CF Worker 同时托管前端 + `/api`):`npm run deploy`。

许可证 [MIT](LICENSE)。
