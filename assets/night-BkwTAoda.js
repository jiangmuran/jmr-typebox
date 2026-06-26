const o=`
.markdown-body {
  --mb-fg: #e6e6ea;
  --mb-muted: #9a9aa6;
  --mb-link: #7aa2f7;
  --mb-border: #2d3343;
  --mb-code-bg: #1b1f2a;
  --mb-quote: #a3a3b2;
  color: var(--mb-fg);
  background: #14171f;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 16px;
  line-height: 1.7;
}
.markdown-body h1, .markdown-body h2, .markdown-body h3,
.markdown-body h4, .markdown-body h5, .markdown-body h6 {
  margin: 1.5em 0 .6em; font-weight: 650; line-height: 1.3; color: #f4f4f8;
}
.markdown-body h1 { font-size: 2em; padding-bottom: .3em; border-bottom: 1px solid var(--mb-border); margin-top: 0; }
.markdown-body h2 { font-size: 1.5em; padding-bottom: .25em; border-bottom: 1px solid var(--mb-border); }
.markdown-body h3 { font-size: 1.25em; }
.markdown-body h4 { font-size: 1em; }
.markdown-body h5 { font-size: .9em; }
.markdown-body h6 { font-size: .85em; color: var(--mb-muted); }
.markdown-body p { margin: 0 0 1em; }
.markdown-body a { color: var(--mb-link); text-decoration: none; }
.markdown-body a:hover { text-decoration: underline; }
.markdown-body strong { font-weight: 650; color: #fff; }
.markdown-body blockquote {
  margin: 1em 0; padding: .5em 1em; color: var(--mb-quote);
  border-left: 3px solid var(--mb-link); background: rgba(122,162,247,.08);
  border-radius: 0 6px 6px 0;
}
.markdown-body blockquote > :last-child { margin-bottom: 0; }
.markdown-body ul, .markdown-body ol { margin: 0 0 1em; padding-left: 1.8em; }
.markdown-body li { margin: .3em 0; }
.markdown-body code {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-size: 85%; background: var(--mb-code-bg); padding: .2em .4em; border-radius: 5px;
  border: 1px solid var(--mb-border);
}
.markdown-body pre {
  margin: 1em 0; padding: 16px 18px; overflow: auto; font-size: 14px; line-height: 1.5;
  background: var(--mb-code-bg); border: 1px solid var(--mb-border); border-radius: 8px;
}
.markdown-body pre code { background: transparent; padding: 0; border: 0; font-size: 100%; }
.markdown-body table { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: .95em; }
.markdown-body th, .markdown-body td { padding: 8px 14px; border: 1px solid var(--mb-border); }
.markdown-body th { font-weight: 600; background: var(--mb-code-bg); }
.markdown-body tr:nth-child(2n) td { background: rgba(255,255,255,.02); }
.markdown-body img { max-width: 100%; border-radius: 8px; }
.markdown-body hr { height: 1px; padding: 0; margin: 2em 0; background: var(--mb-border); border: 0; }
`;export{o as default};
