const CACHE='veo-vercel-2026-11-21-mapa-movil';
const CORE=['/','/index.html','/assets/app.css','/assets/crm.js','/assets/mapa-fluido.js','/assets/geoverificacion.js','/assets/geo-foto.js','/assets/google-mapa.js','/assets/vendor/markerclusterer-2.5.3.min.js','/assets/trazados.js','/assets/datos-corredores.js','/assets/gestos-moviles.js','/assets/media/veo-icon-192.png'];
self.addEventListener('install',ev=>{ev.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)));self.skipWaiting()});
self.addEventListener('activate',ev=>{ev.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim()});
self.addEventListener('fetch',ev=>{
 const req=ev.request,url=new URL(req.url);
 if(req.method!=='GET'||url.origin!==self.location.origin)return;
 if(url.pathname==='/'||url.pathname==='/index.html'){ev.respondWith(fetch(req).catch(()=>caches.match('/index.html')));return;}
 if(url.pathname.startsWith('/assets/')){ev.respondWith(fetch(req).then(r=>{if(r.ok){const clone=r.clone();caches.open(CACHE).then(c=>c.put(req,clone)).catch(()=>{})}return r}).catch(()=>caches.match(req)));}
});
