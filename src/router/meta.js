// Per-route SEO metadata. Keys are URL paths; values drive <head> (ToolStub/pages),
// the sitemap, and command-palette navigation. Titles are English for SEO and must be
// unique; `h1` is the on-page heading (UI strings localize separately via useI18n).

export const ROUTE_META = {
  '/': {
    title: 'TypeBox — Markdown Editor & Format Toolkit',
    description: 'Fast, private, offline Markdown editor with live preview and one-click export to PDF, DOCX, HTML, and PNG. No login, no upload.',
    h1: 'Markdown Editor',
    keywords: 'markdown editor, online markdown, offline, export pdf, export docx',
  },
  '/txt': {
    title: 'Quick TXT Editor — Create Text Files Online — TypeBox',
    description: 'Create and download plain .txt files instantly in your browser. Lightweight and mobile-friendly, no sign-up.',
    h1: 'TXT Editor',
    keywords: 'txt editor, create text file, plain text, notepad online',
  },

  // ---- Image ----
  '/image/compress': {
    title: 'Compress Images Online — PNG, JPG, WebP — TypeBox',
    description: 'Compress PNG, JPG, and WebP images directly in your browser. Adjustable quality and size, fully private — nothing is uploaded.',
    h1: 'Compress Images',
    keywords: 'image compressor, compress png, compress jpg, webp, reduce image size',
  },
  '/image/convert': {
    title: 'Convert Image Format — PNG/JPG/WebP — TypeBox',
    description: 'Convert images between PNG, JPG, and WebP in your browser. Batch conversion, private and instant.',
    h1: 'Convert Image Format',
    keywords: 'image converter, png to jpg, jpg to webp, convert image format',
  },
  '/image/watermark': {
    title: 'Add Watermark to Images Online — TypeBox',
    description: 'Add text or image watermarks to your photos — position, opacity, rotation, and tiling. Private, client-side.',
    h1: 'Watermark Images',
    keywords: 'watermark image, add watermark, photo watermark, batch watermark',
  },
  '/image/edit': {
    title: 'Quick Image Editor — Draw, Add Text, Redact — TypeBox',
    description: 'Annotate images in your browser: doodle, add text, and redact with mosaic or blur. Undo/redo, private, no upload.',
    h1: 'Edit & Annotate Images',
    keywords: 'image annotator, draw on image, add text to image, blur image, mosaic, redact',
  },

  // ---- Convert ----
  '/convert/markdown-to-pdf': {
    title: 'Markdown to PDF Converter — TypeBox',
    description: 'Convert Markdown to a polished PDF with selectable text and themed styling, fully in your browser.',
    h1: 'Markdown to PDF',
    keywords: 'markdown to pdf, md to pdf, convert markdown, export pdf',
  },
  '/convert/markdown-to-docx': {
    title: 'Markdown to Word (DOCX) Converter — TypeBox',
    description: 'Convert Markdown to an editable Word .docx document in your browser. Headings, lists, tables, and code preserved.',
    h1: 'Markdown to DOCX',
    keywords: 'markdown to word, md to docx, markdown to docx, convert markdown word',
  },
  '/convert/markdown-to-html': {
    title: 'Markdown to HTML Converter — TypeBox',
    description: 'Convert Markdown to clean, standalone HTML with your chosen theme. Copy or download, fully client-side.',
    h1: 'Markdown to HTML',
    keywords: 'markdown to html, md to html, convert markdown html',
  },
  '/convert/pdf-to-markdown': {
    title: 'PDF to Markdown Converter — TypeBox',
    description: 'Extract clean Markdown from PDFs in your browser — headings, lists, and tables detected automatically. Private, no upload.',
    h1: 'PDF to Markdown',
    keywords: 'pdf to markdown, pdf to md, extract text from pdf, convert pdf',
  },
  '/convert/pdf-to-word': {
    title: 'PDF to Word (DOCX) Converter — TypeBox',
    description: 'Turn a PDF into an editable Word .docx in your browser via smart layout extraction. Private and instant.',
    h1: 'PDF to Word',
    keywords: 'pdf to word, pdf to docx, convert pdf to word, editable word from pdf',
  },

  // ---- Media ----
  '/media/mp3-to-wav': {
    title: 'MP3 to WAV Converter — TypeBox',
    description: 'Convert MP3 audio to WAV in your browser with ffmpeg.wasm. Private, no upload, runs entirely on your device.',
    h1: 'MP3 to WAV',
    keywords: 'mp3 to wav, audio converter, convert mp3, ffmpeg wasm',
  },
  '/media/wav-to-mp3': {
    title: 'WAV to MP3 Converter — TypeBox',
    description: 'Convert WAV audio to MP3 in your browser with ffmpeg.wasm. Adjustable bitrate, private and offline-capable.',
    h1: 'WAV to MP3',
    keywords: 'wav to mp3, audio converter, convert wav, ffmpeg wasm',
  },

  // ---- Toolbox ----
  '/tools/word-count': {
    title: 'Word Count Tool — Characters, Words, Reading Time — TypeBox',
    description: 'Count words, characters, lines, and paragraphs with reading-time estimate, live as you type. Private and free.',
    h1: 'Word Count',
    keywords: 'word count, character count, reading time, text counter',
  },
  '/tools/base64': {
    title: 'Base64 / Hex / URL Encode & Decode — TypeBox',
    description: 'Encode and decode Base64, Hex, URL, HTML entities, and Unicode escapes in your browser. Private, instant.',
    h1: 'Encode / Decode',
    keywords: 'base64 encode, base64 decode, hex, url encode, html entities',
  },
  '/tools/aes': {
    title: 'AES Encrypt & Decrypt Online — TypeBox',
    description: 'Encrypt and decrypt text with AES-GCM and a passphrase, fully in your browser using the Web Crypto API.',
    h1: 'AES Encrypt / Decrypt',
    keywords: 'aes encrypt, aes decrypt, encryption tool, web crypto, password encrypt text',
  },
  '/tools/hash': {
    title: 'Hash Generator — MD5, SHA, HMAC — TypeBox',
    description: 'Generate MD5, SHA-1/256/384/512, and HMAC hashes from text in your browser. Private and instant.',
    h1: 'Hash Generator',
    keywords: 'md5, sha256, sha512, hmac, hash generator, checksum',
  },
  '/tools/json': {
    title: 'JSON Formatter & Validator — TypeBox',
    description: 'Format, minify, and validate JSON in your browser. Fast, private, and free — nothing leaves your device.',
    h1: 'JSON Formatter',
    keywords: 'json formatter, json validator, json minify, pretty print json',
  },
  '/tools/jwt': {
    title: 'JWT Decoder — Decode JSON Web Tokens — TypeBox',
    description: 'Decode JWT header and payload locally in your browser. Inspect claims without sending tokens anywhere.',
    h1: 'JWT Decoder',
    keywords: 'jwt decoder, decode jwt, json web token, jwt parser',
  },

  // ---- Python ----
  '/python': {
    title: 'Python Playground — Run Python in the Browser — TypeBox',
    description: 'Run Python online with Pyodide: plots, packages via micropip, and HTML output — no server, fully sandboxed and cached.',
    h1: 'Python Playground',
    keywords: 'python online, run python browser, pyodide, python playground, python interpreter',
  },
}

export const ALL_PATHS = Object.keys(ROUTE_META)

// Production origin for canonical URLs + sitemap. Override at build via SITE_ORIGIN env.
// TODO(launch): confirm the final production domain.
export const SITE_ORIGIN = 'https://typebox.jiangmuran.com'
