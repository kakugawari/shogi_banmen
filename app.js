/*!
 * app.js — 操作と描画。算数は core.js に置いてある。
 */
(function () {
  'use strict';

  var C = window.Core;
  var MAX_OUT = 720;                 /* 直したあとの盤の最大の辺 (画素) */
  var HIT = 26;                      /* 指で四隅をつかめる範囲 (画面の画素) */
  var LABEL = ['①左上', '②右上', '③右下', '④左下'];

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    file: $('file'), fileInfo: $('fileInfo'),
    s2: $('s2'), s3: $('s3'), s4: $('s4'), s5: $('s5'),
    seek: $('seek'), seekAt: $('seekAt'), back1: $('back1'), fwd1: $('fwd1'),
    shot: $('shot'), loupe: $('loupe'), reset: $('reset'), showGrid: $('showGrid'),
    board: $('board'), checks: $('checks'), next: $('next'), perf: $('perf')
  };

  /* 元の1コマは、いつも本来の大きさのまま裏の canvas に持っておく。
   * 画面に出すときだけ縮める。縮めたものから直すと、細かい線が消えてしまう。 */
  var src = document.createElement('canvas');
  var srcCtx = src.getContext('2d', { willReadFrequently: true });

  var state = {
    kind: null,                      /* 'video' | 'image' */
    video: null,
    width: 0, height: 0, duration: 0,
    pixels: null,                    /* 元の1コマの中身。直すときに使う */
    corners: null,                   /* 画像の座標。[左上, 右上, 右下, 左下] */
    sente: 'near',
    touched: false,                  /* 四隅を一度でも動かしたか */
    drag: -1,
    grab: { x: 0, y: 0 },            /* つまんだ指と、点とのずれ */
    pan: null,                       /* 四隅から外れた所をなぞったとき、画面を送る */
    view: { scale: 1 },              /* 画像の座標 → 画面の座標 */
    lastMs: 0
  };

  /* ==================== 1コマを取りこむ ==================== */

  function fmtTime(t) { return t.toFixed(2) + ' 秒'; }

  function grabFrom(source) {
    src.width = state.width;
    src.height = state.height;
    srcCtx.drawImage(source, 0, 0, state.width, state.height);
    state.pixels = srcCtx.getImageData(0, 0, state.width, state.height).data;
    if (!state.corners) { state.corners = C.defaultCorners(state.width, state.height); state.touched = false; }
    layout();
    render(true);
  }

  function seekTo(t) {
    var v = state.video;
    if (!v) return;
    t = Math.max(0, Math.min(state.duration, t));
    els.seek.value = String(t);
    els.seekAt.textContent = fmtTime(t);
    if (Math.abs(v.currentTime - t) < 1e-3) { grabFrom(v); return; }
    v.currentTime = t;
  }

  function describe() {
    var tate = state.height >= state.width;
    var s = state.width + '×' + state.height + '（' + (tate ? '縦' : '横') + '）';
    if (state.kind === 'video') s += ' / ' + state.duration.toFixed(1) + ' 秒の動画';
    else s += ' / 写真';
    if (!tate) s += ' ※iPhone を縦にして撮ると、盤が大きく写る';
    return s;
  }

  function loadFile(file) {
    if (!file) return;
    state.corners = null;
    var url = URL.createObjectURL(file);
    var isVideo = /^video\//.test(file.type) || /\.(mp4|mov|m4v)$/i.test(file.name);

    if (isVideo) {
      var v = document.createElement('video');
      v.playsInline = true; v.muted = true; v.preload = 'auto'; v.src = url;
      v.addEventListener('loadedmetadata', function () {
        /* iPhone の縦動画は「横のまま＋回して出せ」で入っていることがある。
         * ここに出る幅と高さが、実際に扱われる向き。目で確かめられるように必ず出す。 */
        state.kind = 'video'; state.video = v;
        state.width = v.videoWidth; state.height = v.videoHeight;
        state.duration = isFinite(v.duration) ? v.duration : 0;
        els.seek.max = String(state.duration || 1);
        els.seek.step = '0.02';
        els.fileInfo.textContent = describe();
        els.s2.classList.remove('hidden');
        renumber();
        seekTo(0);
      }, { once: true });
      v.addEventListener('seeked', function () {
        els.seekAt.textContent = fmtTime(v.currentTime);
        grabFrom(v);
      });
      v.addEventListener('error', function () {
        els.fileInfo.textContent = 'この動画は開けなかった。MP4 か MOV をえらんでください。';
      });
    } else {
      var img = new Image();
      img.onload = function () {
        state.kind = 'image'; state.video = null;
        state.width = img.naturalWidth; state.height = img.naturalHeight;
        state.duration = 0;
        els.fileInfo.textContent = describe();
        els.s2.classList.add('hidden');
        grabFrom(img);
        URL.revokeObjectURL(url);
      };
      img.onerror = function () { els.fileInfo.textContent = 'この写真は開けなかった。'; };
      img.src = url;
    }
  }

  /* ==================== 画面に合わせる ==================== */

  function layout() {
    /* 幅を測る前に、欄を出しておくこと。
     * display:none のまま測ると clientWidth が 0 になり、逃げ道の 320 が使われる。
     * どんな端末でも 320px 固定になって、四隅が合わせられなかった。 */
    ['s3', 's4', 's5'].forEach(function (k) { els[k].classList.remove('hidden'); });
    var wrapW = els.shot.parentNode.clientWidth || 320;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    /* 指でつまむものなので、横幅いっぱいに出す。小さいと四隅を合わせられない。
     * いちど 0.52 画面ぶんに抑えたが、実際に使うと小さすぎた。
     * 高さの上限は、とんでもなく縦長の画像よけの保険だけにする。
     * ふつうの 9:16 の写真は、幅で決まって画面ぶんに収まる。 */
    var maxH = Math.max(240, (window.innerHeight || 640) * 1.3);
    var scale = Math.min(wrapW / state.width, maxH / state.height);
    var cssW = Math.round(state.width * scale), cssH = Math.round(state.height * scale);
    els.shot.style.width = cssW + 'px';
    els.shot.style.height = cssH + 'px';
    els.shot.width = Math.round(cssW * dpr);
    els.shot.height = Math.round(cssH * dpr);
    state.view.scale = scale * dpr;                  /* 画像 → canvas の画素 */
    renumber();
  }

  /* 出ている手順だけに、上から順に番号を振りなおす。
   * 写真をえらんだときはコマ送りが出ないので、そのままだと 1・3・4・5 と飛ぶ。 */
  function renumber() {
    var n = 0;
    Array.prototype.forEach.call(document.querySelectorAll('.step'), function (sec) {
      if (sec.classList.contains('hidden')) return;
      var no = sec.querySelector('.no');
      if (no) no.textContent = String(++n);
    });
  }

  var toCanvas = function (p) { return { x: p.x * state.view.scale, y: p.y * state.view.scale }; };

  /* ==================== 描く ==================== */

  function drawShot() {
    var ctx = els.shot.getContext('2d');
    var k = state.view.scale;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, els.shot.width, els.shot.height);
    ctx.drawImage(src, 0, 0, els.shot.width, els.shot.height);

    var cs = state.corners;
    if (!cs) return;
    var p = cs.map(toCanvas);
    var dpr = k / (els.shot.clientWidth / state.width || 1);

    /* 四隅を結ぶ枠 */
    ctx.lineWidth = 2 * dpr;
    ctx.strokeStyle = '#32C8F0';
    ctx.beginPath();
    ctx.moveTo(p[0].x, p[0].y);
    for (var i = 1; i < 4; i++) ctx.lineTo(p[i].x, p[i].y);
    ctx.closePath();
    ctx.stroke();

    /* 四隅から計算したマス目を、写真の上に重ねる。
     * これが第0段のかなめ。線が盤の線に乗っていれば、四隅は合っている。 */
    if (els.showGrid.checked) {
      var H = C.boardH(cs, state.sente);
      if (H) {
        ctx.lineWidth = 1 * dpr;
        ctx.strokeStyle = 'rgba(50,200,240,.75)';
        ctx.beginPath();
        for (var g = 1; g < C.N; g++) {
          var t = g / C.N, a, b;
          a = toCanvas(C.project(H, t, 0)); b = toCanvas(C.project(H, t, 1));
          ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
          a = toCanvas(C.project(H, 0, t)); b = toCanvas(C.project(H, 1, t));
          ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
        }
        ctx.stroke();
      }
    }

    /* つまむところ。番号を添えて、どの隅かを分かるようにする */
    ctx.font = (11 * dpr) + 'px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (var j = 0; j < 4; j++) {
      var r = (state.drag === j ? 13 : 10) * dpr;
      ctx.beginPath();
      ctx.arc(p[j].x, p[j].y, r, 0, Math.PI * 2);
      ctx.fillStyle = state.drag === j ? '#E0628A' : '#32C8F0';
      ctx.fill();
      ctx.lineWidth = 2 * dpr;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
      ctx.fillStyle = '#231D16';
      ctx.fillText(String(j + 1), p[j].x, p[j].y + 0.5 * dpr);
    }
  }

  function drawLoupe(i) {
    var lp = els.loupe, ctx = lp.getContext('2d');
    var p = state.corners[i], zoom = 3.5;
    var half = lp.width / (2 * zoom);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#EFEBE4';
    ctx.fillRect(0, 0, lp.width, lp.height);
    ctx.drawImage(src, p.x - half, p.y - half, half * 2, half * 2, 0, 0, lp.width, lp.height);
    /* 十字。どこが中心かを分かるようにする */
    ctx.strokeStyle = '#E0628A';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(lp.width / 2, 0); ctx.lineTo(lp.width / 2, lp.height);
    ctx.moveTo(0, lp.height / 2); ctx.lineTo(lp.width, lp.height / 2);
    ctx.stroke();
    /* どの隅を動かしているか */
    ctx.font = 'bold 15px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(35,29,22,.72)';
    ctx.fillRect(0, 0, 26, 22);
    ctx.fillStyle = '#fff';
    ctx.fillText(LABEL[i].charAt(0), 6, 4);
    /* 指の反対側に置く。指で隠れては意味がない */
    lp.classList.toggle('left', p.x / state.width > 0.5);
    lp.classList.remove('hidden');
  }

  function drawBoard() {
    var m = C.shotMetrics(state.corners);
    var H = C.boardH(state.corners, state.sente);
    if (!m || !H) { renderChecks(null); return; }

    var size = C.outputSize(m, MAX_OUT);
    var t0 = (window.performance || Date).now();
    var data = C.rectify(state.pixels, state.width, state.height, H, size.w, size.h);
    state.lastMs = Math.round((window.performance || Date).now() - t0);

    els.board.width = size.w;
    els.board.height = size.h;
    var ctx = els.board.getContext('2d');
    var img = ctx.createImageData(size.w, size.h);
    img.data.set(data);
    ctx.putImageData(img, 0, 0);

    if (els.showGrid.checked) {
      ctx.strokeStyle = 'rgba(50,200,240,.8)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (var g = 1; g < C.N; g++) {
        var x = Math.round(size.w * g / C.N) + 0.5, y = Math.round(size.h * g / C.N) + 0.5;
        ctx.moveTo(x, 0); ctx.lineTo(x, size.h);
        ctx.moveTo(0, y); ctx.lineTo(size.w, y);
      }
      ctx.stroke();

      /* 四隅のマスの名前。向きが合っているかは、これを見れば分かる。
       * マスの真ん中に書くと駒の下に隠れる（初期配置では四隅に必ず香がいる）。
       * 盤の角へ寄せて、地色の札に載せる。 */
      var fs = Math.round(size.w / 30), pad = Math.round(size.w / 110);
      ctx.font = 'bold ' + fs + 'px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      [[0, 0], [8, 0], [0, 8], [8, 8]].forEach(function (c) {
        var nm = C.squareName(c[0], c[1]);
        var bw = ctx.measureText(nm).width + pad * 2, bh = fs + pad * 1.4;
        var x = c[0] === 0 ? 2 : size.w - bw - 2;
        var y = c[1] === 0 ? 2 : size.h - bh - 2;
        ctx.fillStyle = 'rgba(250,249,246,.94)';
        ctx.fillRect(x, y, bw, bh);
        ctx.strokeStyle = 'rgba(178,58,46,.5)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, bw - 1, bh - 1);
        ctx.fillStyle = '#B23A2E';
        ctx.fillText(nm, x + pad, y + pad * 0.6);
      });
    }
    renderChecks(m);
  }

  var MARK = { ok: '◎', warn: '△', bad: '×' };

  function renderChecks(m) {
    els.checks.textContent = '';
    /* はじめの四隅は真四角に置いてある。そのまま点検すると
     * 「ぴったり真上・0.0°」と満点が出てしまい、撮り方を見た結果に見える。
     * 一度も動かしていないうちは、点検の結果を出さない。 */
    if (!state.touched) {
      var todo = document.createElement('li');
      todo.className = 'todo';
      todo.innerHTML = '<span class="mark">…</span><span class="ck-body">まだ盤に合わせていません'
        + '<span class="ck-hint">4つの点を、盤のマス目の四隅へ動かしてください。'
        + '動かすと撮り方の点検が出ます。</span></span>';
      els.checks.appendChild(todo);
      els.next.classList.add('hidden');
      els.perf.textContent = '';
      return;
    }
    if (!m) {
      var li = document.createElement('li');
      li.className = 'bad';
      li.innerHTML = '<span class="mark">×</span><span class="ck-body">四隅がつぶれている。'
        + '4つの点を、盤の四隅へ広げてください。</span>';
      els.checks.appendChild(li);
      els.perf.textContent = '';
      return;
    }
    C.judge(m).forEach(function (j) {
      var li = document.createElement('li');
      li.className = j.level;
      var mark = document.createElement('span');
      mark.className = 'mark'; mark.textContent = MARK[j.level];
      var lab = document.createElement('span');
      lab.className = 'ck-label'; lab.textContent = j.label;
      var body = document.createElement('span');
      body.className = 'ck-body'; body.textContent = j.value;
      var hint = document.createElement('span');
      hint.className = 'ck-hint'; hint.textContent = j.hint;
      body.appendChild(hint);
      li.appendChild(mark); li.appendChild(lab); li.appendChild(body);
      els.checks.appendChild(li);
    });
    els.perf.textContent = '直すのにかかった時間 ' + state.lastMs + ' ミリ秒'
      + '（' + els.board.width + '×' + els.board.height + ' 画素）';
    renderNext(C.judge(m));
  }

  /* 点検が終わったら、次に何をすればいいかをその場で言う。
   * ここで止まると「対局を始めれば記録される」と思われる。 */
  function renderNext(list) {
    var bad = list.filter(function (j) { return j.level !== 'ok'; });
    els.next.classList.remove('hidden');
    els.next.classList.toggle('todo', bad.length > 0);
    els.next.textContent = bad.length
      ? '「' + bad.map(function (j) { return j.label; }).join('」「') + '」を直して、'
        + 'もう一度撮ってください。直しかたは上に出ています。'
      : 'この置き方でいけます。カメラをこのまま動かさずに、対局を録画してください。'
        + '撮った動画は、この先の段でそのまま使えます。';
  }

  /** heavy を true にしたときだけ、盤を直しなおす（指で動かしている間は重い） */
  function render(heavy) {
    if (!state.pixels) return;
    drawShot();
    if (heavy) drawBoard();
  }

  /* ==================== 指の操作 ==================== */

  function atEvent(e) {
    var r = els.shot.getBoundingClientRect();
    var k = state.width / r.width;                    /* CSS 画素 → 画像の座標 */
    return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k, cssK: k };
  }

  function onDown(e) {
    if (!state.corners) return;
    var p = atEvent(e), best = -1, bestD = Infinity;
    for (var i = 0; i < 4; i++) {
      var d = Math.hypot(state.corners[i].x - p.x, state.corners[i].y - p.y);
      if (d < bestD) { bestD = d; best = i; }
    }
    if (bestD > HIT * p.cssK) {
      /* どの隅からも遠い。写真は画面をほぼ埋めるので、ここで何もしないと
       * touch-action: none のせいで画面が送れなくなる。自分で送る。 */
      state.pan = { y: e.clientY, top: window.scrollY || window.pageYOffset || 0 };
      els.shot.setPointerCapture(e.pointerId);
      return;
    }
    state.drag = best;
    /* 点を指の位置へ吸い付かせない。つまんだときの差をそのまま保つ。
     * 吸い付かせると、指の腹（40px ほど）で点がまるごと隠れて狙えない。
     * 少し離れたところをつまめば、点は指の外に出たまま動く。 */
    state.grab = { x: state.corners[best].x - p.x, y: state.corners[best].y - p.y };
    els.shot.setPointerCapture(e.pointerId);
    e.preventDefault();
    drawLoupe(best);
    render(false);
  }

  function onMove(e) {
    if (state.pan) {
      /* 指を離すまで、はじめに触れた所を基準に送る。1コマごとの差を足すと
       * 送ったぶん画面が動いてずれが溜まる */
      window.scrollTo(0, state.pan.top + (state.pan.y - e.clientY));
      return;
    }
    if (state.drag < 0) return;
    var p = atEvent(e);
    state.corners[state.drag] = {
      x: Math.max(0, Math.min(state.width, p.x + state.grab.x)),
      y: Math.max(0, Math.min(state.height, p.y + state.grab.y))
    };
    e.preventDefault();
    drawLoupe(state.drag);
    render(false);                                    /* 動かしている間は枠だけ */
  }

  function onUp() {
    if (state.pan) { state.pan = null; return; }
    if (state.drag < 0) return;
    state.drag = -1;
    state.touched = true;
    els.loupe.classList.add('hidden');
    render(true);                                     /* 指を離してから直す */
  }

  function setSide(side) {
    state.sente = side;
    $('sideNear').classList.toggle('on', side === 'near');
    $('sideFar').classList.toggle('on', side === 'far');
    render(true);
  }

  /* ==================== つなぐ ==================== */

  els.file.addEventListener('change', function (e) { loadFile(e.target.files[0]); });
  els.seek.addEventListener('input', function () { seekTo(Number(els.seek.value)); });
  els.back1.addEventListener('click', function () { seekTo(Number(els.seek.value) - 0.1); });
  els.fwd1.addEventListener('click', function () { seekTo(Number(els.seek.value) + 0.1); });
  els.reset.addEventListener('click', function () {
    state.corners = C.defaultCorners(state.width, state.height);
    state.touched = false;
    render(true);
  });
  els.showGrid.addEventListener('change', function () { render(true); });
  $('sideNear').addEventListener('click', function () { setSide('near'); });
  $('sideFar').addEventListener('click', function () { setSide('far'); });

  els.shot.addEventListener('pointerdown', onDown);
  els.shot.addEventListener('pointermove', onMove);
  els.shot.addEventListener('pointerup', onUp);
  els.shot.addEventListener('pointercancel', onUp);

  var resizing;
  window.addEventListener('resize', function () {
    if (!state.pixels) return;
    clearTimeout(resizing);
    resizing = setTimeout(function () { layout(); render(true); }, 120);
  });

  /* オフラインで開けるようにする。
   * 1枚にまとめたもの (Artifact) には sw.js が無いので、そちらでは登録しない。
   * マニフェストの link は tools/bundle.js が落とすので、それを目じるしにする。 */
  if ('serviceWorker' in navigator
      && document.querySelector('link[rel="manifest"]')
      && location.protocol.indexOf('http') === 0) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js').catch(function () {});
    });
  }

  /* 自動テストから中身をのぞく入口 */
  window.__app = {
    state: function () { return state; },
    metrics: function () { return C.shotMetrics(state.corners); },
    judge: function () { return C.judge(C.shotMetrics(state.corners)); },
    setCorners: function (cs) {
      state.corners = cs.map(function (p) { return { x: p.x, y: p.y }; });
      state.touched = true;
      render(true);
    },
    setSide: setSide,
    boardPixel: function (x, y) {
      return Array.from(els.board.getContext('2d').getImageData(x, y, 1, 1).data);
    }
  };
})();
