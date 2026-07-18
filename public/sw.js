const CACHE_VERSION = 'cyf-pwa-v20260718-juyiting-redfix'
const APP_SHELL = ['/', '/index.html', '/manifest.webmanifest']
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
