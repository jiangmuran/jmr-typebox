const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/jspdf.es.min-CxV_pulz.js","assets/app-C11Qr4rh.js","assets/app-Cqw9Oev_.css"])))=>i.map(i=>d[i]);
import{_ as x}from"./app-C11Qr4rh.js";import{t as P,e as T,a as k,r as E}from"./markdown-CU8S7vjc.js";import{g as _,a as C}from"./registry-BGTOaqwm.js";import{l as v}from"./loadLibrary-BzZ4uu82.js";const S=`
@page { size: A4; margin: 18mm 16mm; }
html, body { margin: 0; padding: 0; }
body { padding: 0; }
.markdown-body { padding: 0; max-width: 100%; }
.markdown-body pre, .markdown-body table, .markdown-body img, .markdown-body blockquote { break-inside: avoid; }
.markdown-body h1, .markdown-body h2, .markdown-body h3 { break-after: avoid; }
@media screen { body { max-width: 820px; margin: 0 auto; padding: 32px 24px; } }
`;async function $(t,o,n,{includePrintCss:i=!1}={}){var c;const e=await _(n),a=C(n);P(t)&&await T(),/```|~~~/.test(t||"")&&await k().catch(()=>{});const d=E(t||""),r=String(o||"Document").replace(/[<>&]/g,""),s=((c=a.swatch)==null?void 0:c.bg)||"#ffffff";return`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${r}</title>
<style>
html { background: ${s}; }
body { margin: 0; }
${e}
${i?S:"body{max-width:820px;margin:40px auto;padding:0 24px;}"}
</style>
</head>
<body><article class="markdown-body">${d}</article></body>
</html>`}async function O(t,o,n){if(typeof document>"u")return;const i=await $(t,o,n,{includePrintCss:!0}),e=document.createElement("iframe");e.setAttribute("aria-hidden","true"),e.style.cssText="position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;",document.body.appendChild(e),await new Promise(r=>{let s=!1;const c=()=>{s||(s=!0,r())};e.onload=c;const m=e.contentWindow.document;m.open(),m.write(i),m.close(),setTimeout(c,300)});const a=e.contentWindow;await D(a.document,5e3);const d=()=>{e.parentNode&&e.remove()};a.onafterprint=d,setTimeout(d,6e4),await new Promise(r=>setTimeout(r,120)),a.focus(),a.print()}function D(t,o=5e3){const n=Array.from((t==null?void 0:t.images)||[]);if(!n.length)return Promise.resolve();const i=n.map(e=>e.complete&&e.naturalWidth>0?typeof e.decode=="function"?e.decode().catch(()=>{}):Promise.resolve():new Promise(a=>{const d=()=>a();e.addEventListener("load",d,{once:!0}),e.addEventListener("error",d,{once:!0})}));return Promise.race([Promise.all(i),new Promise(e=>setTimeout(e,o))])}function H(t,o){var a;const n=document.createElement("div"),i="tb-export-"+Math.random().toString(36).slice(2,8);n.id=i,n.style.cssText=`position:fixed;left:-99999px;top:0;width:794px;background:${((a=o.swatch)==null?void 0:a.bg)||"#fff"};`;const e=document.createElement("article");return e.className="markdown-body",e.style.cssText="padding:40px 48px;",e.innerHTML=t,n.appendChild(e),n}async function M(t,o){var c;const[n,{default:i},{jsPDF:e}]=await Promise.all([_(o),v("html2canvas",()=>x(()=>import("./html2canvas.esm-QH1iLAAe.js"),[]),{sizeMB:.5}),v("jspdf",()=>x(()=>import("./jspdf.es.min-CxV_pulz.js").then(m=>m.j),__vite__mapDeps([0,1,2])),{sizeMB:.4})]),a=C(o);P(t)&&await T(),/```|~~~/.test(t||"")&&await k().catch(()=>{});const d=E(t||""),r=document.createElement("style"),s=H(d,a);r.textContent=n.replace(/\.markdown-body/g,`#${s.id} .markdown-body`),document.head.appendChild(r),document.body.appendChild(s);try{const m=((c=a.swatch)==null?void 0:c.bg)||"#ffffff",l=await i(s,{scale:2,useCORS:!0,backgroundColor:m,logging:!1}),f=new e("p","px","a4",!0),b=f.internal.pageSize.getWidth(),w=f.internal.pageSize.getHeight(),p=b/l.width,L=Math.max(1,Math.ceil(l.height*p/w));for(let h=0;h<L;h++){h>0&&f.addPage();const y=Math.round(h*w/p),u=Math.min(Math.round(w/p),l.height-y);if(u<=0)break;const g=document.createElement("canvas");g.width=l.width,g.height=u,g.getContext("2d").drawImage(l,0,y,l.width,u,0,0,l.width,u),f.addImage(g.toDataURL("image/jpeg",.94),"JPEG",0,0,b,u*p)}return f}finally{s.remove(),r.remove()}}async function R(t,o,n,i){if(typeof document>"u")return;(await M(t,n)).save(i)}async function B(t,o,n){return typeof document>"u"?null:(await M(t,n)).output("blob")}export{$ as buildThemedHTML,R as imagePdf,B as markdownToPdfBlob,O as printThemed,D as waitForImages};
