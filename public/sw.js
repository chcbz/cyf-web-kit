const CACHE_VERSION = 'cyf-pwa-v20260606-1'
const APP_SHELL = ['/', '/index.html', '/manifest.webmanifest']

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys
        .filter(key => key !== CACHE_VERSION)
        .map(key => caches.delete(key))
    )).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', event => {
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

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone()
          caches.open(CACHE_VERSION).then(cache => cache.put('/index.html', copy)).catch(() => {})
          return response
        })
        .catch(async () => {
          const cached = await caches.match('/index.html')
          return cached || caches.match('/')
        })
    )
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
