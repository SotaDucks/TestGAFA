import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

// 开发辅助：POST /__shot?name=xxx 把画布截图写入 ./shots/xxx.png
function shotPlugin() {
  return {
    name: 'shot-writer',
    configureServer(server) {
      server.middlewares.use('/__shot', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          return res.end();
        }
        const url = new URL(req.url, 'http://x');
        const name = (url.searchParams.get('name') || 'shot').replace(/[^\w-]/g, '');
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          const dir = path.resolve('shots');
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(path.join(dir, name + '.png'), Buffer.concat(chunks));
          res.end('ok');
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [shotPlugin()],
  server: { watch: { ignored: ['**/shots/**'] } },
  build: { chunkSizeWarningLimit: 1000 },
});
