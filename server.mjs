import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { createMetaApi } from './server-dist/api.mjs';
const base = resolve('dist');
const csp = "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
export function startLocalServer({ api = createMetaApi(process.env), port = Number(process.env.PORT || 4173) } = {}) {
  const server = http.createServer(async (req, res) => {
    const host = req.headers.host ?? '';
    if (!/^(127\.0\.0\.1|localhost)(:\d{1,5})?$/.test(host)) { res.writeHead(403).end(); return; }
    const url = new URL(req.url, 'http://' + host);
    const controller = new AbortController();
    req.on('aborted', () => controller.abort());
    res.on('close', () => { if (!res.writableEnded) controller.abort(); });
    try {
      if(url.pathname.startsWith('/api/processing/')){res.writeHead(url.pathname==='/api/processing/status'?200:503,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(url.pathname==='/api/processing/status'?{enabled:false,remainingDiscovery:0,remainingSegments:0,remainingFinishes:0,maxItems:0,maxFallbacks:0,approvedSourceSha256:null,approvalExpiresAt:null}:{error:'disabled'}));return;}
      if (url.pathname.startsWith('/api/')) {
        const request = new Request(url, { method: req.method, headers: req.headers,
          ...(!['GET', 'HEAD'].includes(req.method) ? { body: Readable.toWeb(req), duplex: 'half' } : {}), signal: controller.signal });
        const response = await api.handle(request);
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(Buffer.from(await response.arrayBuffer()));
        return;
      }
      if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
      const file = resolve(base, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
      if (!file.startsWith(base + '/')) { res.writeHead(403).end(); return; }
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.ttf':'font/ttf', '.txt':'text/plain' })[extname(file)] || 'application/octet-stream',
        'Content-Security-Policy': csp, 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch { if (!res.headersSent && !res.destroyed) res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end('{"error":"local_server_error"}'); }
  });
  server.listen(port, '127.0.0.1');
  return server;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startLocalServer().on('listening', function () { console.log('Local preview: http://127.0.0.1:' + this.address().port); });
}
