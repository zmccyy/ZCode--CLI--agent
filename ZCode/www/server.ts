import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import { exec } from 'child_process';
import { fileURLToPath } from 'url';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};

function serveStatic(wwwDir: string, req: IncomingMessage, res: ServerResponse): void {
  const url = req.url || '/';
  const pathname = url.split('?')[0];

  // Resolve to a safe path within wwwDir
  const filePath = pathname === '/' ? join(wwwDir, 'index.html') : join(wwwDir, pathname);

  // Directory traversal protection
  const resolved = filePath.replace(/\\/g, '/');
  const base = wwwDir.replace(/\\/g, '/');
  if (!resolved.startsWith(base)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('[ ERR ] Forbidden');
    return;
  }

  if (!existsSync(resolved)) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>404 — ZCode</title></head>
<body style="background:#0a0a0a;color:#ff3333;font-family:monospace;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
<pre style="text-align:center;">
[ ERR ] 404 — FILE NOT FOUND
  Request: ${pathname}
  Server:  ZCode WWW v0.1.0
</pre>
</body>
</html>`);
    return;
  }

  try {
    const content = readFileSync(resolved);
    const ext = extname(resolved).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('[ ERR ] Internal Server Error');
  }
}

function openBrowserUrl(url: string): void {
  const platform = process.platform;
  let cmd: string;
  if (platform === 'win32') {
    // The empty "" is required — start interprets the first quoted arg as a window title
    cmd = `start "" "${url}"`;
  } else if (platform === 'darwin') {
    cmd = `open "${url}"`;
  } else {
    cmd = `xdg-open "${url}"`;
  }
  exec(cmd, (err) => {
    if (err) {
      console.error(`  Could not open browser: ${err.message}`);
      console.error(`  Please open ${url} manually.`);
    }
  });
}

function argsToOptions(args: string[]): { port: number; noOpen: boolean; help: boolean } {
  const options = { port: 3000, noOpen: false, help: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--port' || arg === '-p') {
      const next = args[i + 1];
      if (next && !next.startsWith('-')) {
        const parsed = parseInt(next, 10);
        if (!isNaN(parsed) && parsed > 0 && parsed <= 65535) {
          options.port = parsed;
          i++;
        }
      }
    } else if (arg === '--no-open') {
      options.noOpen = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    }
  }
  return options;
}

function printBanner(port: number): void {
  const line = '═'.repeat(52);
  console.log(`\n╔${line}╗`);
  console.log('║  ZCODE WWW — Terminal-Native Promotional Website       ║');
  console.log('║                                                        ║');
  console.log(`║  Server:  http://localhost:${String(port).padEnd(5)}                        ║`);
  console.log('║  Stop:    Press Ctrl+C                                  ║');
  console.log(`╚${line}╝\n`);
}

export async function wwwMain(args: string[]): Promise<void> {
  const options = argsToOptions(args);

  if (options.help) {
    console.log('\nZCode WWW — Promotional Website Server');
    console.log('  Usage: zcode www [options]');
    console.log('  Options:');
    console.log('    --port, -p <n>   Port to listen on (default: 3000)');
    console.log('    --no-open        Do not open browser automatically');
    console.log('    --help, -h       Show this help\n');
    return;
  }

  // Resolve www directory relative to this file
  const wwwDir = fileURLToPath(new URL('.', import.meta.url));

  // Create the server
  const server = createServer((req, res) => serveStatic(wwwDir, req, res));

  // Try to listen on the requested port, fall back up to 10 times
  let port = options.port;
  let attempts = 0;
  const maxAttempts = 10;

  await new Promise<void>((resolve, reject) => {
    function tryListen(p: number) {
      server.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' && attempts < maxAttempts) {
          attempts++;
          p++;
          tryListen(p);
        } else {
          reject(err);
        }
      });

      server.listen(p, '127.0.0.1', () => {
        port = p;
        resolve();
      });
    }

    tryListen(port);
  });

  printBanner(port);

  // Open browser
  if (!options.noOpen) {
    const url = `http://localhost:${port}`;
    openBrowserUrl(url);
  }

  // Graceful shutdown
  const shutdown = () => {
    console.log('\n  Shutting down ZCode WWW server...');
    server.close(() => {
      console.log('  [ OK ] Server stopped.\n');
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
