/* オフライン用キャッシュ + cross-origin isolation 用ヘッダ付与。
   やねうら王 WASM のスレッド動作には SharedArrayBuffer が必要で、
   そのためにはページが cross-origin isolated である必要がある。
   配信サーバが COOP/COEP ヘッダを付けない場合でも、この Service Worker が
   ナビゲーション応答へヘッダを付けて返す（HTTPS配信時のみ有効）。 */
const CACHE = "shogi-iphone-proto-v10";
const ASSETS = [
  "./",
  "index.html",
  "engine-worker.js",
  "manifest.webmanifest",
  "engine/yaneuraou.js",
  "engine/yaneuraou.wasm",
  "engine/yaneuraou.worker.js",
  "engine/eval/nn.bin",
  "engine/eval/progress.bin",
];
self.addEventListener("install", (e) => {
  // 1ファイルの取得失敗でインストール全体が失敗しないよう、個別にキャッシュする。
  // （分離に必要なのは fetch ハンドラであり、キャッシュはオフライン用）
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.allSettled(ASSETS.map(a => c.add(a)));
    await self.skipWaiting();
  })());
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
function withIsoHeaders(res) {
  const headers = new Headers(res.headers);
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Embedder-Policy", "require-corp");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  return new Response(res.body, {
    status: res.status, statusText: res.statusText, headers,
  });
}
self.addEventListener("fetch", (e) => {
  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request)
        .then(withIsoHeaders)
        .catch(() => caches.match("index.html", { ignoreSearch: true }).then(hit => hit && withIsoHeaders(hit)))
    );
    return;
  }
  // Workerスクリプト（engine-worker.js や pthread用 yaneuraou.worker.js）は、
  // 文書がCOEP有効な場合、スクリプト自の応答にもCOEPヘッダがないと
  // ブラウザにブロックされ、Workerが評価すらされずにエラーになる。
  // そのためナビゲーション以外の応答にも分離ヘッダを付けて返す。
  // なお engine-worker.js は更新を即時反映したいのでネットワーク優先にする
  // （キャッシュ優先だと旧版が残り続け、修正が届かないため）。
  if (e.request.url.endsWith("engine-worker.js")) {
    e.respondWith(
      fetch(e.request)
        .then(withIsoHeaders)
        .catch(() => caches.match(e.request, { ignoreSearch: true }).then(hit => hit && withIsoHeaders(hit)))
    );
    return;
  }
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true })
      .then(hit => hit || fetch(e.request))
      .then(withIsoHeaders)
  );
});
