// Media toolkit — a powerful, multi-function media suite powered by ffmpeg.wasm:
//   • Universal converter (mp3/wav/flac/ogg/opus/aac/m4a + audio extraction from video)
//   • Subtitle tool (hard-burn subtitles into video, or soft-mux a selectable subtitle track)
//   • In-page <audio>/<video> preview of input and output
//
// Drop-in feature module: `components` override ToolStub for the /media routes, `i18n` is merged
// into useI18n, and register() wires the converters into the converter registry + adds a couple of
// ⌘K action commands (every route is auto-registered for navigation by the command palette).
//
// Engine: ffmpeg.wasm. The big ffmpeg-core (~31MB) is loaded at RUNTIME from the official CDN
// (it exceeds Cloudflare's 25MB static-asset limit); the small JS wrappers are bundled locally.
// This file MUST stay light/side-effect-free at import: no window/Blob/ffmpeg access, no useI18n.
import { registerConverter } from '../../converters/registry'
import { registerCommand } from '../../composables/useCommands'
import { MEDIA_CONVERTERS, mimeForFormat } from './mediaHelpers'

const Converter = () => import('./MediaPage.vue')
const Subtitle = () => import('./SubtitlePage.vue')

export default {
  components: {
    // Universal converter (generic landing page).
    '/media/convert': Converter,
    // Subtitle tool.
    '/media/subtitles': Subtitle,
    // Named, SEO-friendly converter routes (all render the same universal converter, prefilled).
    ...Object.fromEntries(MEDIA_CONVERTERS.map(c => [c.route, Converter])),
  },

  i18n: {
    en: {
      // Drop zone + shared
      'media.drop': 'Drop an audio or video file here',
      'media.browse': 'Click, drop, or paste · audio & video supported',
      'media.hint': 'Converts in your browser — nothing is uploaded',
      'media.convert': 'Convert',
      'media.converting': 'Converting…',
      'media.loadingRuntime': 'Loading runtime…',
      'media.runtimeHint': 'First run downloads the ffmpeg engine (~31MB) from the official CDN. It is cached afterwards.',
      'media.download': 'Download',
      'media.change': 'Change file',
      'media.bitrate': 'Bitrate',
      'media.from': 'From',
      'media.to': 'Convert to',
      'media.done': 'Done',
      'media.failed': 'Conversion failed',
      'media.unsupported': 'Unsupported file type — pick an audio or video file',
      'media.videoInput': 'video — audio will be extracted',
      'media.extractNote': 'Video detected — the audio track will be extracted.',
      'media.advanced': 'Advanced',
      'media.sampleRate': 'Sample rate',
      'media.channels': 'Channels',
      'media.keep': 'Keep source',
      'media.mono': 'Mono',
      'media.stereo': 'Stereo',

      // Converter page header
      'media.conv.title': 'Media Converter',
      'media.conv.sub': 'Convert audio between MP3, WAV, FLAC, OGG, Opus, AAC, M4A — or extract audio from video. Private, in-browser.',

      // Subtitle tool
      'media.sub.title': 'Subtitle Tool',
      'media.sub.sub': 'Burn subtitles into a video, or add a soft subtitle track from an .srt / .ass file.',
      'media.sub.mode': 'Mode',
      'media.sub.burn': 'Burn in (hardsub)',
      'media.sub.mux': 'Soft track (mux)',
      'media.sub.burnHint': 'Renders subtitles permanently onto the picture (re-encodes the video). Plays everywhere.',
      'media.sub.muxHint': 'Adds a selectable subtitle track without re-encoding — fast and lossless. Viewer can toggle it.',
      'media.sub.dropVideo': 'Drop a video file here',
      'media.sub.browseVideo': 'Click, drop, or paste · MP4, MOV, WebM, MKV',
      'media.sub.pickSub': 'Choose subtitle file (.srt / .ass / .vtt)',
      'media.sub.fontSize': 'Font size',
      'media.sub.quality': 'Quality (lower = better)',
      'media.sub.run': 'Process',
      'media.sub.failed': 'Subtitle processing failed',
      'media.sub.needVideo': 'Please choose a video file',
      'media.sub.needSub': 'Please choose a subtitle file (.srt / .ass / .vtt)',

      // ⌘K commands
      'media.cmd.convert': 'Convert audio / extract from video',
      'media.cmd.subtitles': 'Add subtitles to video',
    },
    zh: {
      'media.drop': '拖入音频或视频文件',
      'media.browse': '点击、拖入或粘贴 · 支持音频与视频',
      'media.hint': '在浏览器中转换,绝不上传',
      'media.convert': '开始转换',
      'media.converting': '转换中…',
      'media.loadingRuntime': '正在加载运行时…',
      'media.runtimeHint': '首次运行会从官方 CDN 下载 ffmpeg 引擎(约 31MB),之后会被缓存。',
      'media.download': '下载',
      'media.change': '更换文件',
      'media.bitrate': '比特率',
      'media.from': '源格式',
      'media.to': '转换为',
      'media.done': '完成',
      'media.failed': '转换失败',
      'media.unsupported': '不支持的文件类型 — 请选择音频或视频文件',
      'media.videoInput': '视频 — 将提取音频',
      'media.extractNote': '检测到视频 — 将提取其中的音频轨道。',
      'media.advanced': '高级选项',
      'media.sampleRate': '采样率',
      'media.channels': '声道',
      'media.keep': '保持原样',
      'media.mono': '单声道',
      'media.stereo': '立体声',

      'media.conv.title': '媒体转换',
      'media.conv.sub': '在 MP3、WAV、FLAC、OGG、Opus、AAC、M4A 之间转换音频,或从视频中提取音频。本地处理、私密。',

      'media.sub.title': '字幕工具',
      'media.sub.sub': '将字幕烧录进视频,或从 .srt / .ass 文件添加可切换的软字幕轨道。',
      'media.sub.mode': '模式',
      'media.sub.burn': '硬字幕(烧录)',
      'media.sub.mux': '软字幕(封装)',
      'media.sub.burnHint': '把字幕永久渲染到画面上(会重新编码视频),在任何播放器都能显示。',
      'media.sub.muxHint': '添加可切换的字幕轨道,无需重新编码 — 快速且无损,观众可自行开关。',
      'media.sub.dropVideo': '拖入视频文件',
      'media.sub.browseVideo': '点击、拖入或粘贴 · MP4、MOV、WebM、MKV',
      'media.sub.pickSub': '选择字幕文件(.srt / .ass / .vtt)',
      'media.sub.fontSize': '字号',
      'media.sub.quality': '画质(越小越清晰)',
      'media.sub.run': '开始处理',
      'media.sub.failed': '字幕处理失败',
      'media.sub.needVideo': '请选择一个视频文件',
      'media.sub.needSub': '请选择一个字幕文件(.srt / .ass / .vtt)',

      'media.cmd.convert': '转换音频 / 从视频提取',
      'media.cmd.subtitles': '为视频添加字幕',
    },
  },

  register() {
    // Register each named converter into the converter registry so file-drop / convert flows can
    // discover and run them. The actual engine is lazy-loaded from ./audioRunner on run().
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

    // ⌘K action commands with bilingual keywords (routes are auto-registered for navigation by the
    // palette; these add intent-based entries that match terms like "extract"/"提取"/"字幕").
    const go = (path) => { if (typeof window !== 'undefined') window.location.assign(path) }
    registerCommand({
      id: 'media-convert',
      title: 'Media Converter',
      group: 'Audio',
      keywords: 'audio video convert mp3 wav flac ogg opus aac m4a extract sound 音频 视频 转换 提取 转码',
      needsBackend: false,
      run: () => go('/media/convert'),
    })
    registerCommand({
      id: 'media-subtitles',
      title: 'Subtitle Tool',
      group: 'Audio',
      keywords: 'subtitle subtitles srt ass burn hardsub softsub mux caption video 字幕 烧录 软字幕 硬字幕 视频',
      needsBackend: false,
      run: () => go('/media/subtitles'),
    })
  },
}
