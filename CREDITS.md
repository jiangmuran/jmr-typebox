# Credits

TypeBox stands on excellent open-source work. All libraries are bundled or self-hosted locally (no CDN).

## Core
- [Vue 3](https://vuejs.org/) · [Vite](https://vitejs.dev/) · [vite-ssg](https://github.com/antfu/vite-ssg) · [@unhead/vue](https://unhead.unjs.io/) · [vue-router](https://router.vuejs.org/)

## Tools & conversion
- [marked](https://marked.js.org/) + [DOMPurify](https://github.com/cure53/DOMPurify) + [highlight.js](https://highlightjs.org/) — Markdown rendering
- [pdfjs-dist](https://mozilla.github.io/pdf.js/) — PDF text extraction
- [html2canvas](https://html2canvas.hertzen.com/) + [jsPDF](https://github.com/parallax/jsPDF) — image-based PDF/PNG export
- [@turbodocx/html-to-docx](https://github.com/TurboDocx/html-to-docx) — Markdown/HTML → DOCX
- [@ffmpeg/ffmpeg + @ffmpeg/core](https://github.com/ffmpegwasm/ffmpeg.wasm) — audio transcoding (self-hosted single-thread core)
- [Pyodide](https://pyodide.org/) — Python in the browser *(planned)*

## Themes
Export/writing themes ship as local, original CSS inspired by the [Typora theme gallery](https://theme.typora.io/). When community Typora themes (e.g. Nocturne, Inkwell, Lightmind, Ivory Flow, Johntor Dark Blue, Phycat) are vendored, their original authors and licenses (typically MIT) will be credited here per theme.

## Analytics
- [Cloudflare Web Analytics](https://www.cloudflare.com/web-analytics/) — privacy-friendly, cookieless usage measurement (the only intentional external script).
