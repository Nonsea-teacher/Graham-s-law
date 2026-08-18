/* เซิร์ฟเวอร์ไฟล์นิ่งขนาดเล็กสำหรับดูงานระหว่างพัฒนา — node tools/serve.mjs [port] */
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const root = process.cwd();
const port = Number(process.argv[2] || 5180);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

createServer(async (req, res) => {
  try {
    // ช่องรับภาพจากหน้าเว็บระหว่างตรวจงาน: POST /__shot/<ชื่อ> พร้อม data URL
    if (req.method === 'POST' && req.url.startsWith('/__shot/')) {
      const name = req.url.slice('/__shot/'.length).replace(/[^a-z0-9_-]/gi, '') || 'shot';
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const dataUrl = Buffer.concat(chunks).toString();
      const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
      await writeFile(join(root, 'tools', `shot-${name}.jpg`), Buffer.from(b64, 'base64'));
      res.writeHead(200).end('ok');
      return;
    }
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = join(root, normalize(path).replace(/^(\.\.[/\\])+/, ''));
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('ไม่พบไฟล์');
  }
}).listen(port, () => console.log(`http://localhost:${port}`));
