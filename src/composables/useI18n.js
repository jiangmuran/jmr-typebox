import { ref, computed } from 'vue'
import { load, save } from '../utils/storage'

const browserZh = typeof navigator !== 'undefined' && navigator.language?.startsWith('zh')
const locale = ref(load('lang', browserZh ? 'zh' : 'en'))

const dict = {
  en: {
    // Tabs
    'tab.markdown': 'Markdown',
    'tab.txt': 'TXT',
    'tab.pdf': 'PDF',
    'tab.image': 'Image',
    'tab.convert': 'Convert',
    'tab.media': 'Media',
    'tab.tools': 'Tools',
    'tab.python': 'Python',

    // Top bar
    'file.placeholder': 'untitled',

    // View
    'view.editor': 'Editor',
    'view.split': 'Split',
    'view.preview': 'Preview',

    // Export menu
    'export': 'Export',
    'export.download': 'Download',
    'export.txt': 'Plain Text (.txt)',
    'export.md': 'Markdown (.md)',
    'export.html': 'HTML (.html)',
    'export.section': 'Export',
    'export.pdf': 'PDF Document',
    'export.png': 'Image (PNG)',
    'export.clipboard': 'Clipboard',
    'export.copyHtml': 'Copy as HTML',
    'export.copyMd': 'Copy Markdown',

    // Menu
    'menu.new': 'New Document',
    'menu.open': 'Open File...',
    'menu.openHint': '.txt .md .pdf',
    'menu.find': 'Find & Replace',
    'menu.zen': 'Zen Mode',
    'menu.print': 'Print',
    'menu.clearAll': 'Clear All Data',
    'menu.clearAllConfirm': 'Clear all saved data? This will reset everything to default.',
    'menu.clearAllDone': 'All data cleared',
    'menu.about.title': 'TypeBox',
    'menu.about.desc': 'Open-source format tools',
    'menu.about.privacy': 'Files never leave your browser.',

    // Settings
    'settings.title': 'Settings',
    'settings.open': 'Settings',
    'settings.appearance': 'Appearance',
    'settings.theme': 'Theme',
    'settings.theme.light': 'Light',
    'settings.theme.dark': 'Dark',
    'settings.theme.system': 'System',
    'settings.accent': 'Accent color',
    'settings.accent.default': 'Default',
    'settings.density': 'Density',
    'settings.density.comfortable': 'Comfortable',
    'settings.density.compact': 'Compact',
    'settings.editor': 'Editor',
    'settings.fontSize': 'Font size',
    'settings.lineHeight': 'Line height',
    'settings.tools': 'Visible tools',
    'settings.behavior': 'Behavior',
    'settings.defaultTool': 'Default tool',
    'settings.restoreLast': 'Restore last position',
    'settings.backend': 'Backend',
    'settings.backendEnabled': 'Enable backend features',
    'settings.language': 'Language',
    'settings.danger': 'Danger zone',
    'settings.reset': 'Reset settings',
    'backend.notice': 'This feature needs the optional backend. It is open source and can be turned off in Settings.',
    'backend.viewSource': 'View backend source',

    // Editor
    'editor.placeholder': 'Start writing Markdown here...',

    // Status
    'status.saved': 'Saved',
    'status.editing': 'Editing',
    'status.chars': 'chars',
    'status.words': 'words',
    'status.line': 'line',
    'status.lines': 'lines',
    'status.minRead': 'min read',

    // TXT Creator
    'txt.filename': 'Filename',
    'txt.placeholder': 'Start typing or paste your text here...\n\nYou can also drag & drop a .txt file.',
    'txt.download': 'Download .txt',
    'txt.copy': 'Copy',
    'txt.clear': 'Clear',

    // PDF Tools
    'pdf.drop': 'Drop a PDF file here',
    'pdf.browse': 'or click to browse',
    'pdf.hint': 'Extract text from PDF — processed locally',
    'pdf.extracting': 'Extracting text from',
    'pdf.change': 'Change file',
    'pdf.copyText': 'Copy Text',
    'pdf.downloadTxt': 'Download .txt',
    'pdf.downloadMd': 'Download .md',

    // Image Tools
    'img.drop': 'Drop an image here',
    'img.browse': 'or click to browse · PNG, JPG, WebP, GIF',
    'img.format': 'Output Format',
    'img.quality': 'Quality',
    'img.maxWidth': 'Max Width (0 = original)',
    'img.download': 'Download',
    'img.base64': 'Base64',
    'img.change': 'Change',

    // Drag
    'drag.hint': 'Drop any file — .txt .md .pdf or image',

    // Toasts
    'toast.newDoc': 'New document',
    'toast.loaded': 'Loaded',
    'toast.downloaded': 'Downloaded',
    'toast.pdfExtracted': 'pages extracted from PDF',
    'toast.pdfFailed': 'Failed to extract PDF text',
    'toast.exportFailed': 'Export failed',
    'toast.genPdf': 'Generating PDF...',
    'toast.genImg': 'Generating image...',
    'toast.pdfDone': 'PDF exported',
    'toast.pngDone': 'Image exported',
    'toast.htmlCopied': 'HTML copied',
    'toast.mdCopied': 'Markdown copied',
    'toast.copied': 'Copied to clipboard',
    'toast.zenHint': 'Zen mode — Esc to exit',
    'toast.startFresh': 'Start fresh? Current content will be cleared.',

    // Branding (for image export)
    'brand.watermark': 'Made with TypeBox · github.com/jiangmuran/jmr-typebox',

    // Welcome dialog
    'welcome.title': 'TypeBox',
    'welcome.chooseLang': 'Choose your language',
    'welcome.feat.markdown': 'Markdown Editor',
    'welcome.feat.markdownDesc': 'Live preview · Export PDF / HTML / PNG',
    'welcome.feat.txt': 'TXT Creator',
    'welcome.feat.txtDesc': 'One-click plain text files',
    'welcome.feat.pdf': 'PDF → Markdown',
    'welcome.feat.pdfDesc': 'Smart layout analysis',
    'welcome.feat.image': 'Image Tools',
    'welcome.feat.imageDesc': 'Compress · Convert · Base64',
    'welcome.privacy': '100% local & private · Open source',
    'welcome.start': 'Get Started',
    'welcome.loadedToEditor': 'Loaded into editor',

    // PDF tools
    'pdf.openInEditor': 'Open in Editor',
    'pdf.pages': 'pages',
  },

  zh: {
    'tab.markdown': 'Markdown',
    'tab.txt': 'TXT',
    'tab.pdf': 'PDF',
    'tab.image': '图片',
    'tab.convert': '转换',
    'tab.media': '媒体',
    'tab.tools': '工具箱',
    'tab.python': 'Python',

    'file.placeholder': '未命名',

    'view.editor': '编辑',
    'view.split': '分栏',
    'view.preview': '预览',

    'export': '导出',
    'export.download': '下载',
    'export.txt': '纯文本 (.txt)',
    'export.md': 'Markdown (.md)',
    'export.html': 'HTML (.html)',
    'export.section': '导出',
    'export.pdf': 'PDF 文档',
    'export.png': '图片 (PNG)',
    'export.clipboard': '剪贴板',
    'export.copyHtml': '复制为 HTML',
    'export.copyMd': '复制 Markdown',

    'menu.new': '新建文档',
    'menu.open': '打开文件...',
    'menu.openHint': '.txt .md .pdf',
    'menu.find': '查找与替换',
    'menu.zen': '专注模式',
    'menu.print': '打印',
    'menu.clearAll': '清除所有数据',
    'menu.clearAllConfirm': '确认清除所有保存的数据？将恢复到默认状态。',
    'menu.clearAllDone': '所有数据已清除',
    'menu.about.title': 'TypeBox',
    'menu.about.desc': '开源格式工具箱',
    'menu.about.privacy': '文件始终在本地处理，绝不上传。',

    // Settings
    'settings.title': '设置',
    'settings.open': '设置',
    'settings.appearance': '外观',
    'settings.theme': '主题',
    'settings.theme.light': '浅色',
    'settings.theme.dark': '深色',
    'settings.theme.system': '跟随系统',
    'settings.accent': '强调色',
    'settings.accent.default': '默认',
    'settings.density': '密度',
    'settings.density.comfortable': '舒适',
    'settings.density.compact': '紧凑',
    'settings.editor': '编辑器',
    'settings.fontSize': '字号',
    'settings.lineHeight': '行高',
    'settings.tools': '显示的工具',
    'settings.behavior': '行为',
    'settings.defaultTool': '默认工具',
    'settings.restoreLast': '记忆上次位置',
    'settings.backend': '后端',
    'settings.backendEnabled': '启用后端功能',
    'settings.language': '语言',
    'settings.danger': '危险区',
    'settings.reset': '重置设置',
    'backend.notice': '此功能需要可选的后端。后端开源，可在设置中随时关闭。',
    'backend.viewSource': '查看后端源码',

    'editor.placeholder': '在此输入 Markdown...',

    'status.saved': '已保存',
    'status.editing': '编辑中',
    'status.chars': '字符',
    'status.words': '词',
    'status.line': '行',
    'status.lines': '行',
    'status.minRead': '分钟阅读',

    'txt.filename': '文件名',
    'txt.placeholder': '在此输入或粘贴文本...\n\n也可以拖放 .txt 文件。',
    'txt.download': '下载 .txt',
    'txt.copy': '复制',
    'txt.clear': '清空',

    'pdf.drop': '拖入 PDF 文件',
    'pdf.browse': '或点击选择文件',
    'pdf.hint': '在本地提取 PDF 文字，不会上传',
    'pdf.extracting': '正在提取文字',
    'pdf.change': '更换文件',
    'pdf.copyText': '复制文字',
    'pdf.downloadTxt': '下载 .txt',
    'pdf.downloadMd': '下载 .md',

    'img.drop': '拖入图片',
    'img.browse': '或点击选择 · PNG、JPG、WebP、GIF',
    'img.format': '输出格式',
    'img.quality': '质量',
    'img.maxWidth': '最大宽度（0 = 原始）',
    'img.download': '下载',
    'img.base64': 'Base64',
    'img.change': '更换',

    'drag.hint': '拖入文件 — .txt .md .pdf 或图片',

    'toast.newDoc': '已新建文档',
    'toast.loaded': '已加载',
    'toast.downloaded': '已下载',
    'toast.pdfExtracted': '页已从 PDF 提取',
    'toast.pdfFailed': 'PDF 文字提取失败',
    'toast.exportFailed': '导出失败',
    'toast.genPdf': '正在生成 PDF...',
    'toast.genImg': '正在生成图片...',
    'toast.pdfDone': 'PDF 已导出',
    'toast.pngDone': '图片已导出',
    'toast.htmlCopied': 'HTML 已复制',
    'toast.mdCopied': 'Markdown 已复制',
    'toast.copied': '已复制到剪贴板',
    'toast.zenHint': '专注模式 — 按 Esc 退出',
    'toast.startFresh': '新建文档？当前内容将被清除。',

    'brand.watermark': 'Made with TypeBox · github.com/jiangmuran/jmr-typebox',

    // Welcome dialog
    'welcome.title': 'TypeBox',
    'welcome.chooseLang': '选择语言',
    'welcome.feat.markdown': 'Markdown 编辑器',
    'welcome.feat.markdownDesc': '实时预览 · 导出 PDF / HTML / PNG',
    'welcome.feat.txt': 'TXT 创建器',
    'welcome.feat.txtDesc': '一键创建纯文本文件',
    'welcome.feat.pdf': 'PDF → Markdown',
    'welcome.feat.pdfDesc': '智能版面分析与转换',
    'welcome.feat.image': '图片工具',
    'welcome.feat.imageDesc': '压缩 · 格式转换 · Base64',
    'welcome.privacy': '100% 本地处理 · 绝不上传 · 开源',
    'welcome.start': '开始使用',
    'welcome.loadedToEditor': '已加载到编辑器',

    // PDF tools
    'pdf.openInEditor': '在编辑器中打开',
    'pdf.pages': '页',
  },
}

export function useI18n() {
  function t(key) {
    return dict[locale.value]?.[key] ?? dict.en[key] ?? key
  }

  function setLocale(l) {
    locale.value = l
    save('lang', l)
  }

  function toggleLocale() {
    setLocale(locale.value === 'zh' ? 'en' : 'zh')
  }

  return { locale, t, setLocale, toggleLocale }
}
