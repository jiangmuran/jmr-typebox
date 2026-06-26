// Minimal — original ultra-clean light theme, generous whitespace. Scoped to .markdown-body.
export default `
.markdown-body {
  --mb-fg: #222;
  --mb-muted: #777;
  --mb-link: #111;
  --mb-border: #e7e7e7;
  --mb-code-bg: #f5f5f5;
  --mb-quote: #555;
  color: var(--mb-fg);
  background: #ffffff;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Helvetica, "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 16px;
  line-height: 1.8;
}
.markdown-body h1, .markdown-body h2, .markdown-body h3,
.markdown-body h4, .markdown-body h5, .markdown-body h6 {
  margin: 2em 0 .8em; font-weight: 600; line-height: 1.3; letter-spacing: -0.02em;
}
.markdown-body h1 { font-size: 1.9em; margin-top: 0; }
.markdown-body h2 { font-size: 1.45em; }
.markdown-body h3 { font-size: 1.2em; }
.markdown-body h4 { font-size: 1.05em; }
.markdown-body h5 { font-size: .95em; }
.markdown-body h6 { font-size: .9em; color: var(--mb-muted); }
.markdown-body p { margin: 0 0 1.2em; }
.markdown-body a { color: var(--mb-link); text-decoration: underline; text-underline-offset: 2px; text-decoration-thickness: 1px; }
.markdown-body a:hover { color: var(--mb-muted); }
.markdown-body strong { font-weight: 600; }
.markdown-body blockquote {
  margin: 1.4em 0; padding: 0 0 0 1.2em; color: var(--mb-quote);
  border-left: 2px solid var(--mb-border); font-style: italic;
}
.markdown-body blockquote > :last-child { margin-bottom: 0; }
.markdown-body ul, .markdown-body ol { margin: 0 0 1.2em; padding-left: 1.5em; }
.markdown-body li { margin: .4em 0; }
.markdown-body code {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-size: 86%; background: var(--mb-code-bg); padding: .15em .4em; border-radius: 4px;
}
.markdown-body pre {
  margin: 1.4em 0; padding: 16px 18px; overflow: auto; font-size: 14px; line-height: 1.5;
  background: var(--mb-code-bg); border-radius: 8px;
}
.markdown-body pre code { background: transparent; padding: 0; font-size: 100%; }
.markdown-body table { border-collapse: collapse; width: 100%; margin: 1.4em 0; font-size: .95em; }
.markdown-body th, .markdown-body td { padding: 8px 12px; border-bottom: 1px solid var(--mb-border); text-align: left; }
.markdown-body th { font-weight: 600; }
.markdown-body img { max-width: 100%; }
.markdown-body hr { height: 1px; padding: 0; margin: 2.5em 0; background: var(--mb-border); border: 0; }
`
