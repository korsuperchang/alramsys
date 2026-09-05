// 오프라인에서도 앱이 뜨도록 정적 파일만 캐시한다. 카메라 영상은 절대 저장하지 않는다.
//
// 주의: 버전을 올리면 예전 캐시가 통째로 버려진다. 파일을 바꿀 때마다 올릴 것.
// (js/app.js 의 APP_VERSION 과 같이 맞춘다)
const VERSION = 11;
const CACHE = `toycar-speed-v${VERSION}`;
const ASSETS = [
  './',
  'index.html',
  'css/styles.css',
  'js/app.js',
  'js/detector.js',
  'js/tracker.js',
  'js/stabilizer.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  // HTML과 스크립트는 네트워크를 먼저 본다. 저장본을 먼저 주면 새로 배포해도
  // 예전 화면이 그대로 떠서 "안 바뀐다"가 된다. 오프라인일 때만 저장본으로 넘어간다.
  const isDocument = req.mode === 'navigate' || req.destination === 'document'
    || req.destination === 'script' || req.destination === 'style';

  if (isDocument) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match('index.html'))),
    );
    return;
  }

  // 나머지(아이콘 등)는 저장본을 먼저 주고 뒤에서 갱신한다.
  event.respondWith(
    caches.match(req).then((hit) => {
      const network = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => hit);
      return hit || network;
    }),
  );
});
