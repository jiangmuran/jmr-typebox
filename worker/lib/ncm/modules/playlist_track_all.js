// playlist_track_all — fetch every track in a playlist by paging through its trackIds.
// Two-step like upstream: GET /playlist/detail to harvest trackIds, then POST /song/detail
// with the slice [offset, offset+limit] to fetch full per-track metadata.
import { createOption } from '../option.js'

export default async function playlist_track_all(query, request) {
  const data = { id: query.id, n: 100000, s: query.s || 8 }
  const limit = parseInt(query.limit) || 1000
  const offset = parseInt(query.offset) || 0

  const detail = await request('/api/v6/playlist/detail', data, createOption(query))
  const trackIds = (detail.body && detail.body.playlist && detail.body.playlist.trackIds) || []

  const slice = trackIds.slice(offset, offset + limit)
  const idsData = {
    c: '[' + slice.map((item) => '{"id":' + item.id + '}').join(',') + ']',
  }
  return request('/api/v3/song/detail', idsData, createOption(query))
}
