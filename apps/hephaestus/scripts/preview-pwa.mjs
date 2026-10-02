import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, resolve, sep } from 'node:path'

const root = resolve('.output/public')
const port = Number(process.env['PORT'] ?? 3212)
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' }

createServer(async (req, res) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')
  res.setHeader('Content-Security-Policy', "frame-ancestors 'none'")
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end()
      return
    }
    const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname)
    let path = resolve(root, `.${pathname}`)
    if (path !== root && !path.startsWith(`${root}${sep}`)) {
      res.writeHead(403).end()
      return
    }
    const info = await stat(path).catch(() => null)
    if (info?.isDirectory()) path = resolve(path, 'index.html')
    else if (!info && !extname(path)) path = resolve(root, 'index.html')
    const file = await stat(path).catch(() => null)
    if (!file?.isFile()) {
      res.writeHead(404).end()
      return
    }
    res.setHeader('Content-Type', types[extname(path)] ?? 'application/octet-stream')
    res.setHeader('Cache-Control', 'no-cache')
    if (req.method === 'HEAD') res.end()
    else createReadStream(path).pipe(res)
  } catch {
    res.writeHead(400).end()
  }
}).listen(port, '127.0.0.1', () => process.stdout.write(`Hephaestus PWA preview: http://127.0.0.1:${port}\n`))
