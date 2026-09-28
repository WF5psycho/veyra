// Bundles the game into one self-contained HTML file: dist/veyra.html (double-click to play).
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.join(root, 'dist');
mkdirSync(out, { recursive: true });

const res = await build({
  entryPoints: [path.join(root, 'src/main.js')],
  bundle: true,
  format: 'iife',
  minify: true,
  write: false,
  target: 'es2020',
  legalComments: 'none',
});
const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = readFileSync(path.join(root, 'style.css'), 'utf8');
let html = readFileSync(path.join(root, 'index.html'), 'utf8');
html = html.replace('<link rel="stylesheet" href="style.css">', () => `<style>\n${css}\n</style>`);
html = html.replace('<script type="module" src="src/main.js"></script>', () => `<script>\n/* three.js (MIT) bundled — see vendor/three.LICENSE */\n${js}\n</script>`);
writeFileSync(path.join(out, 'veyra.html'), html);
console.log(`dist/veyra.html written (${(html.length / 1024).toFixed(0)} KB)`);

// Optional: a fragment variant for hosts that supply their own <html>/<head>/<body> skeleton.
const fragOut = process.argv[2];
if (fragOut) {
  const frag = html
    .replace(/<!doctype html>\s*/i, '')
    .replace(/<html[^>]*>\s*/i, '')
    .replace(/<\/html>\s*/i, '')
    .replace(/<head>\s*/i, '')
    .replace(/<\/head>\s*/i, '')
    .replace(/<body>\s*/i, '')
    .replace(/<\/body>\s*/i, '')
    .replace(/<meta charset="utf-8">\s*/i, '')
    .replace(/<meta name="viewport"[^>]*>\s*/i, '');
  writeFileSync(fragOut, frag);
  console.log(`${fragOut} written`);
}
