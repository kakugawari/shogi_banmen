const test = require('node:test');
const assert = require('node:assert');
const C = require('./core.js');

const near = (a, b, tol, msg) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} と ${b} の差が ${tol} を超えた`);

/* 画面で拾う順は いつも [左上, 右上, 右下, 左下] */
const square = [{ x: 100, y: 100 }, { x: 400, y: 100 }, { x: 400, y: 400 }, { x: 100, y: 400 }];
/* 1080x1920 の縦動画で、盤が横幅の 9 割を占めたときの形。実際に狙う撮り方 */
const big = [{ x: 60, y: 100 }, { x: 1020, y: 100 }, { x: 1020, y: 1060 }, { x: 60, y: 1060 }];
/* 上辺が短い＝奥がすぼまった台形 (斜めから撮った形) */
const trapez = [{ x: 150, y: 100 }, { x: 350, y: 100 }, { x: 420, y: 400 }, { x: 80, y: 400 }];

/* ==================== 射影変換 ==================== */

test('四隅がそのまま四隅へ写る (真上・平行四辺形)', () => {
  const H = C.homography(square);
  const uv = [[0, 0], [1, 0], [1, 1], [0, 1]];
  uv.forEach(([u, v], i) => {
    const p = C.project(H, u, v);
    near(p.x, square[i].x, 1e-9, `${i}番目の x`);
    near(p.y, square[i].y, 1e-9, `${i}番目の y`);
  });
});

test('四隅がそのまま四隅へ写る (斜め・台形)', () => {
  const H = C.homography(trapez);
  const uv = [[0, 0], [1, 0], [1, 1], [0, 1]];
  uv.forEach(([u, v], i) => {
    const p = C.project(H, u, v);
    near(p.x, trapez[i].x, 1e-9, `${i}番目の x`);
    near(p.y, trapez[i].y, 1e-9, `${i}番目の y`);
  });
});

test('真上なら g と h は 0。斜めなら 0 でない', () => {
  const flat = C.homography(square);
  assert.strictEqual(flat.g, 0);
  assert.strictEqual(flat.h, 0);
  const tilt = C.homography(trapez);
  assert.ok(Math.abs(tilt.g) + Math.abs(tilt.h) > 1e-6, '台形なのに真上あつかいされた');
});

test('逆変換で元の (u,v) に戻る', () => {
  const H = C.homography(trapez);
  const Hi = C.invert(H);
  for (const [u, v] of [[0, 0], [1, 1], [0.5, 0.5], [0.13, 0.87], [1, 0]]) {
    const p = C.project(H, u, v);
    const back = C.project(Hi, p.x, p.y);
    near(back.x, u, 1e-9, `u=${u}`);
    near(back.y, v, 1e-9, `v=${v}`);
  }
});

test('つぶれた四隅では null を返す (例外を投げない)', () => {
  const line = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 30, y: 0 }];
  assert.strictEqual(C.homography(line), null);
  const dot = [{ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 5 }];
  assert.strictEqual(C.homography(dot), null);
  assert.strictEqual(C.homography([{ x: NaN, y: 0 }, ...square.slice(1)]), null);
  assert.strictEqual(C.homography(null), null);
  assert.strictEqual(C.project(null, 0, 0), null);
});

/* ==================== 盤の向き ====================
 * ここが取り違えると棋譜がまるごと裏返る。いちばん厚く見張る。
 */

test('先手が手前(下)なら、画面の左上が ９一', () => {
  const H = C.boardH(square, 'near');
  const p = C.cellCenter(H, 0, 0);              /* x=0,y=0 は 9筋一段 */
  assert.ok(p.x < 250 && p.y < 250, `９一が左上に来ない: ${JSON.stringify(p)}`);
  const q = C.cellCenter(H, 8, 8);              /* 1筋九段 */
  assert.ok(q.x > 250 && q.y > 250, `１九が右下に来ない: ${JSON.stringify(q)}`);
});

test('先手が奥(上)なら、画面の右下が ９一 (180度まわる)', () => {
  const H = C.boardH(square, 'far');
  const p = C.cellCenter(H, 0, 0);
  assert.ok(p.x > 250 && p.y > 250, `９一が右下に来ない: ${JSON.stringify(p)}`);
  const q = C.cellCenter(H, 8, 8);
  assert.ok(q.x < 250 && q.y < 250, `１九が左上に来ない: ${JSON.stringify(q)}`);
});

test('手前と奥は、同じマスがちょうど点対称になる', () => {
  const a = C.boardH(square, 'near');
  const b = C.boardH(square, 'far');
  for (const [x, y] of [[0, 0], [4, 4], [8, 0], [2, 7]]) {
    const p = C.cellCenter(a, x, y);
    const q = C.cellCenter(b, x, y);
    near((p.x + q.x) / 2, 250, 1e-6, `(${x},${y}) の x が盤の中心にならない`);
    near((p.y + q.y) / 2, 250, 1e-6, `(${x},${y}) の y が盤の中心にならない`);
  }
});

test('マスの名前は先手から見た筋と段になる', () => {
  assert.strictEqual(C.squareName(0, 0), '９一');
  assert.strictEqual(C.squareName(8, 8), '１九');
  assert.strictEqual(C.squareName(8, 0), '１一');
  assert.strictEqual(C.squareName(0, 8), '９九');
  assert.strictEqual(C.squareName(4, 4), '５五');
  assert.strictEqual(C.squareName(9, 0), '');
});

test('81マスが重ならず、盤の中に収まる', () => {
  const H = C.boardH(square, 'near');
  const seen = new Set();
  for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) {
    const p = C.cellCenter(H, x, y);
    assert.ok(p.x > 100 && p.x < 400 && p.y > 100 && p.y < 400, `(${x},${y}) が盤の外`);
    const key = Math.round(p.x) + ',' + Math.round(p.y);
    assert.ok(!seen.has(key), `(${x},${y}) が別のマスと重なった`);
    seen.add(key);
  }
  assert.strictEqual(seen.size, 81);
});

test('cellQuad を内側へ縮めると、線をまたがない', () => {
  const H = C.boardH(square, 'near');
  const cell = 300 / 9;
  const q = C.cellQuad(H, 0, 0, 0.2);
  const w = Math.hypot(q[1].x - q[0].x, q[1].y - q[0].y);
  near(w, cell * 0.6, 1e-6, '縮めた幅');
});

/* ==================== 撮り方の点検 ==================== */

test('狙っている撮り方 (1080幅の9割) なら、すべて ok', () => {
  const m = C.shotMetrics(big);
  near(m.taper, 1, 1e-12, '台形の度合い');
  near(m.rotationDeg, 0, 1e-12, '回転');
  near(m.cellPx, 960 / 9, 1e-9, '1マスの画素数');   /* 106.7 画素/マス */
  C.judge(m).forEach(j => assert.strictEqual(j.level, 'ok', `${j.label} が ok でない`));
});

test('台形がきついと、真上の項目が bad になる', () => {
  const m = C.shotMetrics(trapez);
  assert.ok(m.taper > 1.3, `台形の度合いが小さすぎる: ${m.taper}`);
  const t = C.judge(m).find(j => j.key === 'taper');
  assert.strictEqual(t.level, 'bad');
});

test('盤が小さすぎると、1マスの項目が bad になる', () => {
  const tiny = [{ x: 0, y: 0 }, { x: 90, y: 0 }, { x: 90, y: 90 }, { x: 0, y: 90 }];
  const j = C.judge(C.shotMetrics(tiny)).find(x => x.key === 'cell');
  assert.strictEqual(j.level, 'bad');          /* 90/9 = 10画素 */
});

test('回転は ±45° に丸めて出す', () => {
  const rot = (deg) => {
    const r = deg * Math.PI / 180, cs = Math.cos(r), sn = Math.sin(r);
    return square.map(p => {
      const x = p.x - 250, y = p.y - 250;
      return { x: 250 + x * cs - y * sn, y: 250 + x * sn + y * cs };
    });
  };
  near(C.shotMetrics(rot(5)).rotationDeg, 5, 1e-9, '5度');
  near(C.shotMetrics(rot(-7)).rotationDeg, -7, 1e-9, 'マイナス7度');
  near(C.shotMetrics(rot(92)).rotationDeg, 2, 1e-9, '92度は2度と同じ');
});

test('shotMetrics は先手の向きに影響されない', () => {
  const a = C.shotMetrics(square);
  const b = C.shotMetrics(C.orientQuad(square, 'far'));
  near(a.taper, b.taper, 1e-12, '台形の度合い');
  near(a.cellPx, b.cellPx, 1e-12, '1マスの画素数');
});

/* ==================== 画像をまっすぐに直す ====================
 *
 * 既知の変換でわざと歪ませた市松模様を作り、直したら元に戻るかを見る。
 * 原点や真四角だけで試すと、ずれていても差が出ないので台形で試す。
 */
function fakePhoto(quad, w, h) {
  const H = C.homography(quad);
  const Hi = C.invert(H);
  const src = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = C.project(Hi, x + 0.5, y + 0.5);
    const at = (y * w + x) * 4;
    src[at + 3] = 255;
    if (p.x < 0 || p.x >= 1 || p.y < 0 || p.y >= 1) continue;   /* 盤の外は黒 */
    const on = (Math.floor(p.x * 9) + Math.floor(p.y * 9)) % 2 === 0;
    const v = on ? 230 : 40;
    src[at] = v; src[at + 1] = v; src[at + 2] = v;
  }
  return { src, H };
}

test('歪んだ市松模様を直すと、きれいな 9x9 に戻る', () => {
  const W = 500, Hh = 500, OUT = 288;           /* 288 / 9 = 32 画素/マス */
  const { src, H } = fakePhoto(trapez, W, Hh);
  const out = C.rectify(src, W, Hh, H, OUT, OUT);

  let wrong = 0;
  for (let cy = 0; cy < 9; cy++) for (let cx = 0; cx < 9; cx++) {
    /* マスの真ん中だけを見る。境目は元画像のぼけが乗るので外す */
    const px = Math.round((cx + 0.5) * OUT / 9);
    const py = Math.round((cy + 0.5) * OUT / 9);
    const v = out[(py * OUT + px) * 4];
    const expected = (cx + cy) % 2 === 0 ? 230 : 40;
    if (Math.abs(v - expected) > 12) wrong++;
  }
  assert.strictEqual(wrong, 0, `${wrong} マスの色が合わない`);
});

test('直したあとの端も、ちゃんと盤の中身になっている', () => {
  const W = 500, Hh = 500, OUT = 288;
  const { src, H } = fakePhoto(trapez, W, Hh);
  const out = C.rectify(src, W, Hh, H, OUT, OUT);
  /* 四隅から2画素内側。透明 (＝範囲外を拾った) ではいけない */
  for (const [px, py] of [[2, 2], [OUT - 3, 2], [OUT - 3, OUT - 3], [2, OUT - 3]]) {
    assert.strictEqual(out[(py * OUT + px) * 4 + 3], 255, `(${px},${py}) が盤の外を拾った`);
  }
});

test('outputSize は見た目の縦横比を保ち、max を超えない', () => {
  const wide = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 200 }, { x: 0, y: 200 }];
  const s = C.outputSize(C.shotMetrics(wide), 720);
  assert.strictEqual(s.w, 720);
  assert.strictEqual(s.h, 360);
  assert.ok(Math.max(s.w, s.h) <= 720);
});

test('defaultCorners は画像の中に収まり、左上から時計回りに並ぶ', () => {
  const c = C.defaultCorners(1080, 1920);
  assert.strictEqual(c.length, 4);
  c.forEach(p => assert.ok(p.x >= 0 && p.x <= 1080 && p.y >= 0 && p.y <= 1920, '画像の外'));
  assert.ok(c[0].x < c[1].x, '左上が右上より左');
  assert.ok(c[1].y < c[2].y, '右上が右下より上');
  assert.ok(c[3].x < c[2].x, '左下が右下より左');
});
