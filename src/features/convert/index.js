// Convert suite — Markdown ↔ PDF / DOCX / HTML and PDF → Word, plus export themes.
//
// Drop-in feature module (see src/features/index.js contract): `components`
// override ToolStub for these routes, `i18n` strings merge into useI18n, and
// `register()` wires converters into the registry for the ⌘K palette / programmatic
// conversion.
//
// This file MUST stay light + side-effect-free at import: no window/document/Blob
// access here, and it MUST NOT import useI18n (circular). All heavy work
// (turbodocx, html2canvas, jspdf, pdf.js) is lazy-loaded inside each run().
import { registerConverter } from '../../converters/registry'

export default {
  components: {
    '/convert/markdown-to-pdf': () => import('./MarkdownToPdfPage.vue'),
    '/convert/markdown-to-docx': () => import('./MarkdownToDocxPage.vue'),
    '/convert/markdown-to-html': () => import('./MarkdownToHtmlPage.vue'),
    '/convert/pdf-to-word': () => import('./PdfToWordPage.vue'),
  },

  i18n: {
    en: {
      'convert.input': 'Input',
      'convert.placeholder': 'Paste or write Markdown here, or drop a .md / .txt file…',
      'convert.openFile': 'Open file',
      'convert.dropHere': 'Drop your .md or .txt file',
      'convert.theme': 'Export theme',
      'convert.preview': 'Live preview',
      'convert.loadingLib': 'Preparing converter…',

      'convert.mdToPdf.title': 'Markdown to PDF',
      'convert.mdToPdf.sub': 'Export a polished PDF with selectable text. Pick a theme, then print or save.',
      'convert.mdToPdf.print': 'Print / Save as PDF',
      'convert.mdToPdf.image': 'Image PDF',
      'convert.mdToPdf.note': 'Print / Save as PDF keeps text selectable and crisp (best quality). Image PDF rasterizes the page — handy when exact on-screen styling matters more than selectable text.',

      'convert.mdToDocx.title': 'Markdown to Word',
      'convert.mdToDocx.sub': 'Convert Markdown to an editable Word .docx — headings, lists, tables and code preserved.',
      'convert.mdToDocx.download': 'Download .docx',
      'convert.mdToDocx.working': 'Building document…',
      'convert.mdToDocx.note': 'Word renders the document with its own styles, so export themes don’t apply to .docx — the output uses a clean, Office-friendly layout.',

      'convert.mdToHtml.title': 'Markdown to HTML',
      'convert.mdToHtml.sub': 'Produce a standalone .html file with your chosen theme inlined — no external assets.',
      'convert.mdToHtml.download': 'Download .html',
      'convert.mdToHtml.copy': 'Copy HTML',
      'convert.mdToHtml.copied': 'HTML copied to clipboard',

      'convert.pdfToWord.title': 'PDF to Word',
      'convert.pdfToWord.sub': 'Extract a PDF to Markdown, review it, then export an editable Word .docx.',
      'convert.pdfToWord.drop': 'Drop a PDF here',
      'convert.pdfToWord.review': 'Extracted Markdown (editable)',
      'convert.pdfToWord.download': 'Download .docx',
      'convert.pdfToWord.note': 'Extraction is heuristic — review the Markdown above before exporting. Everything runs locally; nothing is uploaded.',
    },
    zh: {
      'convert.input': '输入',
      'convert.placeholder': '在此粘贴或编写 Markdown，或拖入 .md / .txt 文件…',
      'convert.openFile': '打开文件',
      'convert.dropHere': '拖入 .md 或 .txt 文件',
      'convert.theme': '导出主题',
      'convert.preview': '实时预览',
      'convert.loadingLib': '正在准备转换器…',

      'convert.mdToPdf.title': 'Markdown 转 PDF',
      'convert.mdToPdf.sub': '导出文字可选中的精美 PDF。选择主题后打印或保存。',
      'convert.mdToPdf.print': '打印 / 保存为 PDF',
      'convert.mdToPdf.image': '图片 PDF',
      'convert.mdToPdf.note': '“打印 / 保存为 PDF” 文字可选中且清晰（质量最佳）。“图片 PDF” 将页面栅格化——当需要完全还原屏幕样式、而非可选中文字时更合适。',

      'convert.mdToDocx.title': 'Markdown 转 Word',
      'convert.mdToDocx.sub': '将 Markdown 转换为可编辑的 Word .docx——保留标题、列表、表格与代码。',
      'convert.mdToDocx.download': '下载 .docx',
      'convert.mdToDocx.working': '正在生成文档…',
      'convert.mdToDocx.note': 'Word 会用自身样式渲染文档，因此导出主题不适用于 .docx——输出采用干净、适配 Office 的排版。',

      'convert.mdToHtml.title': 'Markdown 转 HTML',
      'convert.mdToHtml.sub': '生成内联所选主题的独立 .html 文件——不依赖任何外部资源。',
      'convert.mdToHtml.download': '下载 .html',
      'convert.mdToHtml.copy': '复制 HTML',
      'convert.mdToHtml.copied': 'HTML 已复制到剪贴板',

      'convert.pdfToWord.title': 'PDF 转 Word',
      'convert.pdfToWord.sub': '将 PDF 提取为 Markdown，检查后导出为可编辑的 Word .docx。',
      'convert.pdfToWord.drop': '拖入 PDF 文件',
      'convert.pdfToWord.review': '提取的 Markdown（可编辑）',
      'convert.pdfToWord.download': '下载 .docx',
      'convert.pdfToWord.note': '提取基于启发式算法——导出前请检查上方的 Markdown。全部在本地处理，绝不上传。',
    },
  },

  register() {
    // Markdown -> PDF (image-based; the print path is UI-only). Returns a Blob.
    registerConverter({
      id: 'markdown-to-pdf',
      route: '/convert/markdown-to-pdf',
      inputs: ['markdown'],
      output: 'pdf',
      where: 'client',
      needsBackend: false,
      run: async (input, opts = {}) => {
        const { markdownToPdfBlob } = await import('./utils/renderFrame.js')
        return markdownToPdfBlob(input, opts.title || 'Document', opts.theme || 'github')
      },
    })

    // Markdown -> DOCX. Returns a Blob.
    registerConverter({
      id: 'markdown-to-docx',
      route: '/convert/markdown-to-docx',
      inputs: ['markdown'],
      output: 'docx',
      where: 'client',
      needsBackend: false,
      run: async (input, opts = {}) => {
        const { markdownToDocxBlob } = await import('./utils/docx.js')
        return markdownToDocxBlob(input, opts.title || 'Document')
      },
    })

    // Markdown -> standalone HTML (theme inlined). Returns a string.
    registerConverter({
      id: 'markdown-to-html',
      route: '/convert/markdown-to-html',
      inputs: ['markdown'],
      output: 'html',
      where: 'client',
      needsBackend: false,
      run: async (input, opts = {}) => {
        const { buildThemedHTML } = await import('./utils/renderFrame.js')
        return buildThemedHTML(input, opts.title || 'Document', opts.theme || 'github')
      },
    })

    // PDF -> Word: pdf.js extraction -> markdown -> docx. Input is a File. Returns a Blob.
    registerConverter({
      id: 'pdf-to-word',
      route: '/convert/pdf-to-word',
      inputs: ['pdf'],
      output: 'docx',
      where: 'client',
      needsBackend: false,
      run: async (input, opts = {}) => {
        const [{ pdfToMarkdown }, { markdownToDocxBlob }] = await Promise.all([
          import('../../utils/pdfToMarkdown.js'),
          import('./utils/docx.js'),
        ])
        const { markdown } = await pdfToMarkdown(input, opts.onProgress)
        return markdownToDocxBlob(markdown, opts.title || 'Document')
      },
    })
  },
}
