const loaded = new Set()

export function loadScript(url) {
  if (loaded.has(url)) return Promise.resolve()
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${url}"]`)) { loaded.add(url); return resolve() }
    const s = document.createElement('script')
    s.src = url
    s.onload = () => { loaded.add(url); resolve() }
    s.onerror = () => reject(new Error(`Script load failed`))
    document.head.appendChild(s)
  })
}
