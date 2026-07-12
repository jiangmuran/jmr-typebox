// song_detail — fetch metadata for one or more songs (max 1000 ids per call).
// `ids` is a comma-separated string; we reshape it into NCM's c=[{"id":...}] envelope.
import { createOption } from '../option.js'

export default function song_detail(query, request) {
  const ids = String(query.ids).split(/\s*,\s*/)
  const data = {
    c: '[' + ids.map((id) => '{"id":' + id + '}').join(',') + ']',
  }
  return request('/api/v3/song/detail', data, createOption(query, 'weapi'))
}
