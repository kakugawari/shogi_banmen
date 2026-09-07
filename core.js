/*!
 * core.js — 盤あわせの算数。DOM を触らないので node でテストできる。
 *
 * ブラウザでは <script> で読むと window.Core になり、node からは require() できる。
 *
 * ここでやること:
 *   1. 画面で拾った盤の四隅から、射影変換 (homography) を作る
 *   2. 「先手が手前か奥か」で盤の向きを合わせる
 *   3. 撮り方の良し悪しを数字にする (回転・台形の度合い・1マスの画素数)
 *   4. 歪んだ盤の画像を、まっすぐな正方形に直す
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    root.Core = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var N = 9;                                  /* 9 x 9 */
  var ZEN = '０１２３４５６７８９';
  var KAN = '〇一二三四五六七八九';

  /* ==================== 射影変換 ====================
   *
   * 単位正方形 (0,0) (1,0) (1,1) (0,1) を、与えた四角形の4点へ写す変換。
   *
   *   x = (a*u + b*v + c) / (g*u + h*v + 1)
   *   y = (d*u + e*v + f) / (g*u + h*v + 1)
   *
   * カメラが真上から見ていれば g と h は 0 に近づく (＝ただの平行四辺形)。
   * 斜めから見るほど 0 から離れる。この2つが「どれだけ斜めか」そのもの。
   */
  function homography(quad) {
    if (!quad || quad.length !== 4) return null;
    for (var i = 0; i < 4; i++) {
      if (!quad[i] || !isFinite(quad[i].x) || !isFinite(quad[i].y)) return null;
    }
    var x0 = quad[0].x, y0 = quad[0].y;
    var x1 = quad[1].x, y1 = quad[1].y;
    var x2 = quad[2].x, y2 = quad[2].y;
    var x3 = quad[3].x, y3 = quad[3].y;

    var sx = x0 - x1 + x2 - x3;
    var sy = y0 - y1 + y2 - y3;

    var H;
    if (sx === 0 && sy === 0) {
      /* 平行四辺形。奥行きの縮みが無い＝真上から見た形 */
      H = { a: x1 - x0, b: x2 - x1, c: x0,
            d: y1 - y0, e: y2 - y1, f: y0,
            g: 0, h: 0 };
    } else {
      var dx1 = x1 - x2, dx2 = x3 - x2;
      var dy1 = y1 - y2, dy2 = y3 - y2;
      var den = dx1 * dy2 - dx2 * dy1;
      if (den === 0) return null;             /* 4点がつぶれている */
      var g = (sx * dy2 - dx2 * sy) / den;
      var h = (dx1 * sy - sx * dy1) / den;
      H = { a: x1 - x0 + g * x1, b: x3 - x0 + h * x3, c: x0,
            d: y1 - y0 + g * y1, e: y3 - y0 + h * y3, f: y0,
            g: g, h: h };
    }
    for (var k in H) if (!isFinite(H[k])) return null;
    /* 3点が一直線に並んでいたり、同じ点を4回拾ったりすると、写した先が
     * つぶれて戻せなくなる。行列式が 0 かどうかで、まとめて弾く。 */
    var det = H.a * (H.e - H.f * H.h) - H.b * (H.d - H.f * H.g) + H.c * (H.d * H.h - H.e * H.g);
    if (!det || !isFinite(det)) return null;
    return H;
  }

  /** 単位正方形の (u,v) が、画像のどこに来るか */
  function project(H, u, v) {
    if (!H) return null;
    var w = H.g * u + H.h * v + 1;
    if (!w || !isFinite(w)) return null;
    return { x: (H.a * u + H.b * v + H.c) / w, y: (H.d * u + H.e * v + H.f) / w };
  }

  /** 逆変換。画像の (x,y) が単位正方形のどこかを知りたいとき */
  function invert(H) {
    if (!H) return null;
    var a = H.a, b = H.b, c = H.c, d = H.d, e = H.e, f = H.f, g = H.g, h = H.h;
    /* 余因子。3行目は (g, h, 1) */
    var A = e - f * h, B = -(d - f * g), C = d * h - e * g;
    var D = -(b - c * h), E = a - c * g, F = -(a * h - b * g);
    var G = b * f - c * e, I2 = -(a * f - c * d), J = a * e - b * d;
    if (!J || !isFinite(J)) return null;      /* [2][2] が 0 なら戻せない */
    var out = { a: A / J, b: D / J, c: G / J,
                d: B / J, e: E / J, f: I2 / J,
                g: C / J, h: F / J };
    for (var k in out) if (!isFinite(out[k])) return null;
    return out;
  }

  /* ==================== 盤の向き ====================
   *
   * 盤の座標は先手から見た形にそろえる (棋譜アプリ kifu と同じ)。
   *   x = 0 が9筋、x = 8 が1筋。y = 0 が一段目 (先手から見て奥)、y = 8 が九段目。
   *
   * 画面で拾う四隅はいつも [左上, 右上, 右下, 左下] の順。
   * そこから盤の座標へ回すのが、この関数の仕事。
   *
   * カメラは真上から、iPhone は縦。だから「先手が画面の手前(下)か、奥(上)か」の
   * 2つしかない。左右は無い。
   */
  function orientQuad(corners, sente) {
    if (!corners || corners.length !== 4) return null;
    var c = corners;
    /* 'far' は盤ごと180度まわすので、四隅を2つずらす */
    return sente === 'far' ? [c[2], c[3], c[0], c[1]] : [c[0], c[1], c[2], c[3]];
  }

  /** 画面の四隅と「先手はどちら側か」から、盤の変換を作る */
  function boardH(corners, sente) {
    return homography(orientQuad(corners, sente));
  }

  /** 盤のマス (x,y) の中心が、画像のどこに来るか */
  function cellCenter(H, x, y) {
    return project(H, (x + 0.5) / N, (y + 0.5) / N);
  }

  /**
   * マス (x,y) の四隅。inset は内側へ縮める割合 (0〜0.5)。
   * あとで「駒があるか」を見るときは、線をまたがないよう内側だけを見る。
   */
  function cellQuad(H, x, y, inset) {
    var m = inset || 0;
    var u0 = (x + m) / N, u1 = (x + 1 - m) / N;
    var v0 = (y + m) / N, v1 = (y + 1 - m) / N;
    return [project(H, u0, v0), project(H, u1, v0), project(H, u1, v1), project(H, u0, v1)];
  }

  /** (0,0) は ９一、(8,8) は １九 */
  function squareName(x, y) {
    if (x < 0 || x > 8 || y < 0 || y > 8) return '';
    return ZEN[N - x] + KAN[y + 1];
  }

  /* ==================== 撮り方の点検 ====================
   *
   * 第0段の本体。「その撮り方でいけるか」を数字にする。
   * 画面で拾った四隅 [左上, 右上, 右下, 左下] だけを見る (先手の向きは関係ない)。
   */
  function dist(p, q) { return Math.hypot(q.x - p.x, q.y - p.y); }

  function shotMetrics(corners) {
    if (!corners || corners.length !== 4) return null;
    var tl = corners[0], tr = corners[1], br = corners[2], bl = corners[3];
    var top = dist(tl, tr), bottom = dist(bl, br);
    var left = dist(tl, bl), right = dist(tr, br);
    if (!(top > 0 && bottom > 0 && left > 0 && right > 0)) return null;

    /* 盤が画面に対して何度まわっているか。上辺と下辺の平均で見る */
    var ang = function (p, q) { return Math.atan2(q.y - p.y, q.x - p.x); };
    var rot = (ang(tl, tr) + ang(bl, br)) / 2 * 180 / Math.PI;
    while (rot > 45) rot -= 90;
    while (rot <= -45) rot += 90;

    /* 台形の度合い。真上から撮れていれば対辺の長さは同じ＝1.00 */
    var taper = Math.max(top / bottom, bottom / top, left / right, right / left);

    return {
      rotationDeg: rot,
      top: top, bottom: bottom, left: left, right: right,
      taper: taper,
      cellPx: Math.min((top + bottom) / 2, (left + right) / 2) / N,
      aspect: ((top + bottom) / 2) / ((left + right) / 2)
    };
  }

  /**
   * 点検の結果を、そのまま人に見せられる形にする。
   * しきい値の根拠:
   *   taper  1.05 = 奥のマスが手前より5%小さい。ここまでなら真上とみなす
   *   cellPx 60   = 1マス60画素。駒の有無と向きを見るには十分すぎる
   */
  var LIMITS = { taperOk: 1.05, taperWarn: 1.15, cellOk: 60, cellWarn: 36, rotOk: 3, rotWarn: 8 };

  function judge(m) {
    if (!m) return [];
    var out = [];
    var pct = Math.round((m.taper - 1) * 100);
    out.push({
      key: 'taper',
      label: '真上からの度合い',
      value: pct === 0 ? 'ぴったり真上' : '奥と手前でマスの大きさが ' + pct + '% 違う',
      level: m.taper <= LIMITS.taperOk ? 'ok' : (m.taper <= LIMITS.taperWarn ? 'warn' : 'bad'),
      hint: 'カメラを盤の真ん中の真上へ。腕を伸ばして盤から離すほど落ち着く'
    });
    out.push({
      key: 'cell',
      label: '1マスの大きさ',
      value: Math.round(m.cellPx) + ' 画素',
      level: m.cellPx >= LIMITS.cellOk ? 'ok' : (m.cellPx >= LIMITS.cellWarn ? 'warn' : 'bad'),
      hint: '盤が画面の横幅いっぱいになるまで寄せる。駒台は切れてよい'
    });
    out.push({
      key: 'rot',
      label: '盤のまわり方',
      value: (m.rotationDeg >= 0 ? '' : '−') + Math.abs(m.rotationDeg).toFixed(1) + '°',
      level: Math.abs(m.rotationDeg) <= LIMITS.rotOk ? 'ok'
           : (Math.abs(m.rotationDeg) <= LIMITS.rotWarn ? 'warn' : 'bad'),
      hint: '盤の辺と画面の辺をそろえる。直さなくても記録はできる'
    });
    return out;
  }

  /* ==================== 画像をまっすぐに直す ====================
   *
   * 出したい大きさの画素ひとつずつについて、元の画像のどこから取るかを
   * 逆に引く。ふつうの向きで書くと隙間ができるので、必ずこの向きで回す。
   */
  function sample(src, w, h, x, y, out, at) {
    var x0 = Math.floor(x), y0 = Math.floor(y);
    if (x0 < 0 || y0 < 0 || x0 + 1 >= w || y0 + 1 >= h) {
      out[at] = 0; out[at + 1] = 0; out[at + 2] = 0; out[at + 3] = 0;
      return;
    }
    var fx = x - x0, fy = y - y0;
    var i00 = (y0 * w + x0) * 4, i10 = i00 + 4;
    var i01 = i00 + w * 4, i11 = i01 + 4;
    var w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy);
    var w01 = (1 - fx) * fy, w11 = fx * fy;
    for (var c = 0; c < 4; c++) {
      out[at + c] = src[i00 + c] * w00 + src[i10 + c] * w10 + src[i01 + c] * w01 + src[i11 + c] * w11;
    }
  }

  /**
   * @param {Uint8ClampedArray} src RGBA
   * @param {object} H 単位正方形 → 元画像 の変換
   * @returns {Uint8ClampedArray} outW*outH*4。範囲外は透明
   */
  function rectify(src, srcW, srcH, H, outW, outH) {
    var out = new Uint8ClampedArray(outW * outH * 4);
    if (!H) return out;
    for (var py = 0; py < outH; py++) {
      var v = (py + 0.5) / outH;
      for (var px = 0; px < outW; px++) {
        var u = (px + 0.5) / outW;
        var w = H.g * u + H.h * v + 1;
        var at = (py * outW + px) * 4;
        if (!w) { out[at + 3] = 0; continue; }
        sample(src, srcW, srcH, (H.a * u + H.b * v + H.c) / w, (H.d * u + H.e * v + H.f) / w, out, at);
      }
    }
    return out;
  }

  /** 四隅の見た目に合わせて、直したあとの大きさを決める (max を超えない) */
  function outputSize(m, max) {
    if (!m) return { w: max, h: max };
    var w = (m.top + m.bottom) / 2, h = (m.left + m.right) / 2;
    var k = max / Math.max(w, h);
    return { w: Math.max(N, Math.round(w * k)), h: Math.max(N, Math.round(h * k)) };
  }

  /** 画像の真ん中あたりに置く、はじめの四隅 */
  function defaultCorners(w, h) {
    var s = Math.min(w, h) * 0.4;
    var cx = w / 2, cy = h / 2;
    return [{ x: cx - s, y: cy - s }, { x: cx + s, y: cy - s },
            { x: cx + s, y: cy + s }, { x: cx - s, y: cy + s }];
  }

  return {
    N: N,
    LIMITS: LIMITS,
    homography: homography,
    project: project,
    invert: invert,
    orientQuad: orientQuad,
    boardH: boardH,
    cellCenter: cellCenter,
    cellQuad: cellQuad,
    squareName: squareName,
    shotMetrics: shotMetrics,
    judge: judge,
    rectify: rectify,
    outputSize: outputSize,
    defaultCorners: defaultCorners
  };
});
