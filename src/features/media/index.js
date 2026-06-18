// Media (audio) suite — MP3 ↔ WAV (and easily more) powered by ffmpeg.wasm.
// Drop-in feature module: components override ToolStub for the media routes, i18n strings
// are merged into useI18n, and register() wires the converters into the registry.
//
// This file MUST stay light and side-effect-free at import time: no window/document/ffmpeg
// access, and it MUST NOT import useI18n (circular). Heavy ffmpeg work is lazy-loaded inside
// each converter's run() via ./ffmpegRunner. Pure descriptors come from ./mediaHelpers.
import { registerConverter } from '../../converters/registry'
import { MEDIA_CONVERTERS, mimeForFormat } from './mediaHelpers'

const Page = () => import('./MediaPage.vue')

export default {
  // A single generic page renders every media route, driven by the active route path.
  components: {
    '/media/mp3-to-wav': Page,
    '/media/wav-to-mp3': Page,
  },

  i18n: {
    en: {
      'media.drop': 'Drop an audio file here',
      'media.browse': 'or click to browse · paste also works',
      'media.hint': 'Converts in your browser with ffmpeg — nothing is uploaded',
      'media.convert': 'Convert',
      'media.converting': 'Converting…',
      'media.download': 'Download',
      'media.change': 'Change file',
      'media.outputFormat': 'Output format',
      'media.bitrate': 'Bitrate',
      'media.bitrate.auto': 'Auto',
      'media.from': 'From',
      'media.to': 'To',
      'media.done': 'Conversion complete',
      'media.failed': 'Conversion failed',
      'media.unsupported': 'Unsupported file type',
      'media.loadingCore': 'Loading ffmpeg core…',
      'media.coreNotice': 'First use downloads the ~31MB ffmpeg core. It is cached afterwards, so later conversions are instant.',
      'media.preparing': 'Preparing…',
      'media.original': 'Original',
      'media.result': 'Result',
    },
    zh: {
      'media.drop': '拖入音频文件',
      'media.browse': '或点击选择 · 也可粘贴',
      'media.hint': '在浏览器中用 ffmpeg 转换，绝不上传',
      'media.convert': '开始转换',
      'media.converting': '转换中…',
      'media.download': '下载',
      'media.change': '更换文件',
      'media.outputFormat': '输出格式',
      'media.bitrate': '比特率',
      'media.bitrate.auto': '自动',
      'media.from': '源格式',
      'media.to': '目标格式',
      'media.done': '转换完成',
      'media.failed': '转换失败',
      'media.unsupported': '不支持的文件类型',
      'media.loadingCore': '正在加载 ffmpeg 核心…',
      'media.coreNotice': '首次使用会下载约 31MB 的 ffmpeg 核心，之后会被缓存，后续转换无需再次下载。',
      'media.preparing': '准备中…',
      'media.original': '原始',
      'media.result': '结果',
    },
  },

  register() {
    for (const c of MEDIA_CONVERTERS) {
      registerConverter({
        id: c.id,
        route: c.route,
        inputs: [c.input],
        output: c.output,
        where: 'client',
        needsBackend: false,
        // Lazy: the ffmpeg runtime is only pulled in when a conversion actually runs.
        run: async (input, opts = {}) => {
          const { convertAudio } = await import('./ffmpegRunner')
          return convertAudio(input, {
            inputFormat: c.input,
            outputFormat: c.output,
            options: opts.options,
            onLog: opts.onLog,
            onProgress: opts.onProgress,
          })
        },
        mime: mimeForFormat(c.output),
      })
    }
  },
}
