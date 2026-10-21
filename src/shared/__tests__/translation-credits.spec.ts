import { expect, it } from 'vitest'
import { readTranslationCredits, rewriteTranslationCredits, initialTranslationCredits, formatTranslationCredits } from '../translation-credits'

it('preserves BOM, CRLF, comments and dialogue while updating only header credits', () => {
  const body = '>>>>>>>>[001.jpg]<<<<<<<<\r\n--------[1]--------[0.5,0.5,1]\r\n翻译：这是一句台词\r\n'
  const source = '\uFEFF1,0\r\n-\r\n框内\r\n框外\r\n-\r\n保留说明\r\n翻译：旧名\r\n' + body
  const result = rewriteTranslationCredits(source, { translator: '新译者', proofreader: '校对者', combined: false })
  expect(result.startsWith('\uFEFF1,0\r\n')).toBe(true)
  expect(result).toContain('保留说明\r\n')
  expect(result.endsWith(body)).toBe(true)
  expect(result.replaceAll('\r\n', '')).not.toContain('\n')
  expect(readTranslationCredits(result)).toEqual({ translator: '新译者', proofreader: '校对者', combined: false })
})

it('rejects injected lines and malformed headers', () => {
  const valid = '1,0\n-\n框内\n框外\n-\n>>>>>>[1.png]<<<<<<\n'
  expect(() => rewriteTranslationCredits(valid, { translator: 'a\n>>>>>>[2.png]<<<<<<', proofreader: '', combined: true })).toThrow()
  expect(() => rewriteTranslationCredits('no header', { translator: '', proofreader: '', combined: false })).toThrow()
})

for (const newline of ['\n', '\r\n', '\r']) {
  it(`preserves the entire dialogue after an indented first image header with ${JSON.stringify(newline)} endings`, () => {
    const body = [
      '  >>>>>>>>[001.jpg]<<<<<<<<  ',
      '----------------[1]----------------[0.5,0.5,1]',
      '翻译：这是一句台词', '校对：这也是台词', '',
      '>>>>>>>>[002.jpg]<<<<<<<<',
      '----------------[1]----------------[0.5,0.5,1]', '第二页台词', ''
    ].join(newline)
    const header = ['\uFEFF1,0', ' - ', '框内', '框外', '\t-\t', '翻译：原译者', '保留备注', ''].join(newline)
    const credits = { translator: '新译者', proofreader: '校对者', combined: false }
    expect(readTranslationCredits(header + body).translator).toBe('原译者')
    const saved = rewriteTranslationCredits(header + body, credits)
    expect(saved.endsWith(body)).toBe(true)
    expect(saved.startsWith(`\uFEFF1,0${newline}`)).toBe(true)
    expect(saved).toContain(`保留备注${newline}`)
    expect(readTranslationCredits(saved)).toEqual(credits)
  })
}

it('fills only first-edit blanks, respects existing names and preserves explicitly cleared credits', () => {
  const current = { translator:'原译者', proofreader:'', combined:false }
  const previous = { source:'秦爷', translator:'旧译者', proofreader:'旧校对', typesetter:'旧嵌字' }
  const first = initialTranslationCredits(current, previous, 'typeset', '小逗比')
  expect(first).toMatchObject({ source:'秦爷',translator:'原译者',proofreader:'旧校对',typesetter:'旧嵌字' })
  expect(initialTranslationCredits({ ...first, source:'', initialized:true }, previous, 'translated', '新称呼').source).toBe('')
  expect(initialTranslationCredits({translator:'',proofreader:'',combined:false},previous,'translated','我').translator).toBe('我')
  expect(initialTranslationCredits({translator:'',proofreader:'',combined:false},previous,'proofread','我').proofreader).toBe('我')
})
it('round trips five credits and initialization without changing dialogue; copies five lines', () => {
  const source = '1,0\n-\n框内\n框外\n-\n备注\n>>>>>>>>[1.jpg]<<<<<<<<\n'
  const credits = { source:'秦爷',translator:'译者',proofreader:'校对',typesetter:'嵌字',supervisor:'监修',combined:false,initialized:true }
  const result = rewriteTranslationCredits(source,credits)
  expect(readTranslationCredits(result)).toEqual(credits)
  expect(result).toContain('备注\n')
  expect(formatTranslationCredits(credits)).toBe('图源：秦爷\n翻译：译者\n校对：校对\n嵌字：嵌字\n监修：监修')
  expect(() => rewriteTranslationCredits(source,{...credits,source:'bad\nline'})).toThrow()
})

for (const separator of ['/', '／', '?', '？', '、', '&', '+', '与']) {
  it(`recognizes combined translation/proofreading credit with ${separator} and rewrites it without duplicate legacy headers`, () => {
    const text = `1,0\n-\n框内\n框外\n-\n翻译${separator}校对：小逗比\n>>>>>>>>[001.jpg]<<<<<<<<\n翻译/校对：这是一句台词\n`
    const credits = readTranslationCredits(text)
    expect(credits).toEqual({translator:'小逗比',proofreader:'小逗比',combined:true})
    const saved = rewriteTranslationCredits(text, {...credits, combined:false, proofreader:'另一人'})
    expect(readTranslationCredits(saved)).toEqual({translator:'小逗比',proofreader:'另一人',combined:false})
    expect(saved).toContain('翻译/校对：这是一句台词')
    expect(saved).not.toContain(`翻译${separator}校对：小逗比`)
  })
}

for (const mode of ['typeset', 'supervised']) {
  it(`${mode} reopens from TXT, fills saved blanks from recent credits and never uses nickname or unsaved drafts`, () => {
    const txt={source:'TXT图源',translator:'TXT译者',proofreader:'',typesetter:'',supervisor:'',combined:false,initialized:true}
    const recent={source:'旧图源',translator:'旧译者',proofreader:'最近校对',typesetter:'最近嵌字',supervisor:'最近监修'}
    const draft=initialTranslationCredits(txt,recent,mode,'当前称呼')
    expect(draft).toMatchObject({source:'TXT图源',translator:'TXT译者',proofreader:'最近校对',typesetter:'最近嵌字',supervisor:'最近监修'})
    draft.translator='未保存内容'
    draft.source=''
    expect(initialTranslationCredits(txt,recent,mode,'当前称呼')).toMatchObject({source:'TXT图源',translator:'TXT译者'})
    expect(initialTranslationCredits({...txt,translator:'外部已修改'},recent,mode,'当前称呼').translator).toBe('外部已修改')
    expect(initialTranslationCredits(txt,{},mode,'当前称呼').typesetter).toBe('')
  })
}

it('writes combined credits as one actual TXT line, then splits independently edited names into two', () => {
 const original='1,0\r\n-\r\n框内\r\n框外\r\n-\r\n翻译：旧译者\r\n校对：旧校对\r\n翻校一体：否\r\n>>>>>>>>[001.jpg]<<<<<<<<\r\n'
 const combined=rewriteTranslationCredits(original,{translator:'同一人',proofreader:'同一人',combined:true})
 expect(combined).toContain('翻译/校对：同一人\r\n')
 expect(combined).not.toContain('\n翻译：')
 expect(combined).not.toContain('\n校对：')
 expect(readTranslationCredits(combined)).toEqual({translator:'同一人',proofreader:'同一人',combined:true})
 const split=rewriteTranslationCredits(combined,{translator:'同一人',proofreader:'另一人',combined:false})
 expect(split).toContain('翻译：同一人\r\n校对：另一人\r\n')
 expect(split).not.toContain('翻译/校对：')
 expect(readTranslationCredits(split)).toEqual({translator:'同一人',proofreader:'另一人',combined:false})
})
