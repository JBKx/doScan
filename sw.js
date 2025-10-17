// Cache-first, offline-first
const CACHE = 'biobank-cache-v1';
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './manifest.webmanifest'
];

self.addEventListener('install', evt=>{
  evt.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));
});

self.addEventListener('activate', evt=>{
  evt.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));
});

self.addEventListener('fetch', evt=>{
  evt.respondWith(
    caches.match(evt.request).then(res=> res || fetch(evt.request).then(net=>{
      return caches.open(CACHE).then(c=>{ c.put(evt.request, net.clone()); return net; });
    }).catch(()=>caches.match('./index.html')))
  );
});
