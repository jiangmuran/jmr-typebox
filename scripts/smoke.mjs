// Real-browser smoke: drives system Chrome against a running server, checks that each route
// hydrates (Vue app mounted) with no page/console errors, and screenshots it.
// Usage: BASE=http://localhost:8787 node scripts/smoke.mjs
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.env.BASE || 'http://localhost:8787'
const OUT = '/tmp/tb-smoke'
mkdirSync(OUT, { recursive: true })

const ROUTES = ['/', '/txt', '/tools/base64', '/tools/aes', '/image/compress', '/image/edit', '/convert/markdown-to-pdf', '/media/mp3-to-wav', '/python']

// External/offline-only resources to ignore (analytics beacon can't load in this sandbox).
const IGNORE = [/cloudflareinsights/i, /beacon\.min\.js/i, /favicon/i, /Failed to load resource/i]

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
let failures = 0
for (const route of ROUTES) {
  const page = await browser.newPage()
  await page.evaluateOnNewDocument(() => { try { localStorage.setItem('tb-welcomed', '1') } catch {} })
  await page.setViewport({ width: 1280, height: 860 })
  const errors = []
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message))
  page.on('console', m => { if (m.type() === 'error' && !IGNORE.some(re => re.test(m.text()))) errors.push('CONSOLE: ' + m.text()) })
  page.on('requestfailed', r => { const u = r.url(); if (!IGNORE.some(re => re.test(u))) errors.push('REQFAIL: ' + u) })
  try {
    await page.goto(BASE + route, { waitUntil: 'networkidle2', timeout: 25000 })
    await new Promise(r => setTimeout(r, 800))
    const mounted = await page.evaluate(() => !!document.querySelector('#app') && document.querySelector('#app').childElementCount > 0)
    const slug = route === '/' ? 'home' : route.replace(/\//g, '_')
    await page.screenshot({ path: `${OUT}/${slug}.png` })
    // Mobile viewport capture (iPhone-ish) to audit responsive layout.
    await page.setViewport({ width: 390, height: 844 })
    await new Promise(r => setTimeout(r, 350))
    await page.screenshot({ path: `${OUT}/${slug}-m.png` })
    const ok = mounted && errors.length === 0
    if (!ok) failures++
    console.log(`${ok ? 'PASS' : 'FAIL'} ${route.padEnd(28)} mounted=${mounted} errors=${errors.length}`)
    errors.slice(0, 4).forEach(e => console.log('     ' + e.slice(0, 220)))
  } catch (e) {
    failures++
    console.log(`FAIL ${route.padEnd(28)} ${e.message}`)
  }
  await page.close()
}
// Interactivity: ⌘K opens the command palette on home.
try {
  const page = await browser.newPage()
  await page.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 25000 })
  await new Promise(r => setTimeout(r, 500))
  await page.keyboard.down('Meta'); await page.keyboard.press('KeyK'); await page.keyboard.up('Meta')
  await new Promise(r => setTimeout(r, 300))
  const palette = await page.$('.cmdk-box')
  console.log(`${palette ? 'PASS' : 'FAIL'} ⌘K command palette opens`)
  if (!palette) failures++
  await page.close()
} catch (e) { console.log('FAIL ⌘K ' + e.message); failures++ }

await browser.close()
console.log(`\n${failures === 0 ? '✅ ALL PASS' : '❌ ' + failures + ' FAILED'}  (screenshots: ${OUT})`)
process.exit(failures === 0 ? 0 : 1)
