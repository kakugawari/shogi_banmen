/*
 * ブラウザで実際に動かして確かめるテスト。
 *
 *   npm i -D playwright && npm run test:ui
 *
 * 本物のブラウザを立ち上げ、作った盤の写真を file 入力に流しこんで、
 * 指の操作をそのまま再現する。画面まわりの不具合は node のテストでは捕まらない。
 *
 * ★ 直した不具合には、かならず見張り役をここに置くこと。
 */
const { spawn } = require('node:child_process');
const path = require('node:path');
const http = require('node:http');
const fs = require('node:fs');

const PORT = Number(process.env.PORT || 8124);
const URL = `http://localhost:${PORT}/`;
const ROOT = __dirname;
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';

let passed = 0, failed = 0;
const ok = (c, m) => { c ? (passed++, console.log('  \x1b[32m✓\x1b[0m ' + m))
                         : (failed++, console.log('  \x1b[31m✗ FAIL\x1b[0m ' + m)); };
const section = (n) => console.log('\n' + n);

function waitForServer() {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => http.get(URL, (r) => { r.resume(); resolve(); })
      .on('error', () => Date.now() - t0 > 10000 ? reject(new Error('サーバーが起動しない'))
                                                 : setTimeout(tick, 100));
    tick();
  });
}

/*
 * 狙っている撮り方をそのまま作る:
 *   1080x1920 の縦、真上から、盤が横幅の 9 割 (960px = 1マス 106.7px)。
 * 盤の ９一 のマスにだけ黒い印を置く。向きを取り違えたら、これが動く。
 */
const BOARD = { x: 60, y: 400, size: 960 };
const CORNERS = [
  { x: BOARD.x, y: BOARD.y },
  { x: BOARD.x + BOARD.size, y: BOARD.y },
  { x: BOARD.x + BOARD.size, y: BOARD.y + BOARD.size },
  { x: BOARD.x, y: BOARD.y + BOARD.size }
];

const MAKE_PHOTO = ({ x, y, size }) => `
  const cv = document.createElement('canvas');
  cv.width = 1080; cv.height = 1920;
  const g = cv.getContext('2d');
  g.fillStyle = '#3a3a3a'; g.fillRect(0, 0, 1080, 1920);
  g.fillStyle = '#E8C88A'; g.fillRect(${x}, ${y}, ${size}, ${size});
  g.strokeStyle = '#6B4A20'; g.lineWidth = 2;
  g.beginPath();
  for (let i = 0; i <= 9; i++) {
    const t = ${x} + i * ${size} / 9, u = ${y} + i * ${size} / 9;
    g.moveTo(t, ${y}); g.lineTo(t, ${y + size});
    g.moveTo(${x}, u); g.lineTo(${x + size}, u);
  }
  g.stroke();
  // 画面の左上のマスにだけ印。先手が手前なら ９一 になる
  g.fillStyle = '#111';
  g.fillRect(${x} + 20, ${y} + 20, ${size / 9 - 40}, ${size / 9 - 40});
  const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
  const file = new File([blob], 'ban.png', { type: 'image/png' });
  const dt = new DataTransfer();
  dt.items.add(file);
  const input = document.getElementById('file');
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
`;

/** 直した盤の、マス (cx,cy) の真ん中の明るさ */
const cellLuma = (page, cx, cy) => page.evaluate(({ cx, cy }) => {
  const cv = document.getElementById('board');
  const px = Math.round((cx + 0.5) * cv.width / 9);
  const py = Math.round((cy + 0.5) * cv.height / 9);
  const d = window.__app.boardPixel(px, py);
  return Math.round((d[0] + d[1] + d[2]) / 3);
}, { cx, cy });

async function run() {
  let chromium, devices;
  try { ({ chromium, devices } = require('playwright')); }
  catch (e) { console.error('playwright が必要です:  npm i -D playwright'); process.exit(1); }

  const server = spawn(process.execPath, [path.join(ROOT, 'serve.js'), String(PORT)], { stdio: 'ignore' });
  await waitForServer();

  const browser = await chromium.launch({ executablePath: CHROMIUM });
  const errors = [];

  try {
    section('スマホで開く');
    const ctx = await browser.newContext({ ...devices['iPhone 13'] });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push('スマホ: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('スマホ: ' + m.text()); });
    await page.goto(URL);
    await page.waitForFunction(() => window.__app);
    ok(true, 'ページが開いて、画面のしくみが立ち上がる');
    ok(await page.locator('#s3').isHidden(), '写真をえらぶ前は、四隅あわせが出ていない');

    section('写真をえらぶ');
    await page.evaluate(`(async () => {${MAKE_PHOTO(BOARD)}})()`);
    await page.waitForFunction(() => window.__app.state().pixels);
    const info = await page.textContent('#fileInfo');
    ok(/1080×1920/.test(info) && /縦/.test(info), `大きさと向きが出る (${info})`);
    ok(await page.locator('#s2').isHidden(), '写真のときは、コマ送りが出ない');
    ok(await page.locator('#s5').isVisible(), '直した盤の欄が出る');

    section('合わせる前に満点を出さない');
    const before = await page.evaluate(() => ({
      touched: window.__app.state().touched,
      text: document.getElementById('checks').textContent
    }));
    ok(before.touched === false, '四隅をまだ動かしていない状態から始まる');
    ok(/まだ盤に合わせていません/.test(before.text), '合わせる前は点検の結果を出さない');
    ok(!/ぴったり真上/.test(before.text), 'はじめの四隅（真四角）で満点を出さない');

    section('四隅を合わせる');
    await page.evaluate((cs) => window.__app.setCorners(cs), CORNERS);
    const judged = await page.evaluate(() => window.__app.judge());
    judged.forEach(j => ok(j.level === 'ok', `${j.label}: ${j.value}`));
    const m = await page.evaluate(() => window.__app.metrics());
    ok(Math.abs(m.cellPx - 960 / 9) < 0.01, `1マス ${m.cellPx.toFixed(1)} 画素`);

    section('先手はどちら側 (上下の取り違え見張り)');
    await page.evaluate(() => window.__app.setSide('near'));
    let a = await cellLuma(page, 0, 0), b = await cellLuma(page, 8, 8);
    ok(a < 60, `手前: ９一 が印のマスになる (明るさ ${a})`);
    ok(b > 150, `手前: １九 は印ではない (明るさ ${b})`);

    await page.evaluate(() => window.__app.setSide('far'));
    let c = await cellLuma(page, 0, 0), d = await cellLuma(page, 8, 8);
    ok(c > 150, `奥: ９一 が印ではなくなる (明るさ ${c})`);
    ok(d < 60, `奥: 印は １九 に移る (明るさ ${d})`);
    await page.evaluate(() => window.__app.setSide('near'));

    section('指で四隅を動かす');
    const box = await page.locator('#shot').boundingBox();
    const k = box.width / 1080;                      /* 画像 → 画面 */
    const at = (p) => ({ x: box.x + p.x * k, y: box.y + p.y * k });
    const from = at(CORNERS[0]), to = at({ x: CORNERS[0].x + 120, y: CORNERS[0].y + 120 });
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 10, from.y + 10);
    const loupeShown = await page.locator('#loupe').isVisible();
    await page.mouse.move(to.x, to.y);
    await page.mouse.up();
    ok(loupeShown, 'つまんでいる間、虫めがねが出る');
    ok(await page.locator('#loupe').isHidden(), '離すと虫めがねが消える');
    const moved = await page.evaluate(() => window.__app.state().corners[0]);
    ok(Math.abs(moved.x - (CORNERS[0].x + 120)) < 25 && Math.abs(moved.y - (CORNERS[0].y + 120)) < 25,
      `①だけが指についてきた (${Math.round(moved.x)}, ${Math.round(moved.y)})`);
    const others = await page.evaluate(() => window.__app.state().corners.slice(1));
    ok(others.every((p, i) => p.x === CORNERS[i + 1].x && p.y === CORNERS[i + 1].y),
      'ほかの三隅は動いていない');

    ok(await page.evaluate(() => window.__app.state().touched), '動かしたので点検が始まる');
    const bad = await page.evaluate(() => window.__app.judge().find(j => j.key === 'taper'));
    ok(bad.level !== 'ok', `四隅をずらすと、真上の項目が ${bad.level} になる (${bad.value})`);

    await page.locator('#reset').click();
    const reset = await page.evaluate(() => ({
      touched: window.__app.state().touched,
      text: document.getElementById('checks').textContent
    }));
    ok(reset.touched === false && /まだ盤に合わせていません/.test(reset.text),
      '「はじめの位置に戻す」で、合わせていない状態にも戻る');
    await page.evaluate((cs) => window.__app.setCorners(cs), CORNERS);

    section('速さ');
    const ms = await page.evaluate(() => window.__app.state().lastMs);
    ok(ms < 1500, `盤を直すのに ${ms} ミリ秒 (720画素まで)`);

    section('アイコン');
    const icons = await page.evaluate(() => ({
      apple: document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href'),
      manifest: document.querySelector('link[rel="manifest"]')?.getAttribute('href'),
      title: document.querySelector('meta[name="apple-mobile-web-app-title"]')?.content
    }));
    /* iOS は apple-touch-icon に SVG を使えない。使うと別のものが出る */
    ok(/\.png$/.test(icons.apple || ''), `ホーム画面用アイコンが PNG (${icons.apple})`);
    for (const f of [icons.apple, icons.manifest, 'icon-192.png', 'icon-512.png',
                     'icon-512-maskable.png', 'icon.svg']) {
      const res = await page.request.get(URL + f.replace('./', ''));
      ok(res.ok(), `${f} が配信される`);
    }
    ok(icons.title === '盤あわせ', `ホーム画面の名前 (${icons.title})`);

    section('画面');
    const fit = await page.evaluate(() => ({
      wide: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      title: document.querySelector('h1').textContent.trim()
    }));
    ok(fit.wide <= 1, 'スマホ幅で横スクロールが出ない');
    ok(fit.title === '盤あわせ', `見出しが出ている (${fit.title})`);

    const colors = await page.evaluate(() => ({
      bg: getComputedStyle(document.body).backgroundColor,
      fg: getComputedStyle(document.body).color
    }));
    ok(colors.bg !== colors.fg, `文字と背景の色が違う (${colors.bg} / ${colors.fg})`);

    section('更新とオフライン');
    const swCtx = await browser.newContext({ ...devices['iPhone 13'] });
    const sw = await swCtx.newPage();
    await sw.goto(URL);
    await sw.waitForFunction(() => window.__app);
    ok(await sw.evaluate(() => navigator.serviceWorker.ready.then((r) => !!r.active).catch(() => false)),
      'サービスワーカーが動く');
    await sw.waitForTimeout(800);

    /* 直したものが 1 回のリロードで出るか。
     * キャッシュ優先だとここで古い見出しが出る（kifu で踏んだやつ） */
    const indexPath = path.join(ROOT, 'index.html');
    const original = fs.readFileSync(indexPath, 'utf8');
    fs.writeFileSync(indexPath, original.replace('<h1>盤あわせ</h1>', '<h1>こうしんかくにん</h1>'));
    await sw.reload();
    await sw.waitForTimeout(400);
    const shown = (await sw.textContent('h1')).trim();
    fs.writeFileSync(indexPath, original);
    ok(shown === 'こうしんかくにん', `直したものが 1 回のリロードで出る (${shown})`);

    await sw.reload();                       /* 元に戻したものを、もう一度キャッシュへ */
    await sw.waitForTimeout(500);
    await swCtx.setOffline(true);
    await sw.reload().catch(() => {});
    await sw.waitForTimeout(400);
    ok(await sw.evaluate(() => !!window.__app).catch(() => false),
      'ネットにつながらなくても開ける');
    ok((await sw.textContent('h1')).trim() === '盤あわせ', 'オフラインでも中身は最新のもの');
    await swCtx.setOffline(false);
    await swCtx.close();

    section('エラー');
    ok(errors.length === 0, errors.length ? '画面のエラー: ' + errors.join(' / ') : 'JS エラーなし');
  } finally {
    await browser.close();
    server.kill();
  }

  console.log(`\n${passed} 件合格 / ${failed} 件失敗`);
  process.exit(failed ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });
