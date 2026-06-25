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
  '/image/metadata': {
    title: 'Image Metadata Viewer & Editor — EXIF, GPS, IPTC, XMP — TypeBox',
    description: 'View and edit all image metadata — EXIF, GPS location, IPTC, XMP, and PNG text — in your browser. Edit camera, artist, copyright, and dates, or strip metadata for privacy. Private, nothing uploaded.',
    h1: 'Image Metadata Viewer & Editor',
    keywords: 'exif viewer, exif editor, image metadata, gps location, remove exif, strip metadata, iptc, xmp, png text, edit exif, view metadata, 图片元信息, EXIF 查看, 删除 EXIF, GPS 位置',
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
  // Powered by ffmpeg.wasm (the ~31MB core loads from the official CDN on first use). All routes
  // render the universal converter / subtitle tool; the converter prefills its format from the path.
  '/media/convert': {
    title: 'Audio & Video Converter — MP3, WAV, MP4, WebM, GIF — TypeBox',
    description: 'Convert audio (MP3, WAV, FLAC, OGG, Opus, AAC, M4A) and video (MP4, WebM, MOV, MKV, GIF) — change resolution, or extract audio from video. Runs in your browser with ffmpeg, private and no upload.',
    h1: 'Media Converter',
    keywords: 'audio converter, video converter, convert mp4, video to gif, video to audio, extract audio, change resolution, mp3, wav, flac, ogg, opus, aac, m4a, webm, mov, mkv, 音频转换, 视频转换, 视频提取音频',
  },
  '/media/subtitles': {
    title: 'Add Subtitles to Video — Burn or Mux SRT/ASS — TypeBox',
    description: 'Hardcode (burn) subtitles into a video or add a soft, selectable subtitle track from an SRT/ASS file. In-browser with ffmpeg — private, nothing uploaded.',
    h1: 'Subtitle Tool',
    keywords: 'burn subtitles, hardsub, softsub, mux subtitles, srt, ass, add subtitles to video, 字幕, 烧录字幕',
  },
  // Audio EDIT view (the workbench's trim/fade/normalize, opened directly). Renders MediaConverter
  // with the Edit tab active.
  '/media/edit': {
    title: 'Audio Editor — Trim, Fade & Normalize Online — TypeBox',
    description: 'Trim, fade, adjust volume, and normalize loudness of your audio in the browser with ffmpeg. Private, nothing uploaded — part of the TypeBox audio suite.',
    h1: 'Audio Editor',
    keywords: 'audio editor, trim audio, fade audio, normalize audio, cut mp3, edit audio online, 音频编辑, 剪辑音频',
  },
  // Audio METADATA editor — view AND edit every format-level tag (read via ffmpeg's ffmetadata dump),
  // common + custom keys, cover art, and stream/technical info. Export without re-encoding (-c copy).
  '/media/metadata': {
    title: 'Audio & Video Metadata Editor — Edit ID3 / MP4 Tags — TypeBox',
    description: 'View and edit ALL metadata of any audio or video file (MP3, FLAC, M4A, MP4, MOV, MKV) — title, artist, album, cover art, resolution, and any custom tag. Exports without re-encoding. Private, in-browser, nothing uploaded.',
    h1: 'Audio & Video Metadata Editor',
    keywords: 'audio metadata editor, video metadata, edit id3 tags, mp3 tag editor, mp4 tags, flac tags, vorbis comments, m4a tags, cover art, album art, strip metadata, 音视频元信息, 标签编辑, 元数据',
  },
  // Music PLAYER mode — a private, offline player for audio you own/upload. Library + playlists in
  // IndexedDB, ID3 metadata, synced .lrc lyrics, waveform seek, MediaSession lock-screen controls.
  '/media/player': {
    title: 'Music Player — Play Your Own Audio with Lyrics — TypeBox',
    description: 'A private, offline music player for files you own: playlists saved in your browser, ID3 tags, synced .lrc lyrics, waveform seek, and lock-screen controls. Nothing is uploaded — local files only.',
    h1: 'Music Player',
    keywords: 'music player, local music player, offline player, lrc lyrics, synced lyrics, id3 tags, playlist, waveform, 音乐播放器, 本地播放器, 歌词',
  },
  // Compression tool — shrink a video (CRF/scale/fps/codec) or audio (bitrate), in-browser.
  '/media/compress': {
    title: 'Compress Video & Audio Online — Smaller MP4/MP3 — TypeBox',
    description: 'Compress a video (resolution, quality/CRF, frame rate, H.264/VP9, audio bitrate) or audio (bitrate) with a live size estimate. In your browser with ffmpeg — private, nothing uploaded.',
    h1: 'Compress Audio & Video',
    keywords: 'compress video, compress audio, reduce video size, shrink mp4, video compressor, lower bitrate, crf, downscale resolution, 压缩视频, 压缩音频, 视频压缩, 缩小体积',
  },
  // Online ASR transcription — audio/video → text + SRT/VTT via a configured speech-to-text model.
  '/media/transcribe': {
    title: 'Transcribe Audio & Video to Text — SRT / VTT — TypeBox',
    description: 'Transcribe speech from an audio or video file into text with timestamps and export TXT, SRT, or VTT. Uses your configured OpenAI-compatible speech-to-text model; long files are auto-chunked.',
    h1: 'Transcribe Audio & Video',
    keywords: 'transcribe audio, transcribe video, speech to text, audio to text, video to srt, generate subtitles, whisper, asr, captions, vtt, 转录, 语音转文字, 视频转字幕, 听写',
  },
  '/media/mp3-to-wav': {
    title: 'MP3 to WAV Converter — TypeBox',
    description: 'Convert MP3 audio to WAV in your browser — private, no upload, runs entirely on your device with ffmpeg.',
    h1: 'MP3 to WAV',
    keywords: 'mp3 to wav, audio converter, convert mp3 online, 音频转换',
  },
  '/media/wav-to-mp3': {
    title: 'WAV to MP3 Converter — TypeBox',
    description: 'Convert WAV audio to MP3 in your browser. Adjustable bitrate, private and runs on your device with ffmpeg.',
    h1: 'WAV to MP3',
    keywords: 'wav to mp3, audio converter, convert wav online, 音频转换',
  },
  '/media/mp4-to-mp3': {
    title: 'MP4 to MP3 — Extract Audio from Video — TypeBox',
    description: 'Extract the audio track from an MP4 (or MOV/WebM/MKV) video and save it as MP3, in your browser with ffmpeg. Private, no upload.',
    h1: 'MP4 to MP3',
    keywords: 'mp4 to mp3, extract audio from video, video to mp3, 视频提取音频, 视频转mp3',
  },
  '/media/m4a-to-mp3': {
    title: 'M4A to MP3 Converter — TypeBox',
    description: 'Convert M4A (AAC) audio to MP3 in your browser with ffmpeg. Adjustable bitrate, private and instant.',
    h1: 'M4A to MP3',
    keywords: 'm4a to mp3, aac to mp3, audio converter, 音频转换',
  },
  '/media/flac-to-mp3': {
    title: 'FLAC to MP3 Converter — TypeBox',
    description: 'Convert lossless FLAC audio to MP3 in your browser with ffmpeg. Choose your bitrate, fully private.',
    h1: 'FLAC to MP3',
    keywords: 'flac to mp3, lossless to mp3, audio converter, 音频转换',
  },
  '/media/wav-to-flac': {
    title: 'WAV to FLAC Converter — Lossless — TypeBox',
    description: 'Convert WAV audio to lossless FLAC in your browser with ffmpeg. Smaller files, no quality loss, private.',
    h1: 'WAV to FLAC',
    keywords: 'wav to flac, lossless audio, compress wav, audio converter, 无损音频',
  },
  '/media/ogg-to-mp3': {
    title: 'OGG to MP3 Converter — TypeBox',
    description: 'Convert OGG (Vorbis) audio to MP3 in your browser with ffmpeg. Adjustable bitrate, private and instant.',
    h1: 'OGG to MP3',
    keywords: 'ogg to mp3, vorbis to mp3, audio converter, 音频转换',
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
  '/tools/totp': {
    title: 'TOTP Authenticator Code Generator — TypeBox',
    description: 'Generate live TOTP two-factor (2FA) codes from a base32 secret or otpauth:// link, in your browser. Private — nothing is sent anywhere.',
    h1: 'TOTP Generator',
    keywords: 'totp, 2fa, authenticator, one-time password, otpauth, two-factor code, 动态口令, 两步验证',
  },

  // ---- Python ----
  '/python': {
    title: 'Python Playground — Run Python in the Browser — TypeBox',
    description: 'Run Python online with Pyodide: plots, packages via micropip, and HTML output — no server, fully sandboxed and cached.',
    h1: 'Python Playground',
    keywords: 'python online, run python browser, pyodide, python playground, python interpreter',
  },

  // ---- Office (Excel / PowerPoint viewer) ----
  // Renders an in-browser preview (+ light spreadsheet editing) of .xlsx / .pptx files. SheetJS and
  // JSZip are lazy-loaded only after a file is opened, so this route stays light at prerender.
  '/office': {
    title: 'Excel & PowerPoint Viewer — Open XLSX / PPTX Online — TypeBox',
    description: 'Open and preview Excel (.xlsx) spreadsheets and PowerPoint (.pptx) slides in your browser. Edit spreadsheet cells and re-download as .xlsx. Private, no upload.',
    h1: 'Spreadsheet & Slides Viewer',
    keywords: 'xlsx viewer, excel viewer online, open xlsx, pptx viewer, powerpoint viewer, edit spreadsheet, view slides, 表格预览, 幻灯片预览',
  },
}

export const ALL_PATHS = Object.keys(ROUTE_META)

// Production origin for canonical URLs + sitemap. Override at build via SITE_ORIGIN env.
export const SITE_ORIGIN = 'https://box.muran.tech'
