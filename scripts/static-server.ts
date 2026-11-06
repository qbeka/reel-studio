/**
 * An ordinary static file server, used to test exports in conditions a real host offers.
 * It serves files and folder index pages. There is no fallback page, no rewrite and no
 * build step, so a bundle that relies on a dev server fails here.
 *
 *   tsx scripts/static-server.ts <root> <port>
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { type Server, createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
};

export function serveStatic(root: string, port: number): Promise<Server> {
  const base = resolve(root);
  const server = createServer(async (request, response) => {
    const path = decodeURIComponent(new URL(request.url ?? '/', 'http://x').pathname);
    let full = normalize(join(base, path));
    const inside = full === base || full.startsWith(base + sep);
    let info = inside ? await stat(full).catch(() => null) : null;
    if (info?.isDirectory()) {
      // Every ordinary host does these two things for a folder.
      if (!path.endsWith('/')) {
        response.writeHead(301, { location: `${path}/` });
        response.end();
        return;
      }
      full = join(full, 'index.html');
      info = await stat(full).catch(() => null);
    }
    if (info === null || !info.isFile()) {
      response.writeHead(404, { 'content-type': 'text/plain' });
      response.end('Not found');
      return;
    }
    response.writeHead(200, { 'content-type': TYPES[extname(full)] ?? 'application/octet-stream' });
    createReadStream(full).pipe(response);
  });
  return new Promise((done) => server.listen(port, '127.0.0.1', () => done(server)));
}

if (process.argv[1]?.endsWith('static-server.ts')) {
  const [root, port] = process.argv.slice(2);
  await serveStatic(root ?? '.', Number(port ?? 4173));
  console.log(`Serving ${root} on http://127.0.0.1:${port}`);
}
