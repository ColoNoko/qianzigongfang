// @vitest-environment jsdom
import { flushPromises, enableAutoUnmount, config } from '@vue/test-utils'
config.global.stubs.teleport = true
config.global.renderStubDefaultSlot = true
enableAutoUnmount(afterEach)

import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import ProjectFormModal from '../ProjectFormModal.vue'
import { PROJECT_FORM_HINTS, PROJECT_FORM_REQUIRED } from '../project-form-hints'
import type { StatSnap } from '@shared/ipc-api'
import type { ParentProject } from '@shared/types'


const VALID_STAT: StatSnap = {
  mtimeMs: 1000,
  ctimeMs: 1000,
  size: 0,
  isFile: false,
  isDirectory: true
}

function mockComicType(opts?: {
  pickDir?: string | null
  statThrow?: boolean
  statSnap?: StatSnap

  tree?: ParentProject[]
}): void {
  const targetWindow = window as unknown as { comicType: unknown }
  targetWindow.comicType = {
    pickDirectory: vi.fn(() => Promise.resolve(opts?.pickDir ?? null)),
    stat: vi.fn(() =>
      opts?.statThrow
        ? Promise.reject(new Error('ENOENT'))
        : Promise.resolve(opts?.statSnap ?? VALID_STAT)
    ),
    projectGetTree: vi.fn(() => Promise.resolve(opts?.tree ?? []))
  }
}

describe('ProjectFormModal', async () => {
  beforeEach(() => {
    mockComicType()
  })

  it.each([['第二话xxxx', '2'], ['第2话 完结 1080p', '2'], ['2025-10-02 第三话 完', '3'], ['姊烦10.1 0101~0110', '10.1']])(
    'fills the inferred chapter for %s', async (name, number) => {
      mockComicType({ pickDir: `C:\\漫画\\${name}` })
      const wrapper = await mountReady( { props: { mode: 'add' } })
      await wrapper.findAll('button').find(button => button.text() === '浏览')!.trigger('click')
      await nextTick()
      await nextTick()
      expect((wrapper.findAll('input')[2].element as HTMLInputElement).value).toBe(number)
      wrapper.unmount()
    }
  )

  it('keeps Tab within the dialog and returns focus to its opener on close', async () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const wrapper = await mountReady( { props: { mode: 'add' }, attachTo: document.body })
    const first = wrapper.get('#project-form-folderPath')
    const cancel = wrapper.findAll('button').find((button) => button.text() === '取消')!
    cancel.element.focus()
    await cancel.trigger('keydown', { key: 'Tab' })
    expect(document.activeElement).toBe(first.element)
    await first.trigger('keydown', { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(cancel.element)
    await cancel.trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('cancel')).toHaveLength(1)
    wrapper.unmount()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('add mode → renders empty fields, save disabled initially', async () => {
    const wrapper = await mountReady( { props: { mode: 'add' } })
    const inputs = wrapper.findAll('input')
    // 4 text inputs.
    expect(inputs).toHaveLength(4)
    for (const input of inputs) {
      expect((input.element as HTMLInputElement).value).toBe('')
    }
    // Save button disabled.
    const saveBtn = wrapper.findAll('button').find((b) => b.text() === '保存')
    expect(saveBtn).toBeTruthy()
    expect(saveBtn!.attributes('disabled')).toBeDefined()
  })

  it('pickDirectory fills path, valid stat → save enabled, click save emits save with correct payload', async () => {
    mockComicType({ pickDir: '/tmp/chapter1' })
    const wrapper = await mountReady( { props: { mode: 'add' } })

    // Click 浏览 button.
    const browseBtn = wrapper.findAll('button').find((b) => b.text() === '浏览')!
    await browseBtn.trigger('click')
    await nextTick()
    await nextTick()

    // Path input now filled.
    const pathInput = wrapper.findAll('input')[0]
    expect((pathInput.element as HTMLInputElement).value).toBe('/tmp/chapter1')

    // Fill remaining fields.
    const parentInput = wrapper.findAll('input')[1]
    const chapterInput = wrapper.findAll('input')[2]
    const titleInput = wrapper.findAll('input')[3]
    await parentInput.setValue('ドラゴンボール')
    await chapterInput.setValue('1')
    await titleInput.setValue('vol1')

    // Save enabled now (stat resolved ok).
    await nextTick()
    await nextTick()
    const saveBtn = wrapper.findAll('button').find((b) => b.text() === '保存')!
    expect(saveBtn.attributes('disabled')).toBeUndefined()

    // Click save → emits save with payload.
    await saveBtn.trigger('click')
    const events = wrapper.emitted('save')
    expect(events).toBeTruthy()
    expect(events![0]).toEqual([
      {
        parentTitle: 'ドラゴンボール',
        chapterNumber: '1',
        projectTitle: 'vol1',
        folderPath: '/tmp/chapter1'
      }
    ])
  })

  it('extracts a normalized chapter number from the selected folder name', async () => {
    mockComicType({ pickDir: 'C:\\漫画\\七龙珠003' })
    const wrapper = await mountReady( { props: { mode: 'add' } })

    await wrapper
      .findAll('button')
      .find((button) => button.text() === '浏览')!
      .trigger('click')
    await nextTick()
    await nextTick()

    expect((wrapper.findAll('input')[2].element as HTMLInputElement).value).toBe('3')
  })

  it('can add a Chinese chapter under an existing manga parent', async () => {
    mockComicType({ pickDir: 'C:\\漫画\\龙珠\\番外篇' })
    const wrapper = await mountReady( {
      props: { mode: 'add', existingParentTitles: ['海贼王', '龙珠'] }
    })

    wrapper.findComponent({ name: 'AppSelect' }).vm.$emit('update:modelValue', '龙珠')
    await nextTick()
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '浏览')!
      .trigger('click')
    await nextTick()
    await nextTick()

    const inputs = wrapper.findAll('input')
    await inputs[2].setValue('番外篇')
    await inputs[3].setValue('特别篇')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '保存')!
      .trigger('click')

    expect(wrapper.emitted('save')?.[0]).toEqual([
      {
        parentTitle: '龙珠',
        chapterNumber: '番外篇',
        projectTitle: '特别篇',
        folderPath: 'C:\\漫画\\龙珠\\番外篇'
      }
    ])
  })

  it('manage mode → fields prefilled, editing chapterNumber updates emit payload', async () => {
    mockComicType()
    const wrapper = await mountReady( {
      props: {
        mode: 'manage',
        initialData: {
          parentTitle: 'ワンピース',
          chapterNumber: '第10話',
          projectTitle: 'vol10',
          folderPath: '/tmp/onepiece10'
        }
      }
    })
    await nextTick()
    await nextTick()

    // Fields prefilled.
    const inputs = wrapper.findAll('input')
    expect((inputs[0].element as HTMLInputElement).value).toBe('/tmp/onepiece10')
    expect((inputs[1].element as HTMLInputElement).value).toBe('ワンピース')
    expect((inputs[2].element as HTMLInputElement).value).toBe('10')
    expect((inputs[3].element as HTMLInputElement).value).toBe('vol10')

    // Save enabled (path pre-validated ok).
    // 2026-10-04：校验现在**多读一次项目树**（挡"选到上级目录"），所以要多等一拍。
    // 断言本身没放松 —— 等的还是"校验完成后保存可用"。
    await nextTick()
    await nextTick()
    const saveBtn = wrapper.findAll('button').find((b) => b.text() === '保存')!
    expect(saveBtn.attributes('disabled')).toBeUndefined()

    // Edit chapterNumber.
    await inputs[2].setValue('11')

    // Click save → payload reflects edited value.
    await saveBtn.trigger('click')
    const events = wrapper.emitted('save')
    expect(events).toBeTruthy()
    expect(events![0]).toEqual([
      {
        parentTitle: 'ワンピース',
        chapterNumber: '11',
        projectTitle: 'vol10',
        folderPath: '/tmp/onepiece10'
      }
    ])
  })

  it('invalid path (stat throws) → shows red hint, save disabled', async () => {
    mockComicType({ statThrow: true })
    const wrapper = await mountReady( { props: { mode: 'add' } })

    // Type a path and blur to trigger validation.
    const pathInput = wrapper.findAll('input')[0]
    await pathInput.setValue('/nonexistent/path')
    await pathInput.trigger('blur')
    await nextTick()
    await nextTick()

    // Red hint shown.
    expect(wrapper.html()).toContain('路径不可读或不存在')
    expect(wrapper.find('.text-danger').exists()).toBe(true)

    // Save disabled.
    const saveBtn = wrapper.findAll('button').find((b) => b.text() === '保存')!
    expect(saveBtn.attributes('disabled')).toBeDefined()
  })

  it('does not close when a text-selection drag ends outside the input', async () => {
    const wrapper = await mountReady( { props: { mode: 'add' } })
    await wrapper.find('input').trigger('pointerdown')
    await wrapper.find('.fixed.inset-0').trigger('click')
    expect(wrapper.emitted('cancel')).toBeFalsy()

    await wrapper.find('.fixed.inset-0').trigger('pointerdown')
    await wrapper.find('.fixed.inset-0').trigger('click')
    expect(wrapper.emitted('cancel')).toHaveLength(1)
  })

  it('manage mode → click delete emits delete', async () => {
    mockComicType()
    const wrapper = await mountReady( {
      props: {
        mode: 'manage',
        initialData: {
          parentTitle: 'ナルト',
          chapterNumber: '第1話',
          projectTitle: 'vol1',
          folderPath: '/tmp/naruto1'
        }
      }
    })
    await nextTick()
    await nextTick()

    // Delete button visible in manage mode.
    const deleteBtn = wrapper.findAll('button').find((b) => b.text() === '删除')!
    expect(deleteBtn).toBeTruthy()

    await deleteBtn.trigger('click')
    expect(wrapper.emitted('delete')).toBeTruthy()
    expect(wrapper.emitted('delete')!.length).toBe(1)
  })


  it('选到别的章节的上级目录 → 红字提示 + 保存禁用', async () => {
    const container = 'D:\\漫画库\\某作品（米饭'
    mockComicType({
      pickDir: container,
      tree: [
        {
          id: 'parent-1',
          title: '某作品',
          lastMtimeMs: 0,
          children: [
            {
              id: 'c1',
              parentTitle: '某作品',
              chapterNumber: '5',
              projectTitle: '某作品5卷',
              folderPath: `${container}\\某作品5卷`,
              lastMtimeMs: 0
            }
          ]
        }
      ]
    })
    const wrapper = await mountReady( { props: { mode: 'add' } })

    await wrapper
      .findAll('button')
      .find((button) => button.text() === '浏览')!
      .trigger('click')
    await nextTick()
    await nextTick()

    expect(wrapper.html()).toContain('上级目录')
    const saveBtn = wrapper.findAll('button').find((b) => b.text() === '保存')!
    expect(saveBtn.attributes('disabled')).toBeDefined()
  })


  it('必填星号只挂在"路径"与"漫画名称(父级)"上（与保存校验逐条一致）', async () => {
    const wrapper = await mountReady( { props: { mode: 'add' } })

    const marks = wrapper.findAll('[data-testid="required-mark"]')
    expect(marks).toHaveLength(PROJECT_FORM_REQUIRED.length)

    const markedLabels = marks.map((mark) =>
      (mark.element.closest('label')?.textContent ?? '').trim()
    )
    expect(markedLabels[0]).toContain('项目所在文件夹路径')
    expect(markedLabels[1]).toContain('漫画名称(父级)')

    // 逆向锁：可选的两项不许跟着挂星号
    for (const optional of ['集数', '项目标题']) {
      const label = wrapper.findAll('label').find((node) => node.text().startsWith(optional))
      expect(label, `找不到「${optional}」的 label`).toBeTruthy()
      expect(label!.find('[data-testid="required-mark"]').exists()).toBe(false)
    }

    // 读屏也要能听出"必填"：星号本身对辅助技术隐藏，必填语义走 aria-required
    expect(marks[0].attributes('aria-hidden')).toBe('true')
    const inputs = wrapper.findAll('input')
    expect(inputs[0].attributes('aria-required')).toBe('true')
    expect(inputs[1].attributes('aria-required')).toBe('true')
    expect(inputs[2].attributes('aria-required')).toBeUndefined()
    expect(inputs[3].attributes('aria-required')).toBeUndefined()
  })

  it('四个输入框的框内提示与 project-form-hints 同源，且提示不会与真实值混淆', async () => {
    const wrapper = await mountReady( { props: { mode: 'add' } })
    const inputs = wrapper.findAll('input')
    const expected = [
      PROJECT_FORM_HINTS.folderPath,
      PROJECT_FORM_HINTS.parentTitle,
      PROJECT_FORM_HINTS.chapterNumber,
      PROJECT_FORM_HINTS.projectTitle
    ]

    inputs.forEach((input, index) => {
      expect(input.attributes('placeholder')).toBe(expected[index])
    })

    // 提示只住在 `placeholder` 属性上，真实值住在 DOM 的 `value` 里 —— 两者是两回事：
    // 初始没有任何 value（所以框里显示的只能是那行浅色提示）；一旦输入，value 有值，
    // 浏览器自己把提示藏起来（原生行为，不需要我们为"消除"写任何逻辑）。
    const titleInput = inputs[3]
    expect((titleInput.element as HTMLInputElement).value).toBe('')
    await titleInput.setValue('特别篇')
    expect((titleInput.element as HTMLInputElement).value).toBe('特别篇')
    expect(titleInput.attributes('placeholder')).toBe(PROJECT_FORM_HINTS.projectTitle)
  })
})

async function mountReady(options: { props: InstanceType<typeof ProjectFormModal>['$props']; attachTo?: Element | string }) {
 const wrapper = mount(ProjectFormModal, { attachTo: document.body, ...options })
 await flushPromises()
 return wrapper
}
