// album — full album metadata + track list.
import { createOption } from '../option.js'

export default function album(query, request) {
  return request(`/api/v1/album/${query.id}`, {}, createOption(query, 'weapi'))
}
