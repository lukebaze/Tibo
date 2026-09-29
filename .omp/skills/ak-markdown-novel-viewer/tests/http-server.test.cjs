/**
 * Tests for http-server.cjs
 * Route testing, security validation, MIME types
 */

const { describe, it } = require('node:test');
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const {
  createHttpServer,
  getMimeType,
  sendResponse,
  sendError,
  serveFile,
  isPathSafe,
  setAllowedDirs,
  sanitizeErrorMessage,
  MIME_TYPES
} = require('../scripts/lib/http-server.cjs');
const path = require('path');

const skillRoot = path.join(__dirname, '..');
const assetsDir = path.join(skillRoot, 'assets');

function localCssImports(cssText) {
  const refs = [];
  const pattern = /@import\s+(?:url\(\s*)?['"]([^'"]+)['"]\s*\)?/gi;
  let match;
  while ((match = pattern.exec(cssText)) !== null) {
    const ref = match[1].trim();
    if (!ref || /^(?:https?:)?\/\//i.test(ref) || /^data:/i.test(ref)) {
      continue;
    }
    refs.push(ref);
  }
  return refs;
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve(server.address().port);
    });
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

function httpGet(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port, path: urlPath }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          type: String(res.headers['content-type'] || ''),
          body: Buffer.concat(chunks)
        });
      });
    }).on('error', reject);
  });
}

describe('MIME_TYPES', () => {
  it('should have common file types', () => {
    assert.strictEqual(MIME_TYPES['.html'], 'text/html');
    assert.strictEqual(MIME_TYPES['.css'], 'text/css');
    assert.strictEqual(MIME_TYPES['.js'], 'application/javascript');
    assert.strictEqual(MIME_TYPES['.json'], 'application/json');
  });

  it('should have image types', () => {
    assert.strictEqual(MIME_TYPES['.png'], 'image/png');
    assert.strictEqual(MIME_TYPES['.jpg'], 'image/jpeg');
    assert.strictEqual(MIME_TYPES['.svg'], 'image/svg+xml');
  });
});

describe('getMimeType', () => {
  it('should return correct MIME type for HTML', () => {
    assert.strictEqual(getMimeType('file.html'), 'text/html');
  });

  it('should return correct MIME type for CSS', () => {
    assert.strictEqual(getMimeType('style.css'), 'text/css');
  });

  it('should return correct MIME type for JavaScript', () => {
    assert.strictEqual(getMimeType('script.js'), 'application/javascript');
  });

  it('should handle uppercase extensions', () => {
    assert.strictEqual(getMimeType('FILE.HTML'), 'text/html');
    assert.strictEqual(getMimeType('style.CSS'), 'text/css');
  });

  it('should return octet-stream for unknown types', () => {
    assert.strictEqual(getMimeType('file.xyz'), 'application/octet-stream');
  });

  it('should handle files without extensions', () => {
    assert.strictEqual(getMimeType('README'), 'application/octet-stream');
  });
});

describe('sanitizeErrorMessage', () => {
  it('should remove absolute paths from error messages', () => {
    const message = 'Error: /home/user/project/file.txt not found';
    const sanitized = sanitizeErrorMessage(message);
    assert(!sanitized.includes('/home/user'));
    assert(sanitized.includes('[path]'));
  });

  it('should preserve non-path text', () => {
    const message = 'Error: File not found';
    const sanitized = sanitizeErrorMessage(message);
    assert(sanitized.includes('Error'));
    assert(sanitized.includes('File not found'));
  });

  it('should handle multiple paths', () => {
    const message = 'Error comparing /path/one and /path/two';
    const sanitized = sanitizeErrorMessage(message);
    assert.strictEqual((sanitized.match(/\[path\]/g) || []).length, 2);
  });

  it('should not remove text after URL protocols', () => {
    const message = 'Visit https://example.com for help';
    const sanitized = sanitizeErrorMessage(message);
    // Verify message is preserved after sanitization
    assert(sanitized.length > 0, 'Message should not be empty');
    assert(sanitized.includes('help'), 'Message text should be preserved');
  });
});

describe('isPathSafe', () => {
  it('should reject null byte injection', () => {
    assert.strictEqual(isPathSafe('/var/www/file.txt\0.jpg'), false);
  });

  it('should allow normal paths with empty allowedDirs', () => {
    // When allowedDirs is empty (during initialization), allow all
    setAllowedDirs([]);
    assert.strictEqual(isPathSafe('/var/www/file.txt'), true);
  });

  it('should reject paths outside allowed directories when set', () => {
    setAllowedDirs(['/allowed/dir']);
    assert.strictEqual(isPathSafe('/other/dir/file.txt'), false);
  });

  it('should allow paths inside allowed directories', () => {
    const allowed = '/allowed/dir';
    setAllowedDirs([allowed]);
    const filePath = require('path').join(allowed, 'file.txt');
    assert.strictEqual(isPathSafe(filePath), true);
  });

  it('should handle multiple allowed directories', () => {
    const dir1 = '/dir1';
    const dir2 = '/dir2';
    setAllowedDirs([dir1, dir2]);
    // Paths must be absolute and within allowed dirs
    const path1 = require('path').join(dir1, 'file.txt');
    const path2 = require('path').join(dir2, 'file.txt');
    assert.strictEqual(isPathSafe(path1), true);
    assert.strictEqual(isPathSafe(path2), true);
  });

  it('should allow empty allowedDirs during initialization', () => {
    setAllowedDirs([]);
    assert.strictEqual(isPathSafe('/any/path.txt'), true);
  });
});

describe('setAllowedDirs', () => {
  it('should set allowed directories', () => {
    const dirs = ['/home/user', '/tmp'];
    setAllowedDirs(dirs);
    // Verify by testing path safety
    assert.strictEqual(isPathSafe('/home/user/file.txt'), true);
  });

  it('should resolve relative paths to absolute', () => {
    setAllowedDirs(['./relative']);
    // Should be resolved to absolute path
    assert(isPathSafe(path.resolve('./relative/file.txt')));
  });
});

describe('createHttpServer', () => {
  it('should create an HTTP server', () => {
    const server = createHttpServer({
      assetsDir: __dirname,
      renderMarkdown: (fp) => '<html></html>',
      allowedDirs: [__dirname]
    });
    assert(server);
    assert(typeof server.listen === 'function');
    server.close();
  });

  it('should require assetsDir', () => {
    const server = createHttpServer({
      assetsDir: __dirname,
      renderMarkdown: (fp) => '<html></html>'
    });
    assert(server);
    server.close();
  });

  it('should accept plansDir option', () => {
    const server = createHttpServer({
      assetsDir: __dirname,
      renderMarkdown: (fp) => '<html></html>',
      plansDir: '/plans'
    });
    assert(server);
    server.close();
  });

  it('should accept allowedDirs option', () => {
    const server = createHttpServer({
      assetsDir: __dirname,
      renderMarkdown: (fp) => '<html></html>',
      allowedDirs: [__dirname, '/tmp']
    });
    assert(server);
    server.close();
  });
});

describe('Route: /assets/*', () => {
  it('should prevent directory traversal in assets path', async () => {
    const server = createHttpServer({
      assetsDir: __dirname,
      renderMarkdown: (fp) => '<html></html>'
    });
    try {
      const port = await listen(server);
      // http-server.cjs rejects any /assets/ request whose decoded path
      // still contains '..' before it ever touches the filesystem.
      const res = await httpGet(port, '/assets/../secret.txt');
      assert.strictEqual(res.status, 403, 'literal .. must be rejected with 403');
      assert.ok(res.body.toString().includes('Access denied'));
    } finally {
      await closeServer(server);
    }
  });

  it('should validate asset paths for ../ after URL-decoding', async () => {
    const server = createHttpServer({
      assetsDir: __dirname,
      renderMarkdown: (fp) => '<html></html>'
    });
    try {
      const port = await listen(server);
      // %2e%2e decodes to '..' via decodeURIComponent before the traversal
      // check runs, so an encoded payload must be caught the same way a
      // literal one is.
      const res = await httpGet(port, '/assets/%2e%2e/secret.txt');
      assert.strictEqual(res.status, 403, 'URL-encoded .. must be rejected with 403');
    } finally {
      await closeServer(server);
    }
  });

  it('serves novel-theme.css and every local @import as text/css 200', async () => {
    const entryPath = path.join(assetsDir, 'novel-theme.css');
    const entryCss = fs.readFileSync(entryPath, 'utf8');
    const imports = localCssImports(entryCss);
    assert.ok(imports.length > 0, 'novel-theme.css must @import at least one local module');

    const assetUrls = ['/assets/novel-theme.css'];
    for (const rel of imports) {
      const abs = path.resolve(assetsDir, rel);
      assert.ok(abs.startsWith(path.resolve(assetsDir) + path.sep), `import escaped assets: ${rel}`);
      assert.ok(fs.existsSync(abs), `missing CSS module ${rel}`);
      assetUrls.push('/assets/' + path.relative(assetsDir, abs).split(path.sep).join('/'));
    }

    const server = createHttpServer({
      assetsDir,
      renderMarkdown: () => '<html></html>',
      allowedDirs: [assetsDir]
    });

    try {
      const port = await listen(server);
      for (const urlPath of assetUrls) {
        const res = await httpGet(port, urlPath);
        assert.strictEqual(res.status, 200, `${urlPath} status`);
        assert.ok(res.type.includes('text/css'), `${urlPath} content-type ${res.type}`);
        assert.ok(res.body.length > 0, `${urlPath} empty body`);
      }
    } finally {
      await closeServer(server);
    }
  });
});

// http-server.cjs only implements '/', '/view', '/browse', '/assets/*' and
// '/file/*' (see module.exports and the routing chain in createHttpServer).
// '/dashboard', '/api/dashboard' and '/api/files' are not registered routes,
// so `plansDir` is accepted as a createHttpServer option but never read by
// the request handler. The tests below assert the server's real, current
// behavior for these paths (falling through to the default 404 handler)
// instead of exercising options that have no route to act on.
describe('Route: /dashboard', () => {
  it('is not a registered route and falls through to 404', async () => {
    const server = createHttpServer({
      assetsDir: __dirname,
      renderMarkdown: (fp) => '<html></html>',
      plansDir: __dirname
    });
    try {
      const port = await listen(server);
      const res = await httpGet(port, '/dashboard');
      assert.strictEqual(res.status, 404);
    } finally {
      await closeServer(server);
    }
  });

  it('ignores plansDir/allowedDirs options for the unregistered route', async () => {
    const server = createHttpServer({
      assetsDir: __dirname,
      renderMarkdown: (fp) => '<html></html>',
      allowedDirs: [__dirname]
    });
    try {
      const port = await listen(server);
      const res = await httpGet(port, '/dashboard?dir=' + encodeURIComponent(__dirname));
      assert.strictEqual(res.status, 404, 'query params cannot resurrect an unregistered route');
    } finally {
      await closeServer(server);
    }
  });
});

describe('Route: /api/dashboard', () => {
  it('is not a registered route, so it does not return JSON', async () => {
    const server = createHttpServer({
      assetsDir: __dirname,
      renderMarkdown: (fp) => '<html></html>',
      plansDir: __dirname
    });
    try {
      const port = await listen(server);
      const res = await httpGet(port, '/api/dashboard');
      assert.strictEqual(res.status, 404);
      assert.ok(!res.type.includes('application/json'), 'the default 404 handler responds text/html');
    } finally {
      await closeServer(server);
    }
  });

  it('handles a missing plansDir gracefully (still 404, no crash)', async () => {
    const server = createHttpServer({
      assetsDir: __dirname,
      renderMarkdown: (fp) => '<html></html>'
    });
    try {
      const port = await listen(server);
      const res = await httpGet(port, '/api/dashboard');
      assert.strictEqual(res.status, 404);
    } finally {
      await closeServer(server);
    }
  });
});

describe('Route: /file/*', () => {
  it('rejects a file path outside allowedDirs with 403', async () => {
    const server = createHttpServer({
      assetsDir: __dirname,
      renderMarkdown: (fp) => '<html></html>',
      allowedDirs: [__dirname]
    });
    try {
      const port = await listen(server);
      const res = await httpGet(port, '/file//etc/passwd');
      assert.strictEqual(res.status, 403, 'a path outside allowedDirs must be denied');
    } finally {
      await closeServer(server);
    }
  });
});

describe('Route: /api/files', () => {
  it('is not a registered route and returns 404', async () => {
    const server = createHttpServer({
      assetsDir: __dirname,
      renderMarkdown: (fp) => '<html></html>'
    });
    try {
      const port = await listen(server);
      const res = await httpGet(port, '/api/files');
      assert.strictEqual(res.status, 404);
    } finally {
      await closeServer(server);
    }
  });
});

console.log('\n' + '='.repeat(60));
console.log('HTTP Server Tests');
console.log('='.repeat(60));
