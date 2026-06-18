// Media (audio) suite — MP3 ↔ WAV (and easily more). Drop-in feature module: components
// override ToolStub for the media routes, i18n is merged into useI18n, and register() wires
// the converters into the registry.
//
// Engine: Web Audio decode + WAV writer + lamejs (MP3) — fully local, no CDN, no large wasm.
// This file MUST stay light/side-effect-free at import: no window/audio access, no useI18n.
import { registerConverter } from '../../converters/registry'
import { MEDIA_CONVERTERS, mimeForFormat } from './mediaHelpers'

const Page = () => import('./MediaPage.vue')

export default {
  components: {
    '/media/mp3-to-wav': Page,
    '/media/wav-to-mp3': Page,
  },

  i18n: {
    en: {
      'media.drop': 'Drop an audio file here',
      'media.browse': 'or click to browse · paste also works',
      'media.hint': 'Converts in your browser — nothing is uploaded',
      'media.convert': 'Convert',
      'media.converting': 'Converting…',
      'media.download': 'Download',
      'media.change': 'Change file',
      'media.bitrate': 'Bitrate',
      'media.bitrate.auto': 'Auto',
      'media.from': 'From',
      'media.to': 'To',
      'media.done': 'Conversion complete',
      'media.failed': 'Conversion failed',
      'media.unsupported': 'Unsupported file type',
    },
    zh: {
      'media.drop': '拖入音频文件',
      'media.browse': '或点击选择 · 也可粘贴',
      'media.hint': '在浏览器中转换，绝不上传',
      'media.convert': '开始转换',
      'media.converting': '转换中…',
      'media.download': '下载',
      'media.change': '更换文件',
      'media.bitrate': '比特率',
      'media.bitrate.auto': '自动',
      'media.from': '源格式',
      'media.to': '目标格式',
      'media.done': '转换完成',
      'media.failed': '转换失败',
      'media.unsupported': '不支持的文件类型',
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
        run: async (input, opts = {}) => {
          const { convertAudio } = await import('./audioRunner')
          return convertAudio(input, { outputFormat: c.output, options: opts.options, onProgress: opts.onProgress })
        },
        mime: mimeForFormat(c.output),
      })
    }
  },
}
