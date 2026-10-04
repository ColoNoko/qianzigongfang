// @vitest-environment jsdom
/**
 * 开发期 IPC 参数护栏。断言必须能抓住它要防的那类失败：
 * 把 Vue 的响应式代理（ref/reactive）或其它不可克隆的值直接发给 IPC。
 */
import { describe, expect, it } from 'vitest'
import { reactive, ref } from 'vue'
import {
  IPC_GUARD_FLAG,
  assertIpcPayloadCloneable,
  isIpcGuardEnabled
} from '../ipc-guard'

describe('isIpcGuardEnabled', () => {
  it('argv 里有 flag 才开', () => {
    expect(isIpcGuardEnabled([IPC_GUARD_FLAG])).toBe(true)
    expect(isIpcGuardEnabled(['--other', IPC_GUARD_FLAG, 'x'])).toBe(true)
  })

  it('打包环境（没有 flag）与异常 argv 一律当作关', () => {
    expect(isIpcGuardEnabled([])).toBe(false)
    expect(isIpcGuardEnabled(undefined)).toBe(false)
    expect(isIpcGuardEnabled(['--qianzi-ipc-guard-typo'])).toBe(false)
  })
})

describe('assertIpcPayloadCloneable', () => {
  it('普通参数放行', () => {
    expect(() =>
      assertIpcPayloadCloneable('comicType:x', [
        'parent-1',
        ['a', 'b'],
        { items: [{ folderPath: 'E:\\x', chapterNumber: '' }] },
        undefined,
        null,
        1
      ])
    ).not.toThrow()
  })

  it('响应式数组（真实事故的那种）会抛，并且点名 channel 与下标', () => {
    const roots = ref(['E:\\搬砖\\有', 'E:\\搬砖\\无'])
    expect(() => assertIpcPayloadCloneable('comicType:selfCheckImport', [{ sourceRoots: roots.value }])).toThrow(
      /comicType:selfCheckImport/
    )
    expect(() =>
      assertIpcPayloadCloneable('comicType:selfCheckImport', ['parent-1', reactive(['a'])])
    ).toThrow(/第 1 个参数/)
  })

  it('函数这类也不放过', () => {
    expect(() => assertIpcPayloadCloneable('comicType:x', [() => undefined])).toThrow(
      /第 0 个参数/
    )
    // 刻意不测 DOM 节点：jsdom 的 structuredClone 是 Node 的实现，会把 jsdom 元素
    // 当普通对象克隆、不抛错；"DOM 节点不可克隆"只有真实 Blink 环境才成立，
    // 在单测里断言它只会得到一条永远绿的假覆盖。
  })

  it('错误信息带修复指引（别再让它只报一句 could not be cloned）', () => {
    // 指引必须**自洽**：早先写的是"详见某份内部文档 §13.2"，而那份文档不在公开仓里 ——
    // 用户/贡献者照着找只会扑空（2026-10-04 开源清理时改的）
    expect(() => assertIpcPayloadCloneable('comicType:x', [() => undefined])).toThrow(
      /先摊平成普通对象\/数组再发/
    )
  })
})
