/* アイコンを作りなおすスクリプト。
   盤を少し傾けて置き、四隅に水色の点を打ったものを PNG で書き出す。
   傾けているのは「撮った盤を合わせる」というこのアプリの仕事を表すため。
   姉妹アプリ kifu は「駒の五角形に棋」なので、地の色だけそろえて中身は分ける。

   canvas で描いて撮るので Playwright が要る:
     npm i -D playwright && node tools/make-icons.js
   ブラウザの実行ファイルを指定したいときは CHROME_PATH を渡す。            */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { chromium } = require("playwright");

const OUT = path.join(__dirname, "..");

/* 盤の大きさ (ban) は、四隅の点まで入りきるように決めてある。
 * 盤の角までの距離は ban * hypot(0.5, 0.53) = ban * 0.729。
 * そこに点の半径 (0.078) と縁の半分 (0.011) が足される。
 *   角丸のタイル … 角丸が食い込む線 0.614S より内側に収める
 *   maskable    … 中心 80% の円（半径 0.40S）より内側に収める
 * 0.74 で作ったら、120px で左上の点が角丸に切られた。 */
const SIZES = [
  { file: "icon-192.png",          size: 192, ban: 0.64 },
  { file: "icon-512.png",          size: 512, ban: 0.64 },
  /* iOS が自前で角を丸めるぶん、少し小さくする */
  { file: "apple-touch-icon.png",  size: 180, ban: 0.60 },
  { file: "icon-512-maskable.png", size: 512, ban: 0.42 }
];

const html = (size, ban) => `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0}canvas{display:block}</style>
<canvas id="c" width="${size}" height="${size}"></canvas>
<script>
const S=${size}, K=${ban}, TILT=-7*Math.PI/180;
const g=document.getElementById("c").getContext("2d");

/* 和紙の地。kifu と同じ色にして、ホーム画面で兄弟に見えるようにする */
g.fillStyle="#EFE7D6"; g.fillRect(0,0,S,S);
let bg=g.createRadialGradient(S*0.2,S*0.12,0,S*0.2,S*0.12,S*0.9);
bg.addColorStop(0,"rgba(255,255,255,.55)"); bg.addColorStop(1,"rgba(255,255,255,0)");
g.fillStyle=bg; g.fillRect(0,0,S,S);
bg=g.createRadialGradient(S*0.85,S*0.92,0,S*0.85,S*0.92,S*0.7);
bg.addColorStop(0,"rgba(150,120,80,.14)"); bg.addColorStop(1,"rgba(150,120,80,0)");
g.fillStyle=bg; g.fillRect(0,0,S,S);

const w=S*K, h=w*1.06, hw=w/2, hh=h/2, r=S*0.02;
function board(){
  g.beginPath();
  g.moveTo(-hw+r,-hh);
  g.arcTo( hw,-hh, hw,-hh+r, r);
  g.arcTo( hw, hh, hw-r, hh, r);
  g.arcTo(-hw, hh,-hw, hh-r, r);
  g.arcTo(-hw,-hh,-hw+r,-hh, r);
  g.closePath();
}

g.save();
g.translate(S/2,S/2);
g.rotate(TILT);

/* 盤。紙から浮かせる */
g.save();
g.shadowColor="rgba(70,50,25,.30)"; g.shadowBlur=S*0.035; g.shadowOffsetY=S*0.018;
board();
const gr=g.createLinearGradient(0,-hh,0,hh);
gr.addColorStop(0,"#F4E2B6"); gr.addColorStop(1,"#E2C089");
g.fillStyle=gr; g.fill();
g.restore();
board();
g.strokeStyle="rgba(110,80,40,.85)"; g.lineWidth=Math.max(1,S*0.014); g.stroke();

/* マス目。9本だと小さいところで潰れるので3本にする */
g.save();
board(); g.clip();
g.strokeStyle="rgba(110,80,40,.5)"; g.lineWidth=Math.max(1,S*0.011);
g.beginPath();
for(let i=1;i<4;i++){
  const x=-hw+w*i/4, y=-hh+h*i/4;
  g.moveTo(x,-hh); g.lineTo(x,hh);
  g.moveTo(-hw,y);  g.lineTo(hw,y);
}
g.stroke();
g.restore();

/* 四隅の点。このアプリの目じるし。kifu には無い色（水色）を使う */
const dot=S*0.078;
for(const [x,y] of [[-hw,-hh],[hw,-hh],[hw,hh],[-hw,hh]]){
  g.beginPath(); g.arc(x,y,dot,0,Math.PI*2);
  g.fillStyle="#32C8F0"; g.fill();
  g.lineWidth=Math.max(1.5,S*0.022); g.strokeStyle="#fff"; g.stroke();
}
g.restore();
document.title="ready";
</script>`;

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ban-icons-"));
  const exe = process.env.CHROME_PATH || "/opt/pw-browsers/chromium";
  const b = await chromium.launch(fs.existsSync(exe) ? { executablePath: exe } : {});
  for (const s of SIZES) {
    const page = path.join(dir, "i.html");
    fs.writeFileSync(page, html(s.size, s.ban));
    const ctx = await b.newContext({ viewport: { width: s.size, height: s.size }, deviceScaleFactor: 1 });
    const p = await ctx.newPage();
    await p.goto("file://" + page);
    await p.waitForFunction(() => document.title === "ready", { timeout: 20000 });
    await p.locator("#c").screenshot({ path: path.join(OUT, s.file) });
    await ctx.close();
    console.log(s.file, s.size + "x" + s.size);
  }
  await b.close();
  fs.rmSync(dir, { recursive: true, force: true });
})();
