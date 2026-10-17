declare const __BUILD_ID__: string
let checking = false
function reloadOnce(version: string) {
  const key = `blitz:reload:${version}`
  try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, '1') } catch { /* storage may be unavailable */ }
  location.reload()
}
async function checkBuild() {
  if (import.meta.env.DEV || checking) return
  checking = true
  try {
    const r = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' })
    if (!r.ok) return
    const v = await r.json()
    if (typeof v.buildId === 'string' && /^[a-f0-9]{16}$/.test(v.buildId) && v.buildId !== __BUILD_ID__) reloadOnce(v.buildId)
  } catch { /* Offline tabs remain usable. */ } finally { checking = false }
}
window.addEventListener('vite:preloadError', event => { event.preventDefault(); reloadOnce(__BUILD_ID__ + ':chunk') })
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkBuild() })
setInterval(checkBuild, 15000)
checkBuild()
