import{_ as r}from"./app-C11Qr4rh.js";import{l as s}from"./loadLibrary-BzZ4uu82.js";import{r as f,t as c,e as d,a as p}from"./markdown-CU8S7vjc.js";import{M as h}from"./fileHelpers-SgtbByGP.js";const b=`
  body { font-family: Calibri, "PingFang SC", "Microsoft YaHei", sans-serif; font-size: 11pt; line-height: 1.5; color: #1a1a1a; }
  h1 { font-size: 22pt; } h2 { font-size: 17pt; } h3 { font-size: 14pt; }
  h4, h5, h6 { font-size: 12pt; }
  h1, h2, h3, h4, h5, h6 { font-weight: 700; margin: 14pt 0 6pt; }
  p { margin: 0 0 8pt; }
  a { color: #0563c1; }
  blockquote { margin: 8pt 0; padding-left: 12pt; border-left: 3px solid #cccccc; color: #555555; }
  ul, ol { margin: 0 0 8pt 0; }
  code, pre { font-family: Consolas, "Courier New", monospace; }
  pre { background: #f4f4f4; padding: 8pt; border: 1px solid #e0e0e0; }
  code { background: #f4f4f4; padding: 1pt 3pt; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #bfbfbf; padding: 4pt 8pt; }
  th { background: #f0f0f0; font-weight: 700; }
  img { max-width: 100%; }
`;function u(t,e="Document"){const a=f(t||"");return`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${String(e).replace(/[<>&]/g,"")}</title><style>${b}</style></head><body class="markdown-body">${a}</body></html>`}function m(){typeof globalThis<"u"&&typeof globalThis.global>"u"&&(globalThis.global=globalThis)}let o=null;async function g(){if(o)return o;const t=await s("docx",()=>r(()=>import("./html-to-docx.browser.esm-DUEVBo51.js"),[]),{sizeMB:1.2});return o=t.default||t,o}async function _(t,e="Document",a={}){m(),c(t)&&await d(),/```|~~~/.test(t||"")&&await p().catch(()=>{});const l=await g(),n=u(t,e),i=await l(n,null,{table:{row:{cantSplit:!0}},footer:!1,pageNumber:!1,font:"Calibri",...a});return i instanceof Blob?i:new Blob([i],{type:h.docx})}export{u as buildDocxHtml,_ as markdownToDocxBlob};
