// @vitest-environment node
import { afterAll, expect, it, vi } from 'vitest'
import { readFile, writeFile, mkdir, rm, utimes } from 'node:fs/promises'
import { resolve,join } from 'node:path'
const root=resolve('.omo/fixtures/font-glyph-cache-test')
vi.mock('electron',()=>({app:{getPath:()=>resolve('.omo/fixtures/font-glyph-cache-test')}}))
vi.mock('node:fs/promises',async original=>{
  const fs=await original<typeof import('node:fs/promises')>()
  return {...fs,readFile:vi.fn(fs.readFile)}
})
vi.mock('fontkit',()=>({create:()=>({unitsPerEm:1000,ascent:800,descent:-200,glyphForCodePoint:()=>({path:{toSVG:()=> 'M0 0L100 500'},advanceWidth:600})})}))
import { fontPreview } from '../preview'
afterAll(()=>rm(root,{recursive:true,force:true}))
it('stores only sample outlines and reuses them without rereading the font; revisions invalidate independently',async()=>{
  await mkdir(root,{recursive:true})
  const path=join(root,'fixture.ttf')
  await writeFile(path,Buffer.alloc(16))
  const first=await fontPreview(path,0,true)
  expect(first.buffer.byteLength).toBe(0)
  expect(first.glyphs?.map(g=>g.text).join('')).toBe('嵌字工坊 字体预览 123 ABC')
  const reads=vi.mocked(readFile).mock.calls.length
  expect((await fontPreview(path,0,true)).glyphs).toEqual(first.glyphs)
  expect(vi.mocked(readFile).mock.calls.length).toBe(reads)
  await utimes(path,new Date(1000),new Date(1000))
  await fontPreview(path,0,true)
  expect(vi.mocked(readFile).mock.calls.length).toBe(reads+1)
})
