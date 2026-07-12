// cloudsearch — unified search across songs/playlists/albums/artists/MVs/lyrics/djs/videos.
// type: 1 song · 10 album · 100 artist · 1000 playlist · 1002 user · 1004 MV · 1006 lyric · 1009 dj · 1014 video
import { createOption } from '../option.js'

export default function cloudsearch(query, request) {
  const data = {
    s: query.keywords,
    type: query.type || 1,
    limit: query.limit || 30,
    offset: query.offset || 0,
    total: true,
  }
  return request('/api/cloudsearch/pc', data, createOption(query))
}
