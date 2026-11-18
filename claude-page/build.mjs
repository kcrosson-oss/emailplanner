import { build } from 'esbuild';
import fs from 'fs';
const r = await build({
  entryPoints: ['src/main.tsx'], bundle: true, minify: true, write: false, format: 'iife', target: 'es2020',
  jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'warning',
  alias: { '@/lib': './src/lib', '@/components': './src/components' },
});
const js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = fs.readFileSync('src/styles.css', 'utf8');
const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>ResQ Email Planner</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Poppins:wght@500;600;700&display=swap" rel="stylesheet">
<style>${css}</style></head><body><div id="root"></div><script>${js}</script></body></html>`;
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/index.html', html);
console.log('dist/index.html', (html.length / 1024).toFixed(0) + ' KB');
