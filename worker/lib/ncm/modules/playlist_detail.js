// playlist_detail — playlist metadata + first ~10 tracks (full track list comes from
// playlist_track_all, which pages via the playlist's trackIds array).
import { createOption } from '../option.js'

export default function playlist_detail(query, request) {
  const data = {
    id: query.id,
    n: 100000,
    s: query.s || 8,
  }
  return request('/api/v6/playlist/detail', data, createOption(query))
}
