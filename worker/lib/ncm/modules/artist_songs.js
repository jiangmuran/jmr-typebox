// artist_songs — paginated list of an artist's songs (hot or chronological).
import { createOption } from '../option.js'

export default function artist_songs(query, request) {
  const data = {
    id: query.id,
    private_cloud: 'true',
    work_type: 1,
    order: query.order || 'hot', // 'hot' | 'time'
    offset: query.offset || 0,
    limit: query.limit || 100,
  }
  return request('/api/v1/artist/songs', data, createOption(query))
}
