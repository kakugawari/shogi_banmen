/* 盤あわせ — オフライン用のサービスワーカー
 *
 * 通信を先に試し、だめならキャッシュから出す（キャッシュ優先にはしない）。
 * キャッシュを先に返すと、直したのに古い画面が出る。作っている最中は
 * これがいちばん困るので、つながっているときは必ず最新を取りにいく。
 *
 * つながらない・遅いときだけキャッシュに落ちる。落ちる境目は TIMEOUT。
 */
"use strict";

/* 中身を入れ替えたら、この名前を上げる。古いものは activate で捨てる。
 * 通信優先なので、つながっていればキャッシュは毎回上書きされる。 */
const CACHE = "ban-awase-v1";
const TIMEOUT = 3000;

const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./core.js",
  "./app.js",
  "./manifest.webmanifest",
  "./icon.svg",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-512-maskable.png",
  "./apple-touch-icon.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      /* 1つ欠けても止めない。1枚足りないせいで全部オフラインにならないほうが困る */
      .then((c) => Promise.all(ASSETS.map((u) => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const withTimeout = (p, ms) => Promise.race([
  p,
  new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))
]);

async function netFirst(req) {
  /* 取れたぶんは必ずキャッシュへ入れる。この約束は時間切れとは別に走らせておく。
   * レースに巻きこむと、遅かったときにキャッシュが更新されないままになる。 */
  const net = fetch(req).then((res) => {
    if (res && res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
    }
    return res;
  });
  net.catch(() => {});                     /* レースに負けたときの未処理拒否よけ */

  try {
    return await withTimeout(net, TIMEOUT);
  } catch (e) {
    const hit = await caches.match(req, { ignoreSearch: true });
    if (hit) return hit;
    /* ページそのものが無いときは index.html を出す。真っ白よりはよい */
    if (req.mode === "navigate") {
      const index = await caches.match("./index.html");
      if (index) return index;
    }
    return new Response("つながりませんでした", {
      status: 504,
      headers: { "Content-Type": "text/plain; charset=utf-8" }
    });
  }
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  if (new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(netFirst(req));
});
