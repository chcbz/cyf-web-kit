const CACHE_VERSION = 'cyf-pwa-v20260918-hall-account-avatar-only-r2'
const APP_SHELL = ['/', '/demo', '/index.html', '/manifest.webmanifest']
const DEVELOPMENT_HOSTS = ['localhost', '127.0.0.1']

const isDevelopmentOrigin = () => DEVELOPMENT_HOSTS.includes(self.location.hostname)

const cleanupDevelopmentCache = async () => {
  const keys = await caches.keys()
  await Promise.all(keys.map(key => caches.delete(key)))
  await self.registration.unregister()
}

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})

self.addEventListener('install', event => {
  if (isDevelopmentOrigin()) {
    event.waitUntil(cleanupDevelopmentCache().then(() => self.skipWaiting()))
    return
  }

  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', event => {
  if (isDevelopmentOrigin()) {
    event.waitUntil(cleanupDevelopmentCache().then(() => self.clients.claim()))
    return
  }

  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys
        .filter(key => key !== CACHE_VERSION)
        .map(key => caches.delete(key))
    )).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', event => {
  if (isDevelopmentOrigin()) {
    return
  }

  const { request } = event

  if (request.method !== 'GET') {
    return
  }

  const url = new URL(request.url)

  if (url.origin !== self.location.origin) {
    return
  }

  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws/')) {
    return
  }

  const isAppShell = request.mode === 'navigate' || APP_SHELL.includes(url.pathname)
  if (isAppShell) {
    // A stable worker can survive many application releases. Revalidate the entry
    // instead of serving yesterday's HTML or relying on a CACHE_VERSION bump.
    const cacheKey = request.mode === 'navigate' ? '/index.html' : request
    const networkRequest = new Request(request, {
      cache: request.cache === 'no-store' ? 'no-store' : 'no-cache'
    })
    event.respondWith(
      fetch(networkRequest)
        .then(response => {
          if (response.ok && !response.redirected && request.cache !== 'no-store') {
            const copy = response.clone()
            event.waitUntil(caches.open(CACHE_VERSION)
              .then(cache => cache.put(cacheKey, copy)).catch(() => {}))
          }
          // HTTP failures are real responses, not permission to present old success.
          return response
        })
        .catch(async error => {
          if (request.cache === 'no-store') throw error
          const cache = await caches.open(CACHE_VERSION)
          const cached = await cache.match(cacheKey)
          if (cached) return cached
          if (request.mode === 'navigate') {
            const fallback = await cache.match('/')
            if (fallback) return fallback
          }
          throw error
        })
    )
    return
  }

  // Honor explicit diagnostic/download freshness for non-shell resources too.
  if (request.cache === 'no-store' || request.cache === 'reload') {
    event.respondWith(fetch(request))
    return
  }

  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) {
        return cached
      }

      return fetch(request).then(response => {
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response
        }

        const copy = response.clone()
        caches.open(CACHE_VERSION).then(cache => cache.put(request, copy)).catch(() => {})
        return response
      })
    })
  )
})
