import { marked } from 'marked'
import DOMPurify from 'dompurify'
import hljs from 'highlight.js/lib/core'

// Import common languages
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import python from 'highlight.js/lib/languages/python'
import css from 'highlight.js/lib/languages/css'
import xml from 'highlight.js/lib/languages/xml'
import json from 'highlight.js/lib/languages/json'
import bash from 'highlight.js/lib/languages/bash'
import markdown from 'highlight.js/lib/languages/markdown'
import sql from 'highlight.js/lib/languages/sql'
import java from 'highlight.js/lib/languages/java'
import go from 'highlight.js/lib/languages/go'
import rust from 'highlight.js/lib/languages/rust'
import cpp from 'highlight.js/lib/languages/cpp'
import yaml from 'highlight.js/lib/languages/yaml'

hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('js', javascript)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('ts', typescript)
hljs.registerLanguage('python', python)
hljs.registerLanguage('py', python)
hljs.registerLanguage('css', css)
hljs.registerLanguage('html', xml)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('json', json)
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('sh', bash)
hljs.registerLanguage('shell', bash)
hljs.registerLanguage('markdown', markdown)
hljs.registerLanguage('md', markdown)
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('java', java)
hljs.registerLanguage('go', go)
hljs.registerLanguage('rust', rust)
hljs.registerLanguage('cpp', cpp)
hljs.registerLanguage('c', cpp)
hljs.registerLanguage('yaml', yaml)
hljs.registerLanguage('yml', yaml)

// Configure marked
marked.setOptions({
  breaks: true,
  gfm: true,
  highlight(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(code, { language: lang }).value
      } catch {}
    }
    try {
      return hljs.highlightAuto(code).value
    } catch {}
    return code
  },
})

export function renderMarkdown(text) {
  try {
    const raw = marked.parse(text)
    return DOMPurify.sanitize(raw)
  } catch (e) {
    console.error('Markdown render error:', e)
    return ''
  }
}

export function buildStandaloneHTML(title, bodyHTML) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>
body{max-width:800px;margin:40px auto;padding:0 24px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,"PingFang SC",sans-serif;line-height:1.7;color:#24292f;font-size:15px}
h1,h2{border-bottom:1px solid #d0d7de;padding-bottom:.3em}h1{font-size:2em}h2{font-size:1.5em}h3{font-size:1.25em}
a{color:#0969da;text-decoration:none}a:hover{text-decoration:underline}
code{background:#f6f8fa;padding:.15em .4em;border-radius:4px;font-size:85%;font-family:"SF Mono","Fira Code",monospace}
pre{background:#f6f8fa;padding:16px;border-radius:8px;overflow-x:auto}pre code{background:none;padding:0;font-size:13px}
blockquote{border-left:3px solid #0969da;padding:.5em 1em;margin:1em 0;background:rgba(9,105,218,.05);border-radius:0 6px 6px 0;color:#57606a}
table{border-collapse:collapse;width:100%;margin:1em 0}th,td{border:1px solid #d0d7de;padding:8px 14px;text-align:left}th{background:#f6f8fa;font-weight:600}
img{max-width:100%;border-radius:8px}hr{border:none;height:1px;background:#d0d7de;margin:2em 0}
</style>
</head>
<body>${bodyHTML}</body>
</html>`
}

export { hljs }
