import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { Script } from 'node:vm'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGuideAssets } from '../guide-assets.ts'
test('reviewed guide scripts retain exact content and valid CSP hashes', () => {
 const source=readFileSync('docs/previews/guide.html','utf8').replace(/\r\n?/g,'\n')
 const bridge=readFileSync('build/guide-host.js','utf8').replace(/\r\n?/g,'\n')
 const assets=createGuideAssets(source,bridge)
 const scripts=[...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(match=>match[1])
 scripts.forEach(script=>{assert(assets['index.html'].includes('sha256-'+createHash('sha256').update(script).digest('base64')));new Script(script)})
 const boot=[...assets['index.html'].matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)][0][1]
 assert(assets['index.html'].includes('sha256-'+createHash('sha256').update(boot).digest('base64')))
 assert(!assets['index.html'].includes("script-src 'unsafe-inline'"))
 new Script(boot)
})

test('Windows line endings produce the same browser-valid CSP hashes', () => {
 const source='<html><head></head><body><script>const n=1;\nvoid n;</script></body></html>'
 const bridge='void 0;\nvoid 1;'
 assert.deepEqual(createGuideAssets(source.replaceAll('\n','\r\n'),bridge.replaceAll('\n','\r\n')),createGuideAssets(source,bridge))
})
