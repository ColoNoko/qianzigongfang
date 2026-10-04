// @vitest-environment node
/**
 * 外链白名单（`shared/external-url.ts`）。
 *
 * 这是**安全边界**：渲染进程能把任意字符串交给主进程 `shell.openExternal`，
 * 所以"什么能放行"必须是纯函数 + 表格化用例，而不是散在 handler 里的 if。
 */
import { describe, expect, it } from 'vitest'
import { FONT_IDENTIFY_SITE, normalizeExternalUrl } from '../external-url'

describe('normalizeExternalUrl', () => {
  it('放行 http / https', () => {
    expect(normalizeExternalUrl('https://www.qiuziti.com/')).toBe('https://www.qiuziti.com/')
    expect(normalizeExternalUrl('http://example.com/a?b=1')).toBe('http://example.com/a?b=1')
    // 协议与主机名会被规范化
    expect(normalizeExternalUrl('HTTPS://WWW.QIUZITI.COM')).toBe('https://www.qiuziti.com/')
  })

  it('两端空白先去掉（用户粘贴常带空格）', () => {
    expect(normalizeExternalUrl('  https://www.qiuziti.com/  ')).toBe('https://www.qiuziti.com/')
  })

  it.each([
    ['空字符串', ''],
    ['只有空格', '   '],
    ['不是字符串', 42],
    ['缺失', undefined],
    ['null', null],
    ['本地文件', 'file:///C:/Windows/System32/calc.exe'],
    ['脚本协议', 'javascript:alert(1)'],
    ['数据协议', 'data:text/html,<script>alert(1)</script>'],
    ['没有协议', 'www.qiuziti.com'],
    ['纯文字', '识字网']
  ])('挡掉%s', (_label, value) => {
    expect(normalizeExternalUrl(value)).toBeNull()
  })

  /**
   * 解析器的**宽容之处**，如实记下来：WHATWG 的 `URL` 会把 `https:/x`（少一个斜杠）
   * 规范化成 `https://x/`。这不是漏洞 —— 结果仍然是 https，只是"看起来写错了的网址"
   * 也能过。要强行拦住得自己再加一条正则，**收益为零**，所以不加。
   */
  it('少一个斜杠的写法会被规范化（不是被挡下）', () => {
    expect(normalizeExternalUrl('https:/www.qiuziti.com')).toBe('https://www.qiuziti.com/')
  })

  it('项目里那个识字网地址本身必须能过白名单（否则按钮点了只是报错）', () => {
    expect(normalizeExternalUrl(FONT_IDENTIFY_SITE)).toBe(FONT_IDENTIFY_SITE)
  })
})
