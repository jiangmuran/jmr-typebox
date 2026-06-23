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

      // Workbench tabs
      'media.tab.convert': 'Convert',
      'media.tab.edit': 'Edit',
      'media.tab.advanced': 'Advanced',

      // Edit tab
      'media.edit.hint': 'Trim, adjust volume, fade, or normalize — applied with ffmpeg and re-encoded.',
      'media.edit.apply': 'Apply & export',
      'media.edit.trim': 'Trim',
      'media.edit.start': 'Start',
      'media.edit.end': 'End',
      'media.edit.clearTrim': 'Clear',
      'media.edit.dragHint': 'Tip: drag across the waveform to set a trim range; click to seek.',
      'media.edit.gain': 'Volume / gain',
      'media.edit.fadeIn': 'Fade in',
      'media.edit.fadeOut': 'Fade out',
      'media.edit.normalize': 'Normalize loudness (EBU R128)',
      'media.edit.normalizeHint': 'Evens out perceived loudness to a broadcast target (~-16 LUFS).',

      // Advanced / custom command
      'media.adv.intro': 'Run a raw ffmpeg command against your file. For advanced users.',
      'media.adv.label': 'ffmpeg arguments',
      'media.adv.placeholder': "e.g.  -af loudnorm   (input & output are wired automatically)",
      'media.adv.tokens': 'Your input is added as -i automatically; the output is appended. Use {input} / {output} to place them explicitly.',
      'media.adv.ack': 'I understand this runs a custom command in my browser.',
      'media.adv.run': 'Run command',
      'media.adv.failed': 'Command failed — check your ffmpeg arguments',

      // Converter page header
      'media.conv.title': 'Audio Workbench',
      'media.conv.sub': 'Convert, trim, fade, normalize, and visualize audio — or extract audio from video. Powered by ffmpeg, fully in your browser. Private, nothing uploaded.',

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

      // 工作台标签
      'media.tab.convert': '转换',
      'media.tab.edit': '编辑',
      'media.tab.advanced': '高级',

      // 编辑
      'media.edit.hint': '裁剪、调整音量、淡入淡出或响度归一 —— 由 ffmpeg 处理并重新编码。',
      'media.edit.apply': '应用并导出',
      'media.edit.trim': '裁剪',
      'media.edit.start': '起点',
      'media.edit.end': '终点',
      'media.edit.clearTrim': '清除',
      'media.edit.dragHint': '提示:在波形上拖动可设置裁剪区间;点击可跳转播放位置。',
      'media.edit.gain': '音量 / 增益',
      'media.edit.fadeIn': '淡入',
      'media.edit.fadeOut': '淡出',
      'media.edit.normalize': '响度归一化(EBU R128)',
      'media.edit.normalizeHint': '将感知响度调整到广播标准(约 -16 LUFS)。',

      // 高级 / 自定义命令
      'media.adv.intro': '对你的文件运行原始 ffmpeg 命令。面向高级用户。',
      'media.adv.label': 'ffmpeg 参数',
      'media.adv.placeholder': '例如  -af loudnorm  (输入与输出会自动接入)',
      'media.adv.tokens': '输入会自动以 -i 加入,输出会自动追加。可用 {input} / {output} 显式指定它们的位置。',
      'media.adv.ack': '我了解这会在我的浏览器中运行自定义命令。',
      'media.adv.run': '运行命令',
      'media.adv.failed': '命令执行失败 —— 请检查你的 ffmpeg 参数',

      'media.conv.title': '音频工作台',
      'media.conv.sub': '转换、裁剪、淡入淡出、响度归一并可视化音频,或从视频中提取音频。由 ffmpeg 驱动,完全在浏览器中处理,私密、绝不上传。',

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
