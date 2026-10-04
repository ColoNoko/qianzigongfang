// @vitest-environment node
/**
 * 「检查更新」的口径（2026-10-04 新增）。
 *
 * 这一轮的目标是"老用户自己更新，作者不再一对一发包"，做法是 **C3**：
 * 程序只**发现**新版本 + 引导去下载页，**不下载、不替换、不重启**。
 * 所以这里锁的全部是"比对与解析"逻辑 —— 纯函数，没有网络、不碰文件系统。
 *
 * ⚠️ 最容易错的两处（都单独锁）：
 *   ① 版本比较：`1.0.10` 比 `1.0.9` **新**（按段比数字，不是按字符串比）；
 *   ② 清单校验：远端返回垃圾/半截 JSON 时必须**当没这回事**（返回 null），
 *      绝不能让界面上冒出"发现新版本 vundefined"。
 */
import { describe, expect, it } from 'vitest'
import {
  compareVersions,
  isNewerVersion,
  parseUpdateManifest,
  UPDATE_DOWNLOAD_PAGE_URL,
  UPDATE_MANIFEST_URL,
  type UpdateManifest
} from '../update'

const validManifest = {
  version: '1.0.1',
  notes: '修了几个小问题',
  url: 'https://gitee.com/Luo-yuan-z/qianzi-gongfang/releases/download/v1.0.1/x.zip',
  sha256: 'a'.repeat(64),
  size: 77_400_000
}

describe('compareVersions：按段比数字', () => {
  it('相同版本 = 0（各种写法都算相同）', () => {
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
    expect(compareVersions('v1.0.0', '1.0.0')).toBe(0)
    expect(compareVersions(' 1.0.0 ', '1.0.0')).toBe(0)
  })

  it('**1.0.10 比 1.0.9 新**（按字符串比会判反）', () => {
    expect(compareVersions('1.0.10', '1.0.9')).toBeGreaterThan(0)
    expect(compareVersions('1.0.9', '1.0.10')).toBeLessThan(0)
  })

  it('段数不同也能比：1.0 与 1.0.0 相等、1.1 比 1.0.9 新', () => {
    expect(compareVersions('1.0', '1.0.0')).toBe(0)
    expect(compareVersions('1.1', '1.0.9')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0.1', '1.0.0')).toBeGreaterThan(0)
  })

  it('大版本优先：2.0.0 比 1.99.99 新', () => {
    expect(compareVersions('2.0.0', '1.99.99')).toBeGreaterThan(0)
  })

  it('同一段里数字与非数字混着写也不崩（取数字前缀，缺失当 0）', () => {
    expect(compareVersions('1.0.0-beta', '1.0.0')).toBe(0)
    expect(compareVersions('', '0.0.0')).toBe(0)
    expect(compareVersions('abc', '0.0.0')).toBe(0)
  })
})

describe('isNewerVersion：只有真的更新才算更新', () => {
  it('远端更高 → true；相同或更低 → false', () => {
    expect(isNewerVersion('1.0.1', '1.0.0')).toBe(true)
    expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false)
    expect(isNewerVersion('0.9.9', '1.0.0')).toBe(false)
  })
})

describe('parseUpdateManifest：垃圾清单当"没这回事"', () => {
  it('正常清单原样读出来', () => {
    const manifest = parseUpdateManifest(validManifest)
    expect(manifest).toEqual<UpdateManifest>(validManifest)
  })

  it('缺字段（version / url / notes）→ null', () => {
    expect(parseUpdateManifest({ ...validManifest, version: undefined })).toBeNull()
    expect(parseUpdateManifest({ ...validManifest, url: undefined })).toBeNull()
    expect(parseUpdateManifest({ ...validManifest, notes: undefined })).toBeNull()
  })

  it('版本号不像版本（undefined / 空串 / 乱七八糟）→ null', () => {
    expect(parseUpdateManifest({ ...validManifest, version: '' })).toBeNull()
    expect(parseUpdateManifest({ ...validManifest, version: '最新版' })).toBeNull()
    expect(parseUpdateManifest({ ...validManifest, version: 123 })).toBeNull()
  })

  it('下载地址必须是 https（http / file / javascript 一律不认）', () => {
    expect(
      parseUpdateManifest({ ...validManifest, url: 'http://gitee.com/x/y.zip' })
    ).toBeNull()
    expect(parseUpdateManifest({ ...validManifest, url: 'file:///C:/x.zip' })).toBeNull()
    expect(parseUpdateManifest({ ...validManifest, url: 'javascript:alert(1)' })).toBeNull()
  })

  it('整个响应不是对象（null / 字符串 / 数组）→ null', () => {
    expect(parseUpdateManifest(null)).toBeNull()
    expect(parseUpdateManifest('oops')).toBeNull()
    expect(parseUpdateManifest([])).toBeNull()
  })

  it('可选字段缺失也行（sha256 / size 没写就不显示，不算错）', () => {
    const { sha256: _sha, size: _size, ...rest } = validManifest
    expect(parseUpdateManifest(rest)).toEqual<UpdateManifest>({
      version: rest.version,
      notes: rest.notes,
      url: rest.url
    })
  })
})

describe('清单与下载页地址：一处定义', () => {
  it('两个地址都是 https 的 Gitee 地址（公开仓）', () => {
    expect(UPDATE_MANIFEST_URL.startsWith('https://gitee.com/')).toBe(true)
    expect(UPDATE_DOWNLOAD_PAGE_URL.startsWith('https://gitee.com/')).toBe(true)
    expect(UPDATE_MANIFEST_URL.endsWith('latest.json')).toBe(true)
    expect(UPDATE_DOWNLOAD_PAGE_URL.endsWith('/releases')).toBe(true)
  })
})
