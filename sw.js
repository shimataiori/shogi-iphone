/* オフライン用キャッシュ + cross-origin isolation 用ヘッダ付与。
   やねうら王 WASM のスレッド動作には SharedArrayBuffer が必要で、
   そのためにはページが cross-origin isolated である必要がある。
   配信サーバが COOP/COEP ヘッダを付けない場合でも、この Service Worker が
   ナビゲーション応答へヘッダを付けて返す（HTTPS配信時のみ有効）。 */
const CACHE = "shogi-iphone-proto-v1";
const ASSETS = [
  "./",
  "index.html",
  "engine-worker.js",
  "manifest.webmanifest",
  "engine/yaneuraou.js",
  "engine/yaneuraou.wasm",
  "engine/eval/nn.bin",
  "engine/eval/progress.bin",
];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", (e) => {
  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const headers = new Headers(res.headers);
          headers.set("Cross-Origin-Opener-Policy", "same-origin");
          headers.set("Cross-Origin-Embedder-Policy", "require-corp");
          headers.set("Cross-Origin-Resource-Policy", "same-origin");
          return new Response(res.body, {
            status: res.status, statusText: res.statusText, headers,
          });
        })
        .catch(() => caches.match("index.html", { ignoreSearch: true }))
    );
    return;
  }
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request)));
});
