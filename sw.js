const CACHE_NAME = 'vt-pro-v5';
const ASSETS = ['./', './index.html', './style.css', './script.js', './manifest.json'];

self.addEventListener('install', e => {
    e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
    self.skipWaiting();
});

self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', e => {
    // Network-First strategy: always try the network first to guarantee fresh code, fallback to cache if offline
    e.respondWith(
        fetch(e.request)
            .then(res => {
                // If successful, clone response and update cache
                if (res.status === 200) {
                    const resClone = res.clone();
                    caches.open(CACHE_NAME).then(c => c.put(e.request, resClone));
                }
                return res;
            })
            .catch(() => caches.match(e.request))
    );
});
