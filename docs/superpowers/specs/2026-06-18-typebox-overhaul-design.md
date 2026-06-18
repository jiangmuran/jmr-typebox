# TypeBox 全面改造 · 设计方案 (Design Spec)

- **Date:** 2026-06-18
- **Status:** Draft for review
- **Repo:** https://github.com/jiangmuran/jmr-typebox
- **Owner:** Andy Jiang (@jiangmuran)

---

## 0. 背景与目标

TypeBox 当前是一个 Vue 3 + Vite 的轻量纯前端工具(Markdown 编辑器 + TXT + PDF→MD + 图片处理),无路由、无后端、部分库走 CDN。本次改造把它升级为一个**艺术级 UI、加载极快、功能丰富、SEO 友好、可自定义、带可选开源后端**的格式工具箱。

核心目标:
1. **首页极简、秒开**:初始包只含编辑器外壳,所有大件懒加载。
2. **艺术品级 UI**:克制、精致、好看,不花哨。
3. **每个功能独立 URL + SEO**:逐路由预渲染。
4. **功能扩展**:图片(压缩/转格式/水印)、文档互转(MD↔PDF/DOCX/HTML、PDF→MD)、媒体转码(ffmpeg.wasm)、文本右键插件(Base64 等)。
5. **导出/写作双轨 Typora 主题**,悬停预览。
6. **可选开源后端**(单 CF Worker),仅做 URL 抓取 + 链接预览;全部可一键禁用,每处有「i」说明。
7. **去 CDN**(分析 beacon 除外)、**本地打包一切**。
8. **完善开源**:专业 README、LICENSE、credits、修正链接、CF Web Analytics。

---

## 1. 关键决策(需求澄清结论)

| 主题 | 决策 |
|---|---|
| 托管 | **单个 Cloudflare Worker** 同时托管静态前端(`assets`)+ `/api/*` 后端。一次部署、同源、可加后端功能。 |
| 后端边界 | 仅 **URL 抓取/导入(CORS 代理)** + **链接预览/OG 抓取**。重转换(pdf→epub、docx→png/jpg)预留可插拔端点,默认不实现。媒体转码放前端(ffmpeg.wasm)。 |
| 后端可选性 | 所有后端功能**可选**:后端不可用/未部署/被用户在设置里关闭时,相关入口自动隐藏或置灰,主功能不受影响。 |
| 后端提示 | 每个用到后端的 UI 元素旁有「i」图标 → 弹出说明"此功能需要后端(可选)、后端开源(链接)、可在设置关闭"。 |
| 自定义深度 | **精选设置**(主题/强调色/字体/字号/行高/密度/工具显隐与排序/默认落地工具/导出默认主题/后端总开关)。本地持久化。 |
| Tab 结构 | **5 个顶层 tab**:编辑器 / TXT / 图片 / 转换 / 媒体。TXT 独立保留(快速建 txt,尤其移动端)。 |
| 主题系统 | **写作主题 与 导出主题相互独立**,均可动态切换 + 悬停实时预览 + 轻量缓存。直接搬运 Typora 社区主题(许可证允许),本地打包含字体。 |
| MD→PDF | 默认「打印/存为 PDF」(矢量、文字可选、最高质量,走打印 CSS + `@page` + 选定导出主题);另保留「图片版 PDF」(html2canvas+jspdf 本地)一键栅格化。 |
| 交付 | **分阶段**;实现阶段**并行多个 Agent**,**所有 Agent 必须使用 Opus 模型**。 |
| 分析 | 植入 **Cloudflare Web Analytics** beacon(用户提供 token)。这是唯一有意保留的外部脚本(beacon 本质必须外链),属 no-CDN 规则的明确例外。 |
| SEO | **第一优先级**。逐路由预渲染 + 完整 meta/OG/Twitter/JSON-LD + sitemap.xml + robots.txt + canonical。 |

---

## 2. 总体架构

```
┌──────────────────────── Cloudflare Worker ────────────────────────┐
│  fetch(request):                                                   │
│    if path startsWith /api/  → route to API handlers (optional)    │
│      /api/health   → 后端可用性探测                                  │
│      /api/fetch    → URL 抓取/CORS 代理(图片/文件/markdown)         │
│      /api/preview  → 链接预览 / OG 抓取                             │
│    else → serve static assets from [assets] (dist/), SPA fallback  │
└───────────────────────────────────────────────────────────────────┘
        ▲ 静态资源(预渲染 HTML + JS/CSS chunks)
        │
┌───────┴──────────────── 前端 (Vue 3 + Vite) ──────────────────────┐
│  vue-router (history)  +  vite-ssg (构建期逐路由预渲染)             │
│  @unhead/vue (逐路由 meta/OG/JSON-LD)                              │
│  composables: useSettings / useBackend / useTheme / useConverter   │
│  懒加载: 路由级 code-split + 重库按需 import()                       │
└───────────────────────────────────────────────────────────────────┘
```

- **前端框架**:Vue 3 `<script setup>`(沿用)。
- **路由**:`vue-router` history 模式。
- **预渲染/SEO**:`vite-ssg`(构建期把所有已知路由渲染成静态 HTML);`@unhead/vue` 管理逐路由 `<head>`。
- **状态**:轻量 composables(不引入 Pinia,除非确有跨页共享需求;当前 localStorage + composable 足够)。
- **后端**:同一 Worker;API handlers 在 `worker/` 下;`wrangler.toml` 配置 `[assets]` + 路由。
- **构建**:`vite build` 产出 `dist/` → Worker 以静态资源伺服。
- **测试**:引入 **Vitest + @vue/test-utils**;所有纯函数(转换器、base64、wav 编码、主题缓存、markdown 渲染)单测覆盖。遵循 superpowers TDD。

---

## 3. 目录结构(monorepo)

```
/
├─ index.html                  # 含 CF Web Analytics beacon
├─ vite.config.js              # vite + vue + vite-ssg
├─ wrangler.toml               # 单 Worker:assets + /api 路由
├─ package.json
├─ README.md                   # 专业双语 README
├─ LICENSE                     # MIT
├─ CONTRIBUTING.md
├─ THEMES.md / CREDITS.md      # Typora 主题来源与许可证致谢
├─ public/
│   ├─ favicon.svg             # 黑白自适应 (prefers-color-scheme)
│   ├─ apple-touch-icon.png
│   ├─ robots.txt
│   └─ og/                     # 各功能 OG 图(或构建期生成)
├─ src/
│   ├─ main.js                 # ViteSSG 入口
│   ├─ router/                 # 路由表(驱动 SSG + 导航 + sitemap 生成)
│   ├─ pages/                  # 每个路由一个页面组件(SEO 文案 + H1)
│   ├─ components/             # 复用组件(现有 + 新增)
│   ├─ tools/                  # 各工具实现(image/convert/media/text-plugins)
│   ├─ converters/             # 转换器注册表 + 各转换器(client/backend)
│   ├─ themes/                 # 导出/写作主题(本地 CSS + 字体)
│   ├─ composables/            # useSettings/useBackend/useTheme/...
│   ├─ utils/
│   └─ styles/                 # 设计 tokens + 全局
└─ worker/
    ├─ index.js                # Worker 入口(API + assets fallback)
    └─ api/                    # fetch.js / preview.js / health.js
```

---

## 4. 路由与 SEO

### 4.1 路由表(顶层 5 tab + 子功能,每个独立 URL)

| URL | 功能 | tab |
|---|---|---|
| `/` | Markdown 编辑器(落地页,最简) | 编辑器 |
| `/txt` | 快速 TXT 创建 | TXT |
| `/image/compress` | 图片压缩 | 图片 |
| `/image/convert` | 图片转格式(PNG/JPG/WebP/…) | 图片 |
| `/image/watermark` | 图片加水印 | 图片 |
| `/image/edit` | 图片编辑:涂鸦 / 加字 / 打码(马赛克·模糊) | 图片 |
| `/convert/markdown-to-pdf` | MD→PDF(矢量 + 图片版) | 转换 |
| `/convert/markdown-to-docx` | MD→DOCX | 转换 |
| `/convert/markdown-to-html` | MD→HTML | 转换 |
| `/convert/pdf-to-markdown` | PDF→MD(沿用现引擎) | 转换 |
| `/convert/pdf-to-word` | PDF→Word(DOCX;pdf→md→docx 流水线,后端可升级高保真) | 转换 |
| `/convert/pdf-to-epub` *(预留)* | PDF→EPUB(后端候选) | 转换 |
| `/convert/docx-to-image` *(预留)* | DOCX→PNG/JPG(后端候选) | 转换 |
| `/media/mp3-to-wav` | MP3→WAV(ffmpeg.wasm) | 媒体 |
| `/media/wav-to-mp3` | WAV→MP3 | 媒体 |
| `/media/*` | 其他常见音频互转 | 媒体 |
| `/settings` *(或抽屉)* | 设置/自定义 | — |

- 落地默认:访问 `/` 渲染编辑器;若用户上次停留在其他工具,可选"恢复上次位置"(设置项,默认开,但 `/` 本身始终是干净编辑器以保证 SEO 落地页稳定)。移动端行为沿用现状。

### 4.2 SEO(第一优先级)
- **逐路由预渲染**:vite-ssg 为每个上表路由生成独立静态 HTML。
- **逐路由 head**:唯一 `<title>`、`description`、`canonical`、`og:*`、`twitter:*`、`application/ld+json`(SoftwareApplication / WebApplication)。
- **真实可索引内容**:每个工具页有 `<h1>` + 简短说明段落 + "如何使用"步骤(既助 SEO 也助新用户秒懂)。
- **sitemap.xml**:由路由表构建期生成;`robots.txt` 指向 sitemap。
- **性能即 SEO**:小首屏、预渲染 HTML、`modulepreload` 关键 chunk、系统字体 → 优秀 LCP/CLS。

---

## 5. 设计系统与"艺术级"UI 原则

- **保留并强化**现有 CSS 变量体系(`--text/--bg/--surface/--accent/--border/--shadow-*` 等),整理成清晰 token 层(颜色/间距/圆角/阴影/动效缓动/字阶)。
- **克制美学**:大量留白、清晰层级、统一圆角与阴影、一致的 1 拍动效(`cubic-bezier(0.16,1,0.3,1)`)、单色图标线条统一。不堆渐变、不炫技。
- **强调色可定制**,但默认中性。亮/暗/跟随系统。
- **空状态、加载态、错误态**都精心设计(拖拽区、进度、骨架/spinner、toast)。
- **统一交互范式**:所有工具都支持 **拖拽 / 点击 / 复制粘贴** 三种载入方式。
- 实现期使用 `frontend-design` skill 做视觉打磨,并用真实渲染 + 截图校验。

---

## 6. 图标 / favicon(黑白)

- `favicon.svg` 改为**黑白、自适应系统亮暗**:SVG 内嵌 `@media (prefers-color-scheme: dark)` 切换前景/背景(亮色模式:深底白 T;暗色模式:浅底深 T,或反之),保持现有 "T in rounded square" 标识。
- 配 `apple-touch-icon.png`(单色)。
- 应用内 logo 已是黑白随主题,保持一致。
- 导出 PNG 的水印 footer 图标同步改为黑白(现为紫色渐变)。

---

## 7. 后端模型(可选 + 优雅降级 + 「i」提示)

- **单 Worker** 暴露:
  - `GET /api/health` → `{ ok: true, features: [...] }`,前端探测可用性。
  - `GET /api/fetch?url=` → 服务端抓取远程资源(图片/文件/markdown),解决浏览器 CORS。带域名/大小/超时限制,防滥用。
  - `GET /api/preview?url=` → 抓取目标 OG/title/description/favicon,返回预览卡片数据。
- **`useBackend` composable**:
  - 启动时(或首次需要时)探测 `/api/health`,缓存结果。
  - 暴露 `available`(综合"探测成功" && "用户设置未禁用")。
  - 设置里有**后端总开关**:关 → `available=false`,所有后端入口隐藏/置灰。
- **「i」提示组件 `<BackendInfo>`**:出现在每个后端功能旁,弹出文案(i18n):
  > 此功能需要后端支持(可选)。后端开源:`<repo>/tree/main/worker`。你可以在设置中关闭所有后端功能,不影响其余工具。
- **降级原则**:任何后端调用失败都要 try/catch → toast 友好提示 + 不阻塞其它功能。

---

## 8. 转换引擎抽象(可前/后端、可插拔)

统一注册表 `converters/registry.js`,每个转换器声明:

```js
{
  id: 'markdown-to-docx',
  route: '/convert/markdown-to-docx',
  inputs: ['md', 'txt'],
  output: 'docx',
  where: 'client',            // 'client' | 'backend' | 'auto'
  needsBackend: false,        // 驱动「i」提示
  lazyLoad: () => import('...'),   // 重库按需加载
  run: async (input, opts) => Blob,
}
```

- **客户端转换器**:md→html、md→pdf(矢量 + 图片版)、md→docx(`html-to-docx`)、pdf→md(现引擎本地化)、**pdf→word(pdf→md→docx 流水线)**、图片压缩/转格式/水印/**编辑标注**(Canvas)、音频(ffmpeg.wasm)。
- **后端候选(预留)**:pdf→epub、docx→png/jpg 等重任务,注册为 `where:'backend'`,加 `/api` 端点即生效;未实现时入口标注"即将推出/需后端"。
- 这样新增转换 = 注册一个对象,UI/路由/SEO 由注册表自动驱动。

---

## 9. 功能套件

### 9.1 编辑器(`/`,落地页)
- 沿用现有 Markdown 编辑器(marked + DOMPurify + highlight.js,全部本地)。
- 三视图(编辑/分屏/预览)、工具栏、搜索、Zen、快捷键(沿用)。
- **新增:右键插件菜单**(见 §11)。
- **新增:写作主题**(见 §10)。
- 自动保存(localStorage,沿用),导出(见 §9.6)。

### 9.2 TXT(`/txt`,独立保留)
- 快速创建/编辑纯文本并下载 `.txt`。轻量,移动端友好(可作为移动默认)。沿用 `TxtCreator`,做 UI 一致化。

### 9.3 图片(`/image/*`)
拖拽/点击/粘贴载入,子工具决定操作:
- **压缩** `/image/compress`:质量滑杆 + 最大宽/目标尺寸,显示前后大小对比,批量。
- **转格式** `/image/convert`:PNG/JPG/WebP(AVIF 视浏览器支持),批量下载/打包。
- **水印** `/image/watermark`:文字/图片水印,位置九宫格、透明度、旋转、平铺,Canvas 合成预览后下载。
- **编辑/标注** `/image/edit`:Canvas 图像标注器——**涂鸦**(自由画笔,颜色/粗细)、**加字**(可拖拽文本框,字体/字号/颜色)、**打码**(框选区域马赛克或高斯模糊,遮挡敏感信息);支持撤销/重做,导出下载。
- 全部 Canvas 本地完成,无后端。可选"从 URL 导入图片"= 后端功能(带「i」)。

### 9.4 转换(`/convert/*`)
- MD→PDF(§9.6)、MD→DOCX、MD→HTML、PDF→MD;**PDF→Word(DOCX)**;预留 pdf→epub、docx→png/jpg(后端候选)。
- **PDF→Word**:客户端流水线复用「PDF→MD 布局引擎」+「MD→DOCX」,得到可编辑 .docx(文本/标题/列表/表格尽力还原);高保真版列为后端候选(LibreOffice/服务端)。
- 导出主题选择(§10),与写作主题独立。

### 9.5 媒体(`/media/*`)
- **ffmpeg.wasm** 本地转码:MP3↔WAV↔OGG/AAC 等常见音频互转。
- 懒加载 ffmpeg.wasm(≈30MB)+ 进度条 + **首次下载体积提示**("首次使用需下载约 30MB 转码核心,之后浏览器缓存")。
- 同架构后续可接视频转码。

### 9.6 导出(编辑器/转换共用)
- **MD→PDF**:
  - 主路径「打印/存为 PDF」:用隐藏 iframe + 选定**导出主题** CSS + `@page` 打印样式 → `window.print()`,矢量、文字可选、质量最高(会弹系统打印框)。
  - 备路径「图片版 PDF」:html2canvas + jspdf(本地)一键栅格化下载。
- MD→HTML:独立 HTML(内联选定导出主题)。
- MD→PNG:html2canvas(本地)+ 黑白品牌 footer。
- MD→DOCX:`html-to-docx`(本地)。
- 复制 HTML / 复制 Markdown(沿用)。
- **导出对话框**:主题选择器 + **悬停预览**(动态渲染文档首页为该主题)。

---

## 10. 主题系统(写作 + 导出双轨)

### 10.1 双轨独立
- **写作主题(editor theme)**:影响编辑器内书写/预览区观感。
- **导出主题(export theme)**:影响 PDF/HTML/PNG 导出产物。
- 两者**各自独立选择与持久化**,可不同。

### 10.2 Typora 主题搬运(本地打包)
直接采用 Typora 社区主题(许可证允许;实现时逐个核实并在 CREDITS/README 致谢):

| 主题 | 备注 |
|---|---|
| Nocturne | 暗色 |
| Johntor Dark Blue | 暗蓝(单一主题名) |
| Inkwell | — |
| Lightmind | — |
| Ivory Flow | — |
| **Phycat**(`sumruler/typora-theme-phycat`,MIT) | **二级子菜单**:Phycat-color 8 色(樱桃红/焦糖橙/森绿/薄荷青/天蓝/普鲁士蓝/樱花粉/淡紫)+ Phycat-neon(暗) |

- 主题 CSS + 其引用字体**全部下载到本地**(无 CDN);超大字体可懒加载(选中/预览该主题时才取)。
- 实现注意:Typora 主题面向 `#write` 容器;需把选择器适配到本应用的预览/导出容器(scoping/前缀),并隔离避免污染应用 UI(用 iframe 或 scoped 根类)。

### 10.3 悬停预览 + 缓存
- 主题菜单项**悬停**即在预览/导出区动态套用该主题渲染(首屏/首页),移开恢复。
- **轻量缓存**:已加载的主题 CSS 与渲染结果做内存(+ 可选 localStorage)缓存,使悬停预览与切换**瞬时**,不重复抓取/重渲染。
- 顶栏与设置都能切换写作主题;导出对话框切换导出主题。

---

## 11. 编辑器右键插件系统(文本插件 = 右键菜单)

- 在编辑器内自定义 **右键上下文菜单**,作用于**选区**(无选区则全文),结果替换选区或复制到剪贴板。
- 插件注册表(可扩展),首批:
  - **Base64 编码 / 解码**
  - URL 编码 / 解码
  - HTML 实体 编码 / 解码
  - 大小写:UPPER / lower / Title / Sentence
  - JSON:格式化 / 压缩
  - 行操作:排序 / 去重 / 反转
  - 哈希:SHA-256(SubtleCrypto)
  - 字数/字符统计
- 纯前端、纯函数实现,单测覆盖。

---

## 12. 自定义 / 设置(精选)

`useSettings` + 设置面板(gear/`/settings`),本地持久化(`tb-` 前缀):
- 主题:亮 / 暗 / 跟随系统
- 强调色(预设 + 自定义)
- 写作主题、导出默认主题
- 编辑器字体族 / 字号 / 行高
- 界面密度:舒适 / 紧凑
- **显示哪些工具 + 顺序**(tab 自定义)
- 默认落地工具 / 是否恢复上次位置
- **后端功能总开关**
- 语言(zh/en,沿用)
- 危险区:清空所有本地数据(整合现有功能)

---

## 13. 性能与懒加载

- **初始包最小化**:仅编辑器外壳进首屏 bundle。
- **路由级 code-split**:每个工具页 `defineAsyncComponent` / 动态 import。
- **重库一律按需 `import()`**:`ffmpeg.wasm`、`pdf.js`、`html-to-docx`、`lamejs`、`html2canvas`、`jspdf`、各大字体/主题 — 首次用到才加载,加载时给进度/体积提示,加载后缓存。
- **去 CDN**:上述库改为本地 npm 依赖打包(分析 beacon 除外)。
- 字体走系统字体栈(沿用),不引 web 字体 CDN;主题自带字体本地化。
- `modulepreload` 关键 chunk;SSG 静态首屏;图片懒加载;`URL.revokeObjectURL` 释放。
- 目标:主页面在常见网络下**极短时间可交互**。

---

## 14. 新手引导(拓展)

- 把现有 `WelcomeDialog` 扩成简短、可跳过、可重看的引导:
  - **这是什么**:本地优先、隐私、离线可用的格式工具箱。
  - **能搬哪些日常工作流**:写作→多格式导出;压图/转格式/加水印;音频转换;PDF↔MD;文本快捷处理(右键插件)。
  - **如何开始**:拖拽 / 点击 / 粘贴。
  - 引导后落到干净编辑器。

---

## 15. 分析(Cloudflare Web Analytics)

- 在 `index.html` 植入用户提供的 beacon(唯一有意外链脚本):
```html
<!-- Cloudflare Web Analytics -->
<script defer src='https://static.cloudflareinsights.com/beacon.min.js'
  data-cf-beacon='{"token": "212b43858f8a4b9c8cf9f1f6c060f413"}'></script>
<!-- End Cloudflare Web Analytics -->
```
- 隐私友好(无 cookie),与"本地优先/隐私"定位不冲突;README 注明使用了隐私分析。

---

## 16. 开源就绪

- **修正所有链接**:代码内 `github.com/jmr/typebox` → `github.com/jiangmuran/jmr-typebox`(App.vue about、export.js footer 等)。
- **专业 README.md**(双语):
  - Hero(标识 + 一句话定位 + 在线地址 + badges)
  - 特性总览(按 5 tab + 右键插件 + 主题 + 离线/隐私)
  - 截图/GIF
  - 快速开始 / 自托管(`npm` + `wrangler` 部署单 Worker)
  - 架构说明(前端 + 可选后端)
  - 后端说明(可选、开源、如何启用/禁用)
  - 主题 credits(Typora 主题来源 + 许可证)
  - 隐私/分析说明
  - Contributing / License(MIT)
- **LICENSE**(MIT)、**CONTRIBUTING.md**、**CREDITS/THEMES.md**。
- 确认仓库公开。

---

## 17. 移动端

- 沿用现状响应式行为(顶栏紧凑、视图切换、TXT 友好);所有**新工具**适配窄屏(图片/转换/媒体/设置/右键插件在移动端有可用替代交互,如长按代替右键)。

---

## 18. 测试策略

- 引入 **Vitest + @vue/test-utils**(项目当前无测试)。
- **TDD**(superpowers):每个纯逻辑单元先写测试——
  - 右键插件(base64/url/case/json/lines/hash)
  - 转换器(wav 编码、markdown 渲染、文件名/MIME 处理、主题缓存)
  - `useSettings`/`useBackend` 的纯逻辑(降级/开关)
- 组件级:关键交互(tab 切换、主题悬停预览、拖拽载入)做轻量组件测试。
- 可选 E2E(Playwright)冒烟:路由可达 + 预渲染 head 正确。
- 每阶段完成用 `verification-before-completion` + `requesting-code-review`。

---

## 19. 分阶段实施 + 并行 Agent 计划(全部 Opus)

> 所有实现 Agent **必须使用 Opus 模型**。每阶段产出由 writing-plans 生成的独立实现计划驱动。

### 阶段 0 — 地基(先串行落地,定契约)
设定后续所有阶段依赖的契约,**必须先完成**:
- 引入 vue-router + vite-ssg + @unhead/vue;重构 `main.js`/入口;建立 `router/` + `pages/` 骨架。
- 设计 tokens / 全局样式整理;**黑白自适应 favicon**;修正所有链接;README/LICENSE/CREDITS 初版;CF Web Analytics 植入。
- `wrangler.toml` + `worker/` 骨架(assets + `/api/health` 占位),本地 `wrangler dev` 跑通。
- `useSettings`(精选设置 + 持久化)+ 设置面板;`useBackend`(探测/总开关/降级)+ `<BackendInfo>`「i」组件。
- 懒加载基础设施(路由 code-split + 重库按需加载器 + 加载/体积提示 UX)。
- **转换器注册表** + 「i」提示接线。
- 扩展新手引导。
- 引入 Vitest;迁移现有 CDN 库为本地依赖(pdf.js/html2canvas/jspdf)。

### 阶段 1 — 并行(各开一个 Opus Agent;依赖阶段 0 契约)
- **Agent A — 图片套件**:`/image/compress|convert|watermark|edit`(编辑 = 涂鸦/加字/打码)+ 三方式载入 + SEO 页。
- **Agent B — 转换套件 + 主题**:MD→PDF(矢量+图片版)、MD→DOCX、MD→HTML、PDF→MD、**PDF→Word** 本地化;**双轨 Typora 主题系统**(本地打包 + 悬停预览 + 缓存)+ 导出对话框预览;SEO 页。
- **Agent C — 媒体套件**:ffmpeg.wasm 音频互转 + 懒加载/体积提示 + SEO 页。
- **Agent D — 右键插件系统**:上下文菜单 + 首批插件 + 单测 + 编辑器写作主题接线。
- **Agent E — 后端**:`/api/fetch`(CORS 代理)+ `/api/preview`(OG)+ 前端"从 URL 导入"接线 + 「i」提示 + 降级。
- **Agent F — 艺术级 UI 打磨**:在 A–E 落地后做整合性视觉/交互终审(frontend-design + 截图校验)。建议作为收尾串行步骤而非并行。

依赖说明:A–E 均依赖阶段 0 的 router / 注册表 / useSettings / useBackend / 懒加载基础设施;彼此基本独立可并行(注意 B 与导出对话框、D 与编辑器有少量交叉,用清晰接口隔离)。各 Agent 在隔离 worktree 工作以避免冲突。

---

## 20. 风险与注意事项

- **vite-ssg 改造**:引入 router + SSG 是结构性改动;阶段 0 要先跑通最小路由的预渲染再铺开。
- **Typora 主题选择器隔离**:主题面向 `#write`,需 scoping,避免污染应用 UI(优先 iframe 渲染导出/预览)。
- **Typora 主题许可证**:逐个核实(多为 MIT),不合规者剔除;README 致谢。
- **ffmpeg.wasm 体积/COOP-COEP**:多线程版需要跨源隔离响应头(Worker 可设);先用单线程版规避,或在 Worker 配 `Cross-Origin-Opener/Embedder-Policy`。
- **MD→PDF 矢量路径**会弹系统打印框(无法纯静默另存);已用"图片版"作一键备路径。
- **后端滥用防护**:`/api/fetch` 必须限制协议/域/大小/超时,避免成为开放代理。
- **打印/分屏/移动端**多场景回归。

---

## 21. 待确认(实现中可再定)

- 是否需要"分享/短链"(本次未纳入后端;如需另开端点 + 存储)。
- 设置是导出为独立 `/settings` 页还是抽屉(默认抽屉,`/settings` 作为可选可索引页)。
- 视频转码纳入时机(架构已预留)。
