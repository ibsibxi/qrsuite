/*! QRSuite v2 · Service Worker —— 让网页可安装到手机桌面并离线使用
 *  策略：静态资源 cache-first，导航请求 network-first 回退缓存。
 *  注意：Service Worker 只在 http(s) 下生效（file:// 不可用）。
 */
const CACHE = 'qrsuite-v2.2.1';
const ASSETS = [
  './', './index.html', './style.css', './lang.css', './app.js', './i18n.js', './decode.js', './decode.worker.js',
  './gen.js', './stylized.js',
  './vendor/jsQR.js', './vendor/zxing.min.js',
  // 生成库（MIT）本地打包，不引用 CDN
  './vendor/qrcode-generator.js', './vendor/qrcode-generator-utf8.js',
  './manifest.webmanifest', './icon-192.png', './icon-512.png', './manual.html', './selftest-qr.png'
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.allSettled(ASSETS.map(u => c.add(new Request(u, { cache: 'reload' }))));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                       // /api/decode 等 POST 直接走网络
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;             // 跨域一律不拦截

  if (req.mode === 'navigate') {                          // 页面：先网络，离线回退缓存
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const c = await caches.open(CACHE); c.put('./index.html', fresh.clone());
        return fresh;
      } catch (err) {
        return (await caches.match('./index.html')) || (await caches.match('./')) || Response.error();
      }
    })());
    return;
  }

  e.respondWith((async () => {                            // 静态资源：缓存优先
    const hit = await caches.match(req);
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res && res.status === 200 && res.type === 'basic') {
        const c = await caches.open(CACHE); c.put(req, res.clone());
      }
      return res;
    } catch (err) {
      return new Response('', { status: 504, statusText: 'offline' });
    }
  })());
});
