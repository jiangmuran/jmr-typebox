import{_ as n}from"./app-B1Roq3Ff.js";import{l as f}from"./loadLibrary-BXykxCuf.js";import{r as d}from"./markdown-A_QFduJc.js";import{M as s}from"./fileHelpers-SgtbByGP.js";import"./_commonjsHelpers-Cpj98o6Y.js";const c=`
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
`;function p(o,e="Document"){const r=d(o||"");return`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${String(e).replace(/[<>&]/g,"")}</title><style>${c}</style></head><body class="markdown-body">${r}</body></html>`}function b(){typeof globalThis<"u"&&typeof globalThis.global>"u"&&(globalThis.global=globalThis)}let t=null;async function h(){if(t)return t;const o=await f("docx",()=>n(()=>import("./html-to-docx.browser.esm-DUEVBo51.js"),[]),{sizeMB:1.2});return t=o.default||o,t}async function x(o,e="Document",r={}){b();const i=await h(),l=p(o,e),a=await i(l,null,{table:{row:{cantSplit:!0}},footer:!1,pageNumber:!1,font:"Calibri",...r});return a instanceof Blob?a:new Blob([a],{type:s.docx})}export{p as buildDocxHtml,x as markdownToDocxBlob};
