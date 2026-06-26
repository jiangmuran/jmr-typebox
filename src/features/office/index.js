// Office suite feature module — opens Excel (.xlsx) and PowerPoint (.pptx) files with an in-browser
// preview (+ light spreadsheet editing & re-download). Drop-in, glob-discovered by
// src/features/index.js: `components` overrides the /office route's ToolStub, `i18n` is merged into
// useI18n. Route SEO meta lives in src/router/meta.js.
//
// This file MUST stay light / side-effect-free at import: only the export object + a lazy component
// thunk. The heavy libs (SheetJS, JSZip) are dynamically imported inside the runners at call time,
// so they're code-split out of the home-page bundle and never run during SSG prerender.

export default {
  components: {
    '/office': () => import('./OfficeViewer.vue'),
  },

  i18n: {
    en: {
      'office.title': 'Spreadsheet & Slides Viewer',
      'office.sub': 'Open an Excel (.xlsx) or PowerPoint (.pptx) file to preview it — edit and re-download spreadsheets. Fully private, nothing is uploaded.',
      'office.dropTitle': 'Drop a spreadsheet or slides here',
      'office.dropHint': 'Click or drop · .xlsx, .xls, .csv, .pptx',
      'office.parsing': 'Opening file…',
      'office.building': 'Building .xlsx…',
      'office.parseFailed': 'Could not open this file — it may be corrupt or unsupported.',
      'office.exportFailed': 'Download failed',
      'office.downloaded': 'Downloaded',
      'office.unsupported': 'Unsupported file — pick an .xlsx or .pptx file',
      'office.openAnother': 'Open another',
      'office.downloadXlsx': 'Download .xlsx',
      'office.sheet': 'sheet',
      'office.sheets': 'sheets',
      'office.slide': 'Slide',
      'office.slides': 'Slides',
      'office.image': 'Image',
      'office.previewOnly': 'Preview only',
      'office.prev': 'Previous slide',
      'office.next': 'Next slide',
      'office.textFallback': 'Text preview',
      'office.emptySlide': '(This slide has no text)',
      'office.editHint': 'Click any cell to edit. Download to save your changes as a new .xlsx.',
      'office.showingRows': 'Large sheet — showing the first {n} of {m} rows.',
      'office.cap.xlsxTitle': 'Excel spreadsheets',
      'office.cap.xlsxDesc': 'Browse every sheet, edit cells inline, and download as .xlsx.',
      'office.cap.pptxTitle': 'PowerPoint slides',
      'office.cap.pptxDesc': 'Preview slides with thumbnails and navigation. Preview only.',
      'office.privacy': 'Files are parsed in your browser — nothing is uploaded.',
    },
    zh: {
      'office.title': '表格与幻灯片预览',
      'office.sub': '打开 Excel(.xlsx)或 PowerPoint(.pptx)文件进行预览 —— 表格可编辑并重新下载。全程本地处理,绝不上传。',
      'office.dropTitle': '拖入表格或幻灯片',
      'office.dropHint': '点击或拖入 · .xlsx、.xls、.csv、.pptx',
      'office.parsing': '正在打开文件…',
      'office.building': '正在生成 .xlsx…',
      'office.parseFailed': '无法打开此文件 —— 可能已损坏或不受支持。',
      'office.exportFailed': '下载失败',
      'office.downloaded': '已下载',
      'office.unsupported': '不支持的文件 —— 请选择 .xlsx 或 .pptx 文件',
      'office.openAnother': '打开其他文件',
      'office.downloadXlsx': '下载 .xlsx',
      'office.sheet': '个工作表',
      'office.sheets': '个工作表',
      'office.slide': '幻灯片',
      'office.slides': '幻灯片',
      'office.image': '图片',
      'office.previewOnly': '仅预览',
      'office.prev': '上一张',
      'office.next': '下一张',
      'office.textFallback': '文字预览',
      'office.emptySlide': '(此幻灯片无文字)',
      'office.editHint': '点击任意单元格即可编辑。下载即可将修改保存为新的 .xlsx 文件。',
      'office.showingRows': '工作表较大 —— 仅显示前 {n} 行(共 {m} 行)。',
      'office.cap.xlsxTitle': 'Excel 表格',
      'office.cap.xlsxDesc': '浏览每个工作表,在格内直接编辑,并下载为 .xlsx。',
      'office.cap.pptxTitle': 'PowerPoint 幻灯片',
      'office.cap.pptxDesc': '通过缩略图和导航预览幻灯片。仅支持预览。',
      'office.privacy': '文件在你的浏览器中解析 —— 绝不上传。',
    },
  },
}
