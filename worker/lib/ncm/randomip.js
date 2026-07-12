// Random Chinese IP generator — Cloudflare Workers run on edge nodes that are usually OUTSIDE
// mainland China, and music.163.com applies IP-based geo-restrictions (overseas IPs get empty
// results / 403). The api-enhanced project ships ENABLE_RANDOM_CN_IP=true to bypass this by
// forging X-Real-IP / X-Forwarded-For on every upstream request.
//
// Vendoring strategy: instead of loading the full ~7800-line china_ip_ranges.txt from
// api-enhanced/data/, we inline a curated set of well-known consumer ISP CIDRs (China Telecom
// 163 backbone + China Unicom + China Mobile + a few education网 blocks). This is ~30 ranges,
// ~1KB, and statistically indistinguishable from real residential traffic for NCM's purposes.
// If you need full coverage, replace CHINA_CIDRS with the upstream file's contents.

const CHINA_CIDRS = [
  // China Telecom (CHINANET) — 163 backbone, very common residential
  '36.32.0.0/14', '58.16.0.0/15', '58.34.0.0/15', '59.32.0.0/13',
  '60.169.0.0/16', '61.128.0.0/10', '113.0.0.0/13', '113.96.0.0/11',
  '114.80.0.0/12', '115.32.0.0/11', '116.0.0.0/14', '116.192.0.0/12',
  '117.21.0.0/16', '118.112.0.0/13', '119.176.0.0/12', '121.8.0.0/14',
  '122.4.0.0/14', '123.4.0.0/14', '124.64.0.0/13', '125.0.0.0/10',
  '180.96.0.0/11', '182.32.0.0/12', '183.0.0.0/10', '218.0.0.0/12',
  '219.128.0.0/11', '220.176.0.0/12', '221.0.0.0/10', '222.128.0.0/11',
  // China Unicom
  '60.0.0.0/11', '61.49.0.0/16', '110.80.0.0/13', '111.0.0.0/10',
  '112.0.0.0/13', '113.200.0.0/14', '116.16.0.0/12', '117.32.0.0/11',
  '118.64.0.0/13', '119.32.0.0/13', '120.4.0.0/14', '121.16.0.0/13',
  '122.96.0.0/13', '123.128.0.0/13', '124.16.0.0/13', '125.32.0.0/13',
  // China Mobile
  '36.40.0.0/13', '39.64.0.0/11', '111.0.0.0/10', '112.0.0.0/13',
  '117.128.0.0/10', '120.192.0.0/10', '182.16.0.0/12', '183.192.0.0/10',
]

// Pre-parse each CIDR to a { start, end, count } integer range, then build a weighted reservoir
// by total count — this lets us pick a uniform-random mainland IP across all ranges in O(n)
// without maintaining the full ~billions-of-IPs array.
const RANGES = (() => {
  const out = []
  let total = 0
  for (const cidr of CHINA_CIDRS) {
    const [ipStr, prefixStr] = cidr.split('/')
    const prefix = parseInt(prefixStr, 10)
    const ipInt = ipToInt(ipStr)
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
    const start = (ipInt & mask) >>> 0
    const end = (start | (~mask >>> 0)) >>> 0
    const count = end - start + 1
    out.push({ start, end, count })
    total += count
  }
  out.totalCount = total
  return out
})()

function ipToInt(ip) {
  const parts = ip.split('.').map(Number)
  return (((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0
}

function intToIp(int) {
  return [(
    int >>> 24) & 0xff, (int >>> 16) & 0xff, (int >>> 8) & 0xff, int & 0xff
  ].join('.')
}

/**
 * Returns a uniform-random IPv4 address inside one of the curated mainland-China CIDR ranges.
 * Mirrors api-enhanced/util/index.js#generateRandomChineseIP but uses an inlined range table
 * instead of reading china_ip_ranges.txt from disk.
 */
export function generateRandomChineseIP() {
  const total = RANGES.totalCount
  if (!total) return '116.25.146.19' // unreachable: CHINA_CIDRS is non-empty at module load
  let offset = Math.floor(Math.random() * total)
  for (const r of RANGES) {
    if (offset < r.count) {
      return intToIp(r.start + Math.floor(Math.random() * (r.end - r.start + 1)))
    }
    offset -= r.count
  }
  const last = RANGES[RANGES.length - 1]
  return intToIp(last.start)
}

/**
 * Returns true if `ip` falls inside one of our curated mainland-China CIDRs. Used by tests so
 * they don't have to maintain a parallel list of "known CN prefixes"; also useful for any
 * future feature that wants to gate on "is this address likely mainland-CN".
 */
export function isChineseCuratedIP(ip) {
  const ipInt = ipToInt(ip)
  if (ipInt == null || Number.isNaN(ipInt)) return false
  for (const r of RANGES) {
    if (ipInt >= r.start && ipInt <= r.end) return true
  }
  return false
}
