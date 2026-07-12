const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/jspdf.es.min-DHCnkq5Y.js","assets/app-DsrcemEt.js","assets/app-FvBQn0yF.css"])))=>i.map(i=>d[i]);
import{_ as x}from"./app-DsrcemEt.js";import{r as T}from"./markdown-A_QFduJc.js";import{g as v,a as P}from"./registry-BaM4ESzq.js";import{l as k}from"./loadLibrary-DjA8EnkS.js";import"./_commonjsHelpers-Cpj98o6Y.js";const C=`
@page { size: A4; margin: 18mm 16mm; }
html, body { margin: 0; padding: 0; }
body { padding: 0; }
.markdown-body { padding: 0; max-width: 100%; }
.markdown-body pre, .markdown-body table, .markdown-body img, .markdown-body blockquote { break-inside: avoid; }
.markdown-body h1, .markdown-body h2, .markdown-body h3 { break-after: avoid; }
@media screen { body { max-width: 820px; margin: 0 auto; padding: 32px 24px; } }
`;async function M(n,a,e,{includePrintCss:i=!1}={}){var m;const t=await v(e),o=P(e),c=T(n||""),d=String(a||"Document").replace(/[<>&]/g,""),r=((m=o.swatch)==null?void 0:m.bg)||"#ffffff";return`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${d}</title>
<style>
html { background: ${r}; }
body { margin: 0; }
${t}
${i?C:"body{max-width:820px;margin:40px auto;padding:0 24px;}"}
</style>
</head>
<body><article class="markdown-body">${c}</article></body>
</html>`}async function R(n,a,e){if(typeof document>"u")return;const i=await M(n,a,e,{includePrintCss:!0}),t=document.createElement("iframe");t.setAttribute("aria-hidden","true"),t.style.cssText="position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;",document.body.appendChild(t),await new Promise(d=>{t.onload=()=>d();const r=t.contentWindow.document;r.open(),r.write(i),r.close(),setTimeout(d,300)});const o=t.contentWindow,c=()=>{t.parentNode&&t.remove()};o.onafterprint=c,setTimeout(c,6e4),await new Promise(d=>setTimeout(d,120)),o.focus(),o.print()}function S(n,a){var o;const e=document.createElement("div"),i="tb-export-"+Math.random().toString(36).slice(2,8);e.id=i,e.style.cssText=`position:fixed;left:-99999px;top:0;width:794px;background:${((o=a.swatch)==null?void 0:o.bg)||"#fff"};`;const t=document.createElement("article");return t.className="markdown-body",t.style.cssText="padding:40px 48px;",t.innerHTML=n,e.appendChild(t),e}async function _(n,a){var m;const[e,{default:i},{jsPDF:t}]=await Promise.all([v(a),k("html2canvas",()=>x(()=>import("./html2canvas.esm-QH1iLAAe.js"),[]),{sizeMB:.5}),k("jspdf",()=>x(()=>import("./jspdf.es.min-DHCnkq5Y.js").then(g=>g.j),__vite__mapDeps([0,1,2])),{sizeMB:.4})]),o=P(a),c=T(n||""),d=document.createElement("style"),r=S(c,o);d.textContent=e.replace(/\.markdown-body/g,`#${r.id} .markdown-body`),document.head.appendChild(d),document.body.appendChild(r);try{const g=((m=o.swatch)==null?void 0:m.bg)||"#ffffff",s=await i(r,{scale:2,useCORS:!0,backgroundColor:g,logging:!1}),l=new t("p","px","a4",!0),b=l.internal.pageSize.getWidth(),w=l.internal.pageSize.getHeight(),f=b/s.width,E=Math.max(1,Math.ceil(s.height*f/w));for(let h=0;h<E;h++){h>0&&l.addPage();const y=Math.round(h*w/f),p=Math.min(Math.round(w/f),s.height-y);if(p<=0)break;const u=document.createElement("canvas");u.width=s.width,u.height=p,u.getContext("2d").drawImage(s,0,y,s.width,p,0,0,s.width,p),l.addImage(u.toDataURL("image/jpeg",.94),"JPEG",0,0,b,p*f)}return l}finally{r.remove(),d.remove()}}async function j(n,a,e,i){if(typeof document>"u")return;(await _(n,e)).save(i)}async function A(n,a,e){return typeof document>"u"?null:(await _(n,e)).output("blob")}export{M as buildThemedHTML,j as imagePdf,A as markdownToPdfBlob,R as printThemed};
