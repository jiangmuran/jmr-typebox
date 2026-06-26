const o=`
.markdown-body {
  --mb-fg: #2b2620;
  --mb-muted: #6b6256;
  --mb-link: #8c4a2f;
  --mb-border: #ddd3c4;
  --mb-code-bg: #f3ede1;
  --mb-quote: #6b6256;
  color: var(--mb-fg);
  background: #fbf7ef;
  font-family: Georgia, Cambria, "Times New Roman", "Songti SC", "SimSun", serif;
  font-size: 17px;
  line-height: 1.75;
}
.markdown-body h1, .markdown-body h2, .markdown-body h3,
.markdown-body h4, .markdown-body h5, .markdown-body h6 {
  margin: 1.6em 0 .6em; font-weight: 700; line-height: 1.25; letter-spacing: -0.01em;
}
.markdown-body h1 { font-size: 2.1em; text-align: center; margin-top: 0; padding-bottom: .3em; border-bottom: 2px solid var(--mb-fg); }
.markdown-body h2 { font-size: 1.6em; padding-bottom: .2em; border-bottom: 1px solid var(--mb-border); }
.markdown-body h3 { font-size: 1.3em; }
.markdown-body h4 { font-size: 1.1em; }
.markdown-body h5 { font-size: 1em; }
.markdown-body h6 { font-size: .92em; color: var(--mb-muted); font-style: italic; }
.markdown-body p { margin: 0 0 1.1em; text-align: justify; hyphens: auto; }
.markdown-body a { color: var(--mb-link); text-decoration: none; border-bottom: 1px solid rgba(140,74,47,.35); }
.markdown-body a:hover { border-bottom-color: var(--mb-link); }
.markdown-body strong { font-weight: 700; }
.markdown-body em { font-style: italic; }
.markdown-body blockquote {
  margin: 1.2em 0; padding: .2em 1.2em; color: var(--mb-quote);
  border-left: 3px solid var(--mb-border); font-style: italic;
}
.markdown-body blockquote > :last-child { margin-bottom: 0; }
.markdown-body ul, .markdown-body ol { margin: 0 0 1.1em; padding-left: 1.6em; }
.markdown-body li { margin: .35em 0; }
.markdown-body code {
  font-family: "Courier New", Courier, monospace; font-size: 88%;
  background: var(--mb-code-bg); padding: .15em .4em; border-radius: 3px;
}
.markdown-body pre {
  margin: 1.2em 0; padding: 14px 18px; overflow: auto; font-size: 14px; line-height: 1.5;
  background: var(--mb-code-bg); border: 1px solid var(--mb-border); border-radius: 4px;
}
.markdown-body pre code { background: transparent; padding: 0; font-size: 100%; }
.markdown-body table { border-collapse: collapse; width: 100%; margin: 1.2em 0; font-size: .95em; }
.markdown-body th, .markdown-body td { padding: 8px 14px; border: 1px solid var(--mb-border); }
.markdown-body th { font-weight: 700; background: var(--mb-code-bg); }
.markdown-body img { max-width: 100%; border-radius: 2px; }
.markdown-body hr { height: 1px; padding: 0; margin: 2em auto; width: 40%; background: var(--mb-border); border: 0; }
`;export{o as default};
