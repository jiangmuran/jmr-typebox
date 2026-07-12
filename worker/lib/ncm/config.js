// NCM endpoint + crypto config — vendored from api-enhanced/util/config.json (APP_CONF).
// Only the fields our 12 whitelisted modules touch; everything else dropped.

export const APP_CONF = {
  // weapi (web) hits music.163.com; eapi (PC client) hits interface.music.163.com.
  domain: 'https://music.163.com',
  apiDomain: 'https://interface.music.163.com',
  // Default response-encryption toggle (we leave responses plain; only request bodies are
  // encrypted). Set to true only if we later opt into e_r (encrypted response) mode.
  encryptResponse: false,
}

// Type values for /api/cloudsearch/pc — surfaced here so the search route can validate input.
export const SEARCH_TYPES = new Set([1, 10, 100, 1000, 1002, 1004, 1006, 1009, 1014])
