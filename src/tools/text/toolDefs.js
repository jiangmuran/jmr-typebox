import * as T from './transforms'

// Tool descriptors keyed by route. `transform` tools are input→output with op buttons;
// other modes (hash/jwt/wordcount/aes) get bespoke UI in ToolboxPage. Op labels are
// kept here (bilingual) so the toolbox is self-contained.
export const TOOL_DEFS = {
  '/tools/word-count': { mode: 'wordcount' },
  '/tools/base64': {
    mode: 'transform',
    ops: [
      { en: 'Base64 Encode', zh: 'Base64 编码', fn: T.base64Encode },
      { en: 'Base64 Decode', zh: 'Base64 解码', fn: T.base64Decode },
      { en: 'Hex Encode', zh: 'Hex 编码', fn: T.hexEncode },
      { en: 'Hex Decode', zh: 'Hex 解码', fn: T.hexDecode },
      { en: 'URL Encode', zh: 'URL 编码', fn: T.urlEncode },
      { en: 'URL Decode', zh: 'URL 解码', fn: T.urlDecode },
      { en: 'HTML Encode', zh: 'HTML 编码', fn: T.htmlEntitiesEncode },
      { en: 'HTML Decode', zh: 'HTML 解码', fn: T.htmlEntitiesDecode },
    ],
  },
  '/tools/aes': { mode: 'aes' },
  '/tools/hash': { mode: 'hash' },
  '/tools/json': {
    mode: 'transform',
    ops: [
      { en: 'Format', zh: '格式化', fn: T.jsonFormat },
      { en: 'Minify', zh: '压缩', fn: T.jsonMinify },
    ],
  },
  '/tools/jwt': { mode: 'jwt' },
  '/tools/totp': { mode: 'totp' },
  '/tools/qr': { mode: 'qr' },
}

export const TOOL_PATHS = Object.keys(TOOL_DEFS)
