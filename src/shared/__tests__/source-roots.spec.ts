// @vitest-environment node
/**
 * 「记住的扫描根」规则（`shared/source-roots.ts`）—— 2026-10-05 收编。
 *
 * 为什么值得单独一个文件：这一组是**纯规则**（不碰数据库、不碰磁盘），但两边都要用：
 *   · 主进程写入侧：`project-repository.setParentSourceRoots`（在事务里调 `apply…`）；
 *   · 主进程推导侧：`project-self-check` 每次自检前都要洗一遍记住的根；
 *   · 渲染层：把字段**原样带过整棵树**（`readRememberedRoots`，丢了就是 2026-10-03 那个真数据丢失 bug）。
 *
 * ⚠️ 为什么把它从 `project-repository.ts` 里搬出来：那个模块连数据库，
 * `project-self-check.spec.ts` 会**整个 mock 掉**它 —— 纯规则放在里面，会被连带 mock 掉，
 * 于是"写一对字段"这条锁在那一侧根本跑不到（搬迁当天就被打红过）。
 * 这与 `shared/duties.ts`（职责规则）是同一套做法：**一个领域规则一个文件**。
 */
import { describe, expect, it } from 'vitest'
import {
  applyParentSourceRoots,
  findOtherParentInside,
  normalizeRememberedRoots,
  readRememberedRoots
} from '../source-roots'
import type { ParentProject } from '../types'

function parent(): ParentProject {
  return { id: 'p1', title: '搬砖', lastMtimeMs: 0, children: [] }
}

/** 造一个"带着话"的父级（`findOtherParentInside` 只看 children[].folderPath）。 */
function workWith(id: string, title: string, childPaths: string[]): ParentProject {
  return {
    id,
    title,
    lastMtimeMs: 0,
    children: childPaths.map((folderPath) => ({
      id: `c-${id}-${folderPath}`,
      parentTitle: title,
      folderPath,
      chapterNumber: '',
      projectTitle: folderPath.split(/[\\/]/).pop() ?? '',
      lastMtimeMs: 0
    }))
  }
}

describe('readRememberedRoots — 渲染层"原样带过去"用的轻清洗', () => {
  it('只滤掉非字符串与空串，**不去重也不归一化**（那是主进程写入侧的事）', () => {
    expect(readRememberedRoots(['D:\\漫画库\\作品\\无', '', 42, null])).toEqual([
      'D:\\漫画库\\作品\\无'
    ])
    // 同一目录的两种写法在渲染层**都留着** —— 它不参与推导，只负责别把字段弄丢
    expect(readRememberedRoots(['D:\\漫画库\\作品\\无', 'd:/漫画库/作品/无'])).toHaveLength(2)
  })

  it('不是数组 / 全是垃圾 ⇒ 空数组（调用方据此把字段留成 undefined，不写空数组）', () => {
    expect(readRememberedRoots('D:\\漫画库')).toEqual([])
    expect(readRememberedRoots(undefined)).toEqual([])
    expect(readRememberedRoots([null, 0, '  '])).toEqual([])
  })
})

describe('normalizeRememberedRoots — 写入与推导前的完整清洗', () => {
  it('丢掉非字符串 / 空串 / 纯空白', () => {
    expect(
      normalizeRememberedRoots([42, null, undefined, {}, '', '   ', 'D:\\漫画库\\作品\\无'])
    ).toEqual(['D:\\漫画库\\作品\\无'])
  })

  it('按"路径当 key"去重：保留**第一次出现的原样写法**与顺序', () => {
    expect(
      normalizeRememberedRoots([
        'D:\\漫画库\\作品\\无',
        'd:/漫画库/作品/无/', // 同一个目录（大小写 + 尾斜杠）
        'D:\\漫画库\\作品\\有'
      ])
    ).toEqual(['D:\\漫画库\\作品\\无', 'D:\\漫画库\\作品\\有'])
  })

  it('两边的空白会被裁掉（存库的路径不带首尾空白）', () => {
    expect(normalizeRememberedRoots(['  D:\\漫画库\\作品\\无  '])).toEqual(['D:\\漫画库\\作品\\无'])
  })

  it('全被洗掉时给空数组（调用方据此决定"把字段删掉"）', () => {
    expect(normalizeRememberedRoots([null, '', '  '])).toEqual([])
    expect(normalizeRememberedRoots([])).toEqual([])
  })
})

/**
 * 「两个字段是一件事的两本账」—— 这一组就是那条"提前退出留半截状态"的病灶本身。
 * `sourceRoot`（旧字段）与 `sourceRoots`（主字段）读取时是**拼起来**用的，
 * 只写其中一个，另一个里的旧值就会继续参与扫描。
 */
describe('applyParentSourceRoots — 两个字段一起写（唯一写入口）', () => {
  it('写多个根：sourceRoots 落库、sourceRoot 同步成第一个', () => {
    const p = parent()
    applyParentSourceRoots(p, ['D:\\漫画库\\作品\\无', 'D:\\漫画库\\作品\\有'])

    expect(p.sourceRoots).toEqual(['D:\\漫画库\\作品\\无', 'D:\\漫画库\\作品\\有'])
    expect(p.sourceRoot).toBe('D:\\漫画库\\作品\\无')
  })

  it('**替换**语义：新的一批盖掉旧的，两个字段里都不许留下旧根', () => {
    const p = parent()
    applyParentSourceRoots(p, ['D:\\漫画库\\作品\\无', 'D:\\漫画库\\作品\\有'])
    applyParentSourceRoots(p, ['E:\\搬砖\\有'])

    expect(p.sourceRoots).toEqual(['E:\\搬砖\\有'])
    expect(p.sourceRoot).toBe('E:\\搬砖\\有')
  })

  it('null / 空数组 / 全是垃圾 ⇒ 两个字段都删掉（= 恢复自动推导，不留空数组）', () => {
    for (const empty of [null, [], ['  '], [7]] as const) {
      const p = parent()
      applyParentSourceRoots(p, ['D:\\漫画库\\作品\\无'])
      applyParentSourceRoots(p, empty)

      expect(Object.hasOwn(p, 'sourceRoots'), `清空后还留着 sourceRoots：${String(empty)}`).toBe(
        false
      )
      expect(Object.hasOwn(p, 'sourceRoot'), `清空后还留着 sourceRoot：${String(empty)}`).toBe(
        false
      )
    }
  })

  it('清洗在写入口里做完：传进去的重复项 / 尾斜杠 / 空白不会被原样存下', () => {
    const p = parent()
    applyParentSourceRoots(p, ['  D:\\漫画库\\作品\\无  ', 'd:/漫画库/作品/无/'])

    expect(p.sourceRoots).toEqual(['D:\\漫画库\\作品\\无'])
    expect(p.sourceRoot).toBe('D:\\漫画库\\作品\\无')
  })
})

/**
 * 「这个目录下面住着**别的作品**的话吗」—— B1 判据与「修改扫描目录」弹窗共用的同一把尺子。
 *
 * ⚠️ 三个容易搞错的点，全部锁在下面：
 *   ① **自己的话不算**！扫描根本来就是"各话所在的那一层"，它必然是自己那些话的上级 ——
 *      若把"自己的话在里面"也算命中，任何根都会被判成容器层（B1 会全盘失效）。
 *   ② 跨盘的章节不算（复用 `isStrictlyInside` 的跨卷语义，2026-10-04 那次连坐）。
 *   ③ 字符串前缀相同但不是父子（`某作品` vs `某作品5卷`）不算。
 *
 * 返回值是**那一部作品本身**（不是布尔）：弹窗要拿它的标题告诉用户
 * "这个目录里住着《某作品A》的话"，比一句"这里有问题"有用得多。
 */
describe('findOtherParentInside — 根下面住着别的作品吗', () => {
  const self = workWith('p-self', '老师的人偶', [
    'D:\\漫画库\\嵌字\\老师的人偶（米饭\\老师的人偶5卷'
  ])
  const otherMama = workWith('p-mamaA', '某作品A', ['D:\\漫画库\\嵌字\\某作品A\\第1话'])
  const otherNordic = workWith('p-nordic', '某作品C', ['Z:\\外部盘\\某作品C\\第1话'])

  it('别的作品的章节落在根里面 ⇒ 返回那一部（标题能直接说给用户听）', () => {
    const found = findOtherParentInside('D:\\漫画库\\嵌字', 'p-self', [
      self,
      otherMama,
      otherNordic
    ])
    expect(found?.title).toBe('某作品A')
  })

  it('只有自己的话在根里面 ⇒ undefined（这是扫描根的**正常形态**，不能算命中）', () => {
    const root = 'D:\\漫画库\\嵌字\\老师的人偶（米饭'
    expect(findOtherParentInside(root, 'p-self', [self, otherMama])).toBeUndefined()
  })

  it('别的作品的章节在**另一个盘** ⇒ undefined（跨盘不算"在里面"）', () => {
    // 这一条就是 2026-10-04 那次"所有 D 盘父级被 E 盘那本连坐"的形状。
    expect(findOtherParentInside('D:\\漫画库\\嵌字', 'p-self', [self, otherNordic])).toBeUndefined()
  })

  it('字符串前缀相同但不是父子 ⇒ undefined（"某作品" 不是 "某作品5卷" 的父目录）', () => {
    const sibling = workWith('p-5', '某作品5卷', ['D:\\漫画库\\某作品5卷\\第1话'])
    expect(findOtherParentInside('D:\\漫画库\\某作品', 'p-self', [sibling])).toBeUndefined()
  })

  it('根就是别的作品自己的那一层（不是它的上级）⇒ undefined', () => {
    // 根正好是"别人的作品那一层"时，那部作品的话确实在它**里面** —— 这一条**算命中**，
    // 因为对这个父级来说，扫这一层就会把别人的话当成自己的新章节。
    const found = findOtherParentInside('D:\\漫画库\\嵌字\\某作品A', 'p-self', [self, otherMama])
    expect(found?.title).toBe('某作品A')
  })
})
