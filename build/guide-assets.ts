import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'

/** Ship the reviewed guide with exact script hashes; never relax the application's CSP. */
export function createGuideAssets(source: string, bridge: string): Record<string, string> {
  // HTML normalizes CRLF before checking inline script hashes.
  source = source.replace(/\r\n?/g, '\n')
  bridge = bridge.replace(/\r\n?/g, '\n')
  const assets: Record<string, string> = {}
  const scripts: string[] = []
  let html = source.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi, (_, code: string) => {
    scripts.push(code)
    return ''
  })
  if (!scripts.length) throw new Error('Guide document contains no runtime')
  const boot = `const GUIDE_SCRIPTS=${JSON.stringify(scripts).replace(/</g, '\\u003c')};\n${bridge}`
  const hashes = [...scripts, boot].map(code => `'sha256-${createHash('sha256').update(code).digest('base64')}'`).join(' ')
  html = html.replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${hashes}; style-src 'unsafe-inline'; img-src data:; connect-src 'none'">`)
  html = html.replace('</head>', `<style>html,body{overflow:hidden}body{padding:0!important}.app{border:0!important;border-radius:0!important;box-shadow:none!important}.topbar .tools{padding-right:40px}</style></head>`)
  assets['index.html'] = html.replace('</body>', () => `<script>${boot}</script></body>`)
  return assets
}

export function guideAssetsPlugin(): Plugin {
  const sourcePath = resolve('docs/previews/guide.html')
  const bridgePath = resolve('build/guide-host.js')
  const assets = () => createGuideAssets(readFileSync(sourcePath, 'utf8'), readFileSync(bridgePath, 'utf8'))
  return {
    name: 'local-guide-document',
    configureServer(server) {
      server.watcher.add([sourcePath, bridgePath])
      server.middlewares.use((req, res, next) => {
        const pathname = (req.url ?? '').split('?')[0]
        if (!pathname.startsWith('/guide/')) return next()
        const name = pathname.slice('/guide/'.length)
        const content = assets()[name]
        if (content === undefined) return next()
        res.setHeader('Content-Type', name.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8')
        res.setHeader('Cache-Control', 'no-store')
        res.end(content)
      })
    },
    generateBundle() {
      for (const [name, source] of Object.entries(assets())) {
        this.emitFile({ type: 'asset', fileName: `guide/${name}`, source })
      }
    }
  }
}
