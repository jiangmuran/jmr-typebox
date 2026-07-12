// user_detail — public profile for a given userId (nickname / avatar / VIP state).
//
// IMPORTANT: this is the ONLY user-read module in our vendored set. It exposes the *public*
// profile of whoever owns the MUSIC_U cookie the admin scanned-logged-in with — so the admin
// dashboard can show "logged in as: <nickname>". We do NOT vendor user_playlist / user_cloud /
// recommend_songs / personal_fm / record / history — those read private account data and have
// no place on a shared-player admin surface.
import { createOption } from '../option.js'

export default async function user_detail(query, request) {
  const res = await request(`/api/v1/user/detail/${query.uid}`, {}, createOption(query, 'weapi'))
  // Rename NCM's awkward `avatarImgId_str` field to camelCase for client convenience.
  const text = JSON.stringify(res).replace(/avatarImgId_str/g, 'avatarImgIdStr')
  return JSON.parse(text)
}
