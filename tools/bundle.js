#!/usr/bin/env node
/*
 * 全ファイルを 1 枚の HTML にまとめる。テストプレイしてもらうときに使う。
 *
 *   node tools/bundle.js out.html              1枚で完結する HTML
 *   node tools/bundle.js out.html --fragment   Artifact 用 (doctype/html/head/body を外す)
 *
 * Artifact は公開時に doctype と head と body を足すので、こちらでは書かない。
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const out = process.argv[2];
const fragment = process.argv.includes('--fragment');
if (!out) {
  console.error('使いかた: node tools/bundle.js out.html [--fragment]');
  process.exit(1);
}

let html = read('index.html');

/* 外に置いてあるものを、そのまま中へ入れる */
html = html.replace(/<link rel="stylesheet" href="\.\/styles\.css">/,
  '<style>\n' + read('styles.css').trim() + '\n</style>');
html = html.replace(/<script src="\.\/(core|app)\.js"><\/script>/g,
  (_, name) => '<script>\n' + read(name + '.js').trim() + '\n</script>');

/* アイコンとマニフェストは1枚にまとめられないので落とす
 * (Artifact 側が絵文字のアイコンを付ける) */
html = html.replace(/\s*<!--[^>]*-->(?=\s*<link rel="apple-touch-icon")/g, '');
html = html.replace(/\s*<link rel="(icon|apple-touch-icon|manifest)"[^>]*>/g, '');

if (fragment) {
  /* <body> の中身を取り出し、<title> と <style> だけを前に付け直す */
  const title = (html.match(/<title>([^<]*)<\/title>/) || [, '盤あわせ'])[1];
  const style = (html.match(/<style>[\s\S]*?<\/style>/) || [''])[0];
  const body = (html.match(/<body>([\s\S]*)<\/body>/) || [, html])[1];
  html = '<title>' + title + '</title>\n' + style + '\n' + body.trim() + '\n';
}

fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, html);
console.log(out + ' を書いた (' + Math.round(Buffer.byteLength(html) / 1024) + ' KB'
  + (fragment ? ', Artifact 用' : '') + ')');
