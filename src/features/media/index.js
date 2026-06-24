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
const Player = () => import('./PlayerPage.vue')

export default {
  components: {
    // Universal converter (generic landing page).
    '/media/convert': Converter,
    // Audio editor view — the same workbench, opened on its Edit tab (deep-linked sub-tool).
    '/media/edit': Converter,
    // Subtitle tool.
    '/media/subtitles': Subtitle,
    // Music player mode — local/uploaded audio: library, playlists, lyrics, metadata, MediaSession.
    '/media/player': Player,
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
      // Pre-run hints reflecting whether the ~31MB core is already cached (Cache API).
      'media.runtimeCached': 'Runtime cached — loads instantly, no download.',
      'media.runtimeWillDownload': 'First run downloads the ffmpeg engine (~31MB) once, then caches it for next time.',
      'media.runtimeFromCache': 'Loading cached runtime…',
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
      'media.cmd.player': 'Music player (play your own audio)',

      // Audio hub sub-nav
      'media.nav.convert': 'Convert',
      'media.nav.edit': 'Edit',
      'media.nav.subtitles': 'Subtitles',
      'media.nav.player': 'Player',

      // Add-to-player (shown on the converter / editor / subtitle pages)
      'media.addToPlayer': 'Add to player',
      'media.addedToPlayer': 'Added to your player library',

      // ===== Player mode =====
      'media.player.title': 'Music Player',
      'media.player.sub': 'Play audio you own — private and offline. Tracks and playlists are saved in your browser; nothing is uploaded.',
      'media.player.nowPlaying': 'Now Playing',
      'media.player.lyrics': 'Lyrics',
      'media.player.nothingPlaying': 'Nothing playing — add a track to begin',
      // Library
      'media.player.allTracks': 'All tracks',
      'media.player.add': 'Add music',
      'media.player.search': 'Search title, artist, album…',
      'media.player.emptyTitle': 'Your library is empty',
      'media.player.emptySub': 'Drop audio files here, or click Add music. They stay on your device.',
      'media.player.noMatch': 'No tracks match your search.',
      'media.player.play': 'Play',
      'media.player.more': 'More',
      'media.player.addTo': 'Add to playlist',
      'media.player.remove': 'Remove from library',
      'media.player.newPlaylist': 'New playlist',
      'media.player.playlistName': 'Playlist name',
      'media.player.deletePlaylist': 'Delete playlist',
      'media.player.addedToPlaylist': 'Added to playlist',
      // Cache
      'media.player.stored': 'Stored',
      'media.player.clearCache': 'Clear cache',
      'media.player.clearConfirm': 'Remove all stored tracks from this browser? Playlists are kept but emptied.',
      'media.player.cacheCleared': 'Library cleared',
      'media.player.cacheFull': 'Storage cap reached — clear some tracks first',
      // Now-Playing transport
      'media.player.prev': 'Previous',
      'media.player.pause': 'Pause',
      'media.player.next': 'Next',
      'media.player.shuffle': 'Shuffle',
      'media.player.repeat': 'Repeat',
      'media.player.abRepeat': 'A–B repeat',
      'media.player.toggleArt': 'Toggle artwork / waveform',
      'media.player.editTags': 'Edit metadata',
      'media.player.sendEdit': 'Send to Edit',
      'media.player.sendConvert': 'Send to Convert',
      // Mobile deck
      'media.player.swipeHint': 'Swipe to switch',
      'media.player.swipeLyrics': 'Swipe left for lyrics →',
      'media.player.swipeBack': '← Swipe back',
      // Tag editor
      'media.player.fieldTitle': 'Title',
      'media.player.fieldArtist': 'Artist',
      'media.player.fieldAlbum': 'Album',
      'media.player.exportNote': 'Saving updates the title in your library. “Export tagged file” writes the tags into a downloadable copy (no re-encode).',
      'media.player.exportTagged': 'Export tagged file',
      'media.player.tagsSaved': 'Metadata saved',
      // Lyrics panel
      'media.lyrics.none': 'No lyrics yet',
      'media.lyrics.addHint': 'Drop or paste a .lrc file for synced lyrics, or plain text.',
      'media.lyrics.paste': 'Add lyrics',
      'media.lyrics.dropHere': 'Drop .lrc or .txt to add lyrics',
      'media.lyrics.edit': 'Edit lyrics',
      'media.lyrics.save': 'Save',
      'media.lyrics.cancel': 'Cancel',
      'media.lyrics.plainNote': 'Plain text (no timing). Paste an .lrc for synced, scrolling lyrics.',
      'media.lyrics.placeholder': 'Paste .lrc (e.g. [00:12.34]line) or plain lyrics…',

      // ===== Online (official-embed) source =====
      'media.online.tabFiles': 'Files',
      'media.online.tabOnline': 'Online',
      'media.online.paste': 'Paste a NetEase / Bilibili / YouTube link…',
      'media.online.addBtn': 'Add',
      'media.online.hint': 'Plays the platform’s OWN embedded player in-page — official playback, not a download. NetEase Cloud Music, Bilibili, and YouTube links are supported.',
      'media.online.unsupported': 'Unsupported link — paste a NetEase, Bilibili, or YouTube URL',
      'media.online.emptyTitle': 'No online items yet',
      'media.online.emptySub': 'Paste a share link to play it via the platform’s official embed.',
      'media.online.embedTag': 'official embed',
      'media.online.officialBadge': 'Official embed · in-page playback',
      'media.online.playbackNote': 'This is the platform’s own embedded player (playback only). Online items can’t be edited, tagged, converted, or cached as files — they’re live embeds. Availability and region limits are set by the platform.',
      'media.online.openTab': 'Open in a new tab',
      'media.online.badUrl': 'This embed URL is not allowed.',
    },
    zh: {
      'media.drop': '拖入音频或视频文件',
      'media.browse': '点击、拖入或粘贴 · 支持音频与视频',
      'media.hint': '在浏览器中转换,绝不上传',
      'media.convert': '开始转换',
      'media.converting': '转换中…',
      'media.loadingRuntime': '正在加载运行时…',
      'media.runtimeHint': '首次运行会从官方 CDN 下载 ffmpeg 引擎(约 31MB),之后会被缓存。',
      // 运行前提示:根据 ~31MB 核心是否已缓存(Cache API)显示不同文案。
      'media.runtimeCached': '运行时已缓存 —— 立即加载,无需下载。',
      'media.runtimeWillDownload': '首次运行会下载一次 ffmpeg 引擎(约 31MB),之后会被缓存以便下次直接使用。',
      'media.runtimeFromCache': '正在加载已缓存的运行时…',
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
      'media.cmd.player': '音乐播放器(播放你自己的音频)',

      // 音频中心子导航
      'media.nav.convert': '转换',
      'media.nav.edit': '编辑',
      'media.nav.subtitles': '字幕',
      'media.nav.player': '播放器',

      // 加入播放器(显示在转换 / 编辑 / 字幕页面)
      'media.addToPlayer': '加入播放器',
      'media.addedToPlayer': '已加入播放器曲库',

      // ===== 播放器模式 =====
      'media.player.title': '音乐播放器',
      'media.player.sub': '播放你自己的音频 —— 私密、离线。曲目与歌单保存在你的浏览器中,绝不上传。',
      'media.player.nowPlaying': '正在播放',
      'media.player.lyrics': '歌词',
      'media.player.nothingPlaying': '暂无播放 —— 添加一首曲目开始',
      // 曲库
      'media.player.allTracks': '全部曲目',
      'media.player.add': '添加音乐',
      'media.player.search': '搜索标题、艺术家、专辑…',
      'media.player.emptyTitle': '曲库还是空的',
      'media.player.emptySub': '把音频文件拖到这里,或点击「添加音乐」。文件只保存在你的设备上。',
      'media.player.noMatch': '没有匹配的曲目。',
      'media.player.play': '播放',
      'media.player.more': '更多',
      'media.player.addTo': '加入歌单',
      'media.player.remove': '从曲库移除',
      'media.player.newPlaylist': '新建歌单',
      'media.player.playlistName': '歌单名称',
      'media.player.deletePlaylist': '删除歌单',
      'media.player.addedToPlaylist': '已加入歌单',
      // 缓存
      'media.player.stored': '已存储',
      'media.player.clearCache': '清除缓存',
      'media.player.clearConfirm': '从此浏览器移除所有已存储的曲目?歌单会保留但被清空。',
      'media.player.cacheCleared': '曲库已清空',
      'media.player.cacheFull': '已达存储上限 —— 请先清理部分曲目',
      // 正在播放 / 传输控制
      'media.player.prev': '上一首',
      'media.player.pause': '暂停',
      'media.player.next': '下一首',
      'media.player.shuffle': '随机播放',
      'media.player.repeat': '循环',
      'media.player.abRepeat': 'A–B 循环',
      'media.player.toggleArt': '切换封面 / 波形',
      'media.player.editTags': '编辑元数据',
      'media.player.sendEdit': '发送到编辑',
      'media.player.sendConvert': '发送到转换',
      // 移动端滑动
      'media.player.swipeHint': '滑动切换',
      'media.player.swipeLyrics': '左滑查看歌词 →',
      'media.player.swipeBack': '← 向右滑返回',
      // 标签编辑
      'media.player.fieldTitle': '标题',
      'media.player.fieldArtist': '艺术家',
      'media.player.fieldAlbum': '专辑',
      'media.player.exportNote': '保存会更新曲库中的标题。「导出带标签文件」会把标签写入一个可下载的副本(不重新编码)。',
      'media.player.exportTagged': '导出带标签文件',
      'media.player.tagsSaved': '元数据已保存',
      // 歌词面板
      'media.lyrics.none': '暂无歌词',
      'media.lyrics.addHint': '拖入或粘贴 .lrc 文件以获得同步歌词,或粘贴纯文本。',
      'media.lyrics.paste': '添加歌词',
      'media.lyrics.dropHere': '拖入 .lrc 或 .txt 添加歌词',
      'media.lyrics.edit': '编辑歌词',
      'media.lyrics.save': '保存',
      'media.lyrics.cancel': '取消',
      'media.lyrics.plainNote': '纯文本(无时间轴)。粘贴 .lrc 可获得同步滚动歌词。',
      'media.lyrics.placeholder': '粘贴 .lrc(例如 [00:12.34]歌词)或纯文本歌词…',

      // ===== 在线(官方嵌入)来源 =====
      'media.online.tabFiles': '文件',
      'media.online.tabOnline': '在线',
      'media.online.paste': '粘贴网易云 / 哔哩哔哩 / YouTube 链接…',
      'media.online.addBtn': '添加',
      'media.online.hint': '在页面内播放平台「自己的」嵌入式播放器 —— 官方播放,并非下载。支持网易云音乐、哔哩哔哩和 YouTube 链接。',
      'media.online.unsupported': '不支持的链接 —— 请粘贴网易云、哔哩哔哩或 YouTube 网址',
      'media.online.emptyTitle': '还没有在线项目',
      'media.online.emptySub': '粘贴一个分享链接,通过平台官方嵌入播放。',
      'media.online.embedTag': '官方嵌入',
      'media.online.officialBadge': '官方嵌入 · 页面内播放',
      'media.online.playbackNote': '这是平台自带的嵌入式播放器(仅播放)。在线项目无法被编辑、写标签、转换或作为文件缓存 —— 它们是实时嵌入。可用性与地区限制由平台决定。',
      'media.online.openTab': '在新标签打开',
      'media.online.badUrl': '该嵌入网址不被允许。',
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
    registerCommand({
      id: 'media-player',
      title: 'Music Player',
      group: 'Audio',
      keywords: 'music player play audio playlist lyrics lrc id3 tags local offline 音乐 播放器 播放 歌单 歌词 本地',
      needsBackend: false,
      run: () => go('/media/player'),
    })
  },
}
