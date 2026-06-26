// GitHub-flavored light theme — original, clean, self-contained.
// Scoped to .markdown-body so it never leaks into app UI. No external fonts / no CDN.
export default `
.markdown-body {
  --mb-fg: #1f2328;
  --mb-muted: #59636e;
  --mb-link: #0969da;
  --mb-border: #d1d9e0;
  --mb-code-bg: #eff1f3;
  --mb-quote: #59636e;
  --mb-accent: #0969da;
  color: var(--mb-fg);
  background: #ffffff;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  font-size: 16px;
  line-height: 1.6;
  word-wrap: break-word;
}
.markdown-body h1, .markdown-body h2, .markdown-body h3,
.markdown-body h4, .markdown-body h5, .markdown-body h6 {
  margin: 24px 0 16px; font-weight: 600; line-height: 1.25;
}
.markdown-body h1 { font-size: 2em; padding-bottom: .3em; border-bottom: 1px solid var(--mb-border); }
.markdown-body h2 { font-size: 1.5em; padding-bottom: .3em; border-bottom: 1px solid var(--mb-border); }
.markdown-body h3 { font-size: 1.25em; }
.markdown-body h4 { font-size: 1em; }
.markdown-body h5 { font-size: .875em; }
.markdown-body h6 { font-size: .85em; color: var(--mb-muted); }
.markdown-body h1:first-child, .markdown-body h2:first-child, .markdown-body h3:first-child { margin-top: 0; }
.markdown-body p, .markdown-body blockquote, .markdown-body ul,
.markdown-body ol, .markdown-body dl, .markdown-body table, .markdown-body pre { margin: 0 0 16px; }
.markdown-body a { color: var(--mb-link); text-decoration: none; }
.markdown-body a:hover { text-decoration: underline; }
.markdown-body strong { font-weight: 600; }
.markdown-body blockquote {
  padding: 0 1em; color: var(--mb-quote);
  border-left: .25em solid var(--mb-border);
}
.markdown-body blockquote > :last-child { margin-bottom: 0; }
.markdown-body ul, .markdown-body ol { padding-left: 2em; }
.markdown-body li + li { margin-top: .25em; }
.markdown-body code {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  font-size: 85%; background: var(--mb-code-bg);
  padding: .2em .4em; border-radius: 6px;
}
.markdown-body pre {
  padding: 16px; overflow: auto; font-size: 85%; line-height: 1.45;
  background: var(--mb-code-bg); border-radius: 6px;
}
.markdown-body pre code { background: transparent; padding: 0; font-size: 100%; }
.markdown-body table { border-collapse: collapse; display: block; width: max-content; max-width: 100%; overflow: auto; }
.markdown-body th, .markdown-body td { padding: 6px 13px; border: 1px solid var(--mb-border); }
.markdown-body th { font-weight: 600; background: #f6f8fa; }
.markdown-body tr:nth-child(2n) td { background: #f6f8fa; }
.markdown-body img { max-width: 100%; box-sizing: content-box; }
.markdown-body hr { height: .25em; padding: 0; margin: 24px 0; background: var(--mb-border); border: 0; }
.markdown-body input[type="checkbox"] { margin-right: .5em; }
`
