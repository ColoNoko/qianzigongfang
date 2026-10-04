// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import ProjectFormModal from '../ProjectFormModal.vue'
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
  /** 已登记的项目树 —— `validatePath()` 会读它挡"选到了别的章节的上级目录"（2026-10-04）。 */
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

describe('ProjectFormModal', () => {
  beforeEach(() => {
    mockComicType()
  })

  it('add mode → renders empty fields, save disabled initially', () => {
    const wrapper = mount(ProjectFormModal, { props: { mode: 'add' } })
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
    const wrapper = mount(ProjectFormModal, { props: { mode: 'add' } })

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
    const wrapper = mount(ProjectFormModal, { props: { mode: 'add' } })

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
    const wrapper = mount(ProjectFormModal, {
      props: { mode: 'add', existingParentTitles: ['海贼王', '龙珠'] }
    })

    await wrapper.get('[data-testid="existing-parent-select"]').setValue('龙珠')
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
    const wrapper = mount(ProjectFormModal, {
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
    const wrapper = mount(ProjectFormModal, { props: { mode: 'add' } })

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
    const wrapper = mount(ProjectFormModal, { props: { mode: 'add' } })
    await wrapper.find('input').trigger('pointerdown')
    await wrapper.find('.fixed.inset-0').trigger('click')
    expect(wrapper.emitted('cancel')).toBeFalsy()

    await wrapper.find('.fixed.inset-0').trigger('pointerdown')
    await wrapper.find('.fixed.inset-0').trigger('click')
    expect(wrapper.emitted('cancel')).toHaveLength(1)
  })

  it('manage mode → click delete emits delete', async () => {
    mockComicType()
    const wrapper = mount(ProjectFormModal, {
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

  /**
   * 2026-10-04 现场：把「第6卷」的路径改成了 `…\某作品（米饭`
   * （= 各卷的**父目录**）。那种路径一进库，"刷新并检测新章节"就会把
   * **同级作品**当成这一话的新章节报出来（实测 15 条）。
   * 这里锁的是**录入侧当场拦住**：红字 + 保存禁用，不让它进库。
   *
   * ⚠️ 路径一律用中性占位（`D:\漫画库\…`）—— 本文件进**公开仓**，
   *    审计硬拦真实盘符路径 / 目录名（本文件既有的 fixture 也是这个惯例）。
   */
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
    const wrapper = mount(ProjectFormModal, { props: { mode: 'add' } })

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
})
