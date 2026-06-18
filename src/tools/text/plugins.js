import * as T from './transforms'
import { sha256 } from './hash'

// Editor right-click plugins: operate on the selection (or whole doc) and replace it.
// Reuse the tested text-tools core. `fn` is sync; `asyncFn` returns a Promise.
export const PLUGIN_GROUPS = {
  encode: { en: 'Encode', zh: '编码' },
  case: { en: 'Case', zh: '大小写' },
  data: { en: 'Data', zh: '数据' },
  lines: { en: 'Lines', zh: '行' },
  hash: { en: 'Hash', zh: '哈希' },
}

export const EDITOR_PLUGINS = [
  { id: 'b64enc', en: 'Base64 Encode', zh: 'Base64 编码', group: 'encode', fn: T.base64Encode },
  { id: 'b64dec', en: 'Base64 Decode', zh: 'Base64 解码', group: 'encode', fn: T.base64Decode },
  { id: 'urlenc', en: 'URL Encode', zh: 'URL 编码', group: 'encode', fn: T.urlEncode },
  { id: 'urldec', en: 'URL Decode', zh: 'URL 解码', group: 'encode', fn: T.urlDecode },
  { id: 'htmlenc', en: 'HTML Encode', zh: 'HTML 编码', group: 'encode', fn: T.htmlEntitiesEncode },
  { id: 'upper', en: 'UPPERCASE', zh: '转大写', group: 'case', fn: T.toUpper },
  { id: 'lower', en: 'lowercase', zh: '转小写', group: 'case', fn: T.toLower },
  { id: 'title', en: 'Title Case', zh: '标题大小写', group: 'case', fn: T.toTitle },
  { id: 'jsonfmt', en: 'Format JSON', zh: '格式化 JSON', group: 'data', fn: T.jsonFormat },
  { id: 'jsonmin', en: 'Minify JSON', zh: '压缩 JSON', group: 'data', fn: T.jsonMinify },
  { id: 'sortlines', en: 'Sort Lines', zh: '排序行', group: 'lines', fn: T.sortLines },
  { id: 'uniqlines', en: 'Unique Lines', zh: '去重行', group: 'lines', fn: T.uniqueLines },
  { id: 'reverselines', en: 'Reverse Lines', zh: '反转行', group: 'lines', fn: T.reverseLines },
  { id: 'sha256', en: 'SHA-256', zh: 'SHA-256', group: 'hash', asyncFn: sha256 },
]
