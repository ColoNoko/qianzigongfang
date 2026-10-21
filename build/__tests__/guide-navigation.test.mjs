import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM, VirtualConsole } from 'jsdom'
import { createGuideAssets } from '../guide-assets.ts'

const source = readFileSync('docs/previews/guide.html', 'utf8')
const bridge = readFileSync('build/guide-host.js', 'utf8')
const storeKey = 'hanhua-guide-v2'

function openGuide(t, { hash = '', saved, hosted = false } = {}) {
  const errors = []
  const messages = []
  const virtualConsole = new VirtualConsole()
  virtualConsole.on('jsdomError', error => errors.push(error.message))
  const dom = new JSDOM(hosted ? createGuideAssets(source, bridge)['index.html'] : source, {
    url: 'https://guide.example/' + hash,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      window.matchMedia = () => ({ matches: false })
      window.HTMLElement.prototype.scrollIntoView = () => {}
      window.HTMLDialogElement.prototype.showModal = function () { this.open = true }
      window.HTMLDialogElement.prototype.close = function () { this.open = false }
      if (saved) window.localStorage.setItem(storeKey, JSON.stringify(saved))
      if (hosted) window.postMessage = message => messages.push(message)
    }
  })
  const { window } = dom
  const document = window.document
  if (hosted) window.dispatchEvent(new window.MessageEvent('message', {
    source: window,
    data: { channel: 'hanhua-guide-host', type: 'init', theme: 'dark', colors: { '--accent': '#aaccff' }, saved: saved ? JSON.stringify(saved) : null }
  }))
  t.after(() => {
    dom.window.close()
    assert.deepEqual(errors, [], 'guide executes without uncaught runtime errors')
  })
  const query = selector => {
    const element = document.querySelector(selector)
    assert.ok(element, `Missing control: ${selector}`)
    return element
  }
  const click = selector => { query(selector).click() }
  const key = (name, selector = 'body', options = {}) => query(selector).dispatchEvent(new window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...options }))
  const state = () => JSON.parse(window.localStorage.getItem(storeKey))
  const route = id => click(`.course-nav [data-route="quick/${id}"]`)
  const reference = id => {
    click('#reference')
    click(`#nav [data-route="reference/${id}"]`)
  }
  return { window, document, query, click, key, state, route, reference, messages }
}

test('four core lessons keep the optional directory and all original reference practice reachable', t => {
  const g = openGuide(t)
  assert.equal(g.window.location.hash, '#quick/add')
  assert.equal(g.query('#directory').hidden, true)
  assert.deepEqual([...g.document.querySelectorAll('.course-nav button')].map(b => b.dataset.route), ['quick/add', 'quick/roles', 'quick/finish', 'quick/wrap'])
  g.click('#directoryToggle')
  assert.equal(g.query('#directory').hidden, false)
  assert.equal(g.query('#directoryToggle').getAttribute('aria-expanded'), 'true')
  g.key('Escape')
  assert.equal(g.query('#directory').hidden, true)
  assert.equal(g.document.activeElement.id, 'directoryToggle')
  for (const id of ['welcome', 'add', 'roles', 'view', 'finish', 'wrap', 'return', 'progress', 'select', 'edit', 'credits', 'typeset', 'import', 'fonts', 'dates', 'backup']) {
    g.reference(id)
    assert.equal(g.window.location.hash, '#reference/' + id)
    assert.ok(g.query('#pageTitle').textContent)
    assert.equal(g.query('#directory').hidden, true)
    if (id !== 'welcome') assert.ok(g.query('#practice').children.length)
  }
})

test('saved responsibility tags remain independent from current mode across navigation and reload', t => {
  const g = openGuide(t)
  g.route('roles')
  g.click('[data-action="project-menu"]')
  g.click('[data-action="duties"]')
  g.click('[data-duty="翻译"]')
  assert.deepEqual(g.state().work.duties, ['嵌字', '翻译'])
  assert.equal(g.state().work.mode, '嵌字', 'adding an assignment does not switch current mode')
  g.click('[data-action="close-duties"]')
  const tags = () => [...g.document.querySelectorAll('.duty-tags .duty-tag')].map(el => [el.tagName, el.textContent])
  assert.deepEqual(tags(), [['SPAN', '嵌字'], ['SPAN', '翻译']])
  g.click('.current-mode-row [data-mode="翻译"]')
  assert.deepEqual(tags(), [['SPAN', '嵌字'], ['SPAN', '翻译']])
  g.route('finish')
  g.route('roles')
  assert.equal(g.state().work.mode, '翻译')
  const reloaded = openGuide(t, { hash: '#quick/roles', saved: g.state() })
  assert.deepEqual(reloaded.state().work.duties, ['嵌字', '翻译'])
  assert.equal(reloaded.state().work.mode, '翻译')
})

test('translation content is saved separately from completion, with cancel and undo preserving content', t => {
  const g = openGuide(t, { saved: { work: { duties: ['翻译'], mode: '翻译' } } })
  g.route('finish')
  g.click('[data-action="enter-workspace"]')
  g.click('[data-action="edit-entry"]')
  g.query('#entryDraft').value = '保留这份译文'
  g.key('s', '#entryDraft', { ctrlKey: true })
  assert.equal(g.state().work.texts['1:1:1'], '保留这份译文')
  assert.deepEqual(g.state().work.complete, {})
  assert.equal(g.document.querySelector('[data-action="mark"]'), null, 'content lesson does not duplicate the completion step')
  g.click('[data-action="edit-entry"]')
  g.query('#entryDraft').value = '不应保存的内容'
  g.query('#modal').dispatchEvent(new g.window.Event('cancel', { cancelable: true }))
  assert.equal(g.state().work.texts['1:1:1'], '保留这份译文')
  g.route('wrap')
  g.click('[data-continue-page="1"]')
  assert.ok(g.state().work.complete['1:翻译:1'])
  assert.equal(g.document.querySelector('[data-field="source"]'), null, 'date settings are optional reference material')
  g.click('[data-action="undo"]')
  assert.deepEqual(g.state().work.complete, {})
  assert.equal(g.state().work.texts['1:1:1'], '保留这份译文')
  g.click('[data-continue-page="1"]')
  g.click('[data-cancel-page="1"]')
  assert.deepEqual(g.state().work.complete, {})
})

test('legacy deep links and read history migrate without discarding independent work records', t => {
  const saved = { theme: 'dark', read: ['quick/welcome', 'quick/view', 'quick/return', 'reference/fonts'], work: { duties: ['翻译', '校对'], mode: '校对', complete: { '1:翻译:1': { date: '2026-09-12' } }, texts: { '1:1:1': '原有内容' } } }
  for (const id of ['welcome', 'view', 'return']) {
    const g = openGuide(t, { hash: '#quick/' + id, saved })
    assert.equal(g.window.location.hash, '#reference/' + id)
    assert.ok(g.state().read.includes('quick/' + id))
    assert.ok(g.state().read.includes('reference/' + id))
    assert.deepEqual(g.state().work.complete, saved.work.complete)
    assert.equal(g.state().work.texts['1:1:1'], '原有内容')
  }
  const invalid = openGuide(t, { hash: '#%E0%A4%A' })
  assert.equal(invalid.window.location.hash, '#quick/add')
})

test('browser history dismisses transient menus while retaining practice state', async t => {
  const g = openGuide(t)
  g.route('roles')
  g.click('[data-action="project-menu"]')
  g.click('[data-action="duties"]')
  g.click('[data-duty="翻译"]')
  g.route('finish')
  const wentBack = new Promise(resolve => g.window.addEventListener('popstate', resolve, { once: true }))
  g.window.history.back()
  await wentBack
  assert.equal(g.window.location.hash, '#quick/roles')
  assert.equal(g.document.querySelector('.duty-picker'), null)
  assert.deepEqual(g.state().work.duties, ['嵌字', '翻译'])
  const wentForward = new Promise(resolve => g.window.addEventListener('popstate', resolve, { once: true }))
  g.window.history.forward()
  await wentForward
  assert.equal(g.window.location.hash, '#quick/finish')
  assert.deepEqual(g.state().work.duties, ['嵌字', '翻译'])
})

test('host Escape honors directory, project menu, practice expansion, and nested dialogs before closing', t => {
  const g = openGuide(t, { hosted: true })
  const closes = () => g.messages.filter(message => message.type === 'close').length
  assert.equal(g.document.documentElement.dataset.theme, 'dark')
  assert.equal(g.document.documentElement.style.getPropertyValue('--accent'), '#aaccff')
  assert.ok(g.messages.some(message => message.type === 'loaded'))
  g.click('#directoryToggle')
  g.key('Escape')
  assert.equal(closes(), 0)
  assert.equal(g.query('#directory').hidden, true)
  g.route('roles')
  g.click('[data-action="project-menu"]')
  g.key('Escape')
  assert.equal(closes(), 0)
  assert.equal(g.document.querySelector('.project-menu'), null)
  g.route('finish')
  g.click('[data-action="enter-workspace"]')
  g.click('[data-action="expand"]')
  assert.equal(g.query('[data-action="expand"]').getAttribute('aria-pressed'), 'true')
  g.key('Escape')
  assert.equal(closes(), 0)
  assert.equal(g.query('[data-action="expand"]').getAttribute('aria-pressed'), 'false')
  g.click('[data-action="photoshop"]')
  g.key('Escape')
  assert.equal(closes(), 0, 'nested dialog consumes Escape in the native browser')
  g.query('#modal').dispatchEvent(new g.window.Event('cancel', { cancelable: true }))
  g.key('Escape')
  assert.equal(closes(), 1)
})

test('search, read markers, and reference backups remain functional after simplifying the course', async t => {
  const g = openGuide(t)
  g.route('roles')
  g.click('[data-action="read"]')
  g.query('#search').value = '备份'
  g.query('#search').dispatchEvent(new g.window.Event('input', { bubbles: true }))
  await new Promise(resolve => setTimeout(resolve, 150))
  assert.ok(g.window.location.hash.startsWith('#search/'))
  g.click('.search-list [data-route="reference/backup"]')
  g.click('[data-action="backup"]')
  assert.equal(g.state().work.backups.length, 1)
  g.click('[data-restore="0"]')
  g.click('[data-action="confirm-restore"]')
  assert.ok(g.state().read.includes('quick/roles'))
  g.click('[data-route="quick/add"]')
  assert.equal(g.window.location.hash, '#quick/add')
})

test('typesetting practice retains PSD save, refresh, expanded view restoration, and per-mode completion', t => {
  const g = openGuide(t, { saved: { work: { duties: ['嵌字', '监修'], mode: '嵌字' } } })
  g.route('finish')
  g.click('[data-action="enter-workspace"]')
  g.click('[data-action="photoshop"]')
  g.query('#psDraft').value = '更新后的嵌字'
  g.click('[data-action="save-psd"]')
  assert.equal(g.state().work.ps['1:1'].saved, true)
  assert.equal(g.state().work.ps['1:1'].refreshed, false)
  g.click('[data-action="refresh-psd"]')
  assert.equal(g.state().work.ps['1:1'].refreshed, true)
  assert.deepEqual(g.state().work.complete, {})
  g.click('[data-action="expand"]')
  g.click('[data-action="read"]')
  assert.equal(g.query('[data-action="expand"]').getAttribute('aria-pressed'), 'true')
  g.key('Escape')
  assert.equal(g.query('[data-action="expand"]').getAttribute('aria-pressed'), 'false')
  g.click('[data-action="expand"]')
  g.click('[data-action="image-list"]')
  g.click('[data-action="enter-workspace"]')
  assert.equal(g.query('[data-action="expand"]').getAttribute('aria-pressed'), 'false')
  g.route('wrap')
  g.click('[data-continue-page="1"]')
  g.click('.role-switch [data-mode="监修"]')
  assert.ok(g.state().work.complete['1:嵌字:1'])
  assert.equal(g.state().work.complete['1:监修:1'], undefined)
  assert.equal(g.state().work.ps['1:1'].text, '更新后的嵌字')
})

test('clearing optional assignments is explicit, survives reload, and does not erase mode or work', t => {
  const g = openGuide(t, { hash: '#quick/roles', saved: { work: { duties: ['翻译'], mode: '翻译', texts: { '1:1:1': '已保存' } } } })
  g.click('[data-action="project-menu"]')
  g.click('[data-action="duties"]')
  g.click('[data-duty="翻译"]')
  g.click('[data-action="close-duties"]')
  assert.deepEqual(g.state().work.duties, [])
  assert.equal(g.state().work.mode, '翻译')
  const reloaded = openGuide(t, { hash: '#quick/roles', saved: g.state() })
  assert.deepEqual(reloaded.state().work.duties, [])
  assert.equal(reloaded.state().work.texts['1:1:1'], '已保存')
  reloaded.click('[data-action="enter-role"]')
  assert.equal(reloaded.window.location.hash, '#quick/finish')
  assert.equal(reloaded.state().work.mode, '翻译')
})

test('removing the current assignment keeps the current mode until the next chapter entry', t => {
  const g = openGuide(t, { hash: '#quick/roles', saved: { work: { duties: ['翻译', '校对'], mode: '翻译', texts: { '1:1:1': '当前译文' }, complete: { '1:翻译:1': { date: '2026-10-21' } } } } })
  g.click('[data-action="project-menu"]')
  g.click('[data-action="duties"]')
  g.click('[data-duty="翻译"]')
  g.click('[data-action="close-duties"]')
  assert.deepEqual(g.state().work.duties, ['校对'])
  assert.equal(g.state().work.mode, '翻译', 'assignment editing must not switch the current view')
  assert.equal(g.state().work.texts['1:1:1'], '当前译文')
  assert.ok(g.state().work.complete['1:翻译:1'])
  const reloaded = openGuide(t, { hash: '#quick/roles', saved: g.state() })
  assert.deepEqual(reloaded.state().work.duties, ['校对'], 'reloading keeps the saved assignment edit')
  g.click('[data-action="enter-role"]')
  assert.equal(g.window.location.hash, '#quick/finish')
  assert.equal(g.state().work.mode, '校对', 'new chapter entry selects a currently assigned mode')
})
