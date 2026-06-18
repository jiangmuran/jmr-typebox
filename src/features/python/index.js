// Python playground suite — run Python in the browser with Pyodide (self-hosted, no CDN).
// Drop-in feature module: `components` overrides ToolStub for /python, the `py.*` i18n strings
// are merged into useI18n, and register() wires a ⌘K command to jump to the playground.
//
// This file MUST stay light and side-effect-free at import time: no window/document/pyodide
// access, and it MUST NOT import useI18n (circular). The heavy Pyodide runtime is lazy-loaded
// inside PythonPlayground's run() via ./pythonRunner. Pure descriptors come from
// ./pythonHelpers, which is also SSG/node-safe.
import { registerCommand } from '../../composables/useCommands'

const Page = () => import('./PythonPage.vue')

export default {
  components: {
    '/python': Page,
  },

  i18n: {
    en: {
      'py.title': 'Python Playground',
      'py.hint': 'Run Python in your browser with Pyodide — no server, nothing uploaded.',
      'py.placeholder': '# Write Python here, then press Run (Cmd/Ctrl+Enter)\nprint("Hello, world")',
      'py.run': 'Run',
      'py.running': 'Running…',
      'py.loadingCore': 'Loading Python runtime…',
      'py.initRuntime': 'Starting Python…',
      'py.coreNotice': 'First run downloads the ~12MB Python runtime. It is cached afterwards, so later runs are instant.',
      'py.console': 'Output',
      'py.lastValue': 'Last value',
      'py.figures': 'Figure',
      'py.htmlOutput': 'HTML output',
      'py.noOutput': '(ran with no output)',
      'py.clearOutput': 'Clear output',
      'py.failed': 'Run failed',
      'py.packages': 'Install packages',
      'py.packagesNote': 'Optional & online: micropip fetches wheels from PyPI / jsDelivr over the network. The Python standard library, NumPy and Matplotlib already work fully offline.',
      'py.packagesPlaceholder': 'e.g. requests, rich, cowsay',
      'py.install': 'Install',
      'py.installing': 'Installing…',
      'py.installed': 'Installed',
      'py.installFailed': 'Install failed',
      'py.networkBadge': 'Needs network (micropip)',
      'py.command': 'Open Python Playground',
    },
    zh: {
      'py.title': 'Python 运行场',
      'py.hint': '用 Pyodide 在浏览器里运行 Python — 无需服务器,绝不上传。',
      'py.placeholder': '# 在此编写 Python,然后点击运行(Cmd/Ctrl+Enter)\nprint("你好,世界")',
      'py.run': '运行',
      'py.running': '运行中…',
      'py.loadingCore': '正在加载 Python 运行时…',
      'py.initRuntime': '正在启动 Python…',
      'py.coreNotice': '首次运行会下载约 12MB 的 Python 运行时,之后会被缓存,后续运行无需再次下载。',
      'py.console': '输出',
      'py.lastValue': '最后的值',
      'py.figures': '图像',
      'py.htmlOutput': 'HTML 输出',
      'py.noOutput': '(运行完成,无输出)',
      'py.clearOutput': '清空输出',
      'py.failed': '运行失败',
      'py.packages': '安装第三方包',
      'py.packagesNote': '可选且联网:micropip 会通过网络从 PyPI / jsDelivr 下载 wheel 包。Python 标准库、NumPy 和 Matplotlib 已可完全离线使用。',
      'py.packagesPlaceholder': '例如 requests, rich, cowsay',
      'py.install': '安装',
      'py.installing': '安装中…',
      'py.installed': '已安装',
      'py.installFailed': '安装失败',
      'py.networkBadge': '需要联网(micropip)',
      'py.command': '打开 Python 运行场',
    },
  },

  register() {
    // ⌘K entry. The title resolves through useI18n at palette render time via the t() lookup
    // of the registered key; we set a stable English fallback as the visible title here and a
    // keyword so search matches "python" in either language.
    registerCommand({
      id: 'open-python',
      title: 'Python Playground',
      group: 'Tools',
      keywords: 'python pyodide run code repl 运行 代码',
      needsBackend: false,
      run: () => {
        if (typeof window !== 'undefined') window.location.assign('/python')
      },
    })
  },
}
