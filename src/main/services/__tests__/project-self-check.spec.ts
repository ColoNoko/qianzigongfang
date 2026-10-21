// @vitest-environment node
/**
 * 「刷新并检测新章节」的扫描根与集数冲突判定。
 *
 * 这个模块此前 **0 覆盖**，所以下面这条路径从来没被锁住过：当同一父级下的
 * 子项目分散在多个中间目录里（真实案例：`搬砖\{无,有}\<章节>`），
 * `getSourceRoot()` 的第一条策略不成立，就会静默回落到 `commonSourceRoot()` ——
 * 也就是**比章节目录高一级**的那个目录，于是「无/有/【红尘】」这种分类目录
 * 被当成"新章节"，又因为集数解析不出来（都归一化成空串）而全部报
 * "同父级下已存在该集数"。
 *
 * 这里用临时目录搭一个与真实库同构的 fixture，直接调真实代码路径
 * （只把 project-repository 换成内存树、logger 换掉，两个都依赖 electron）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile, rename } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { ChildProject, ParentProject } from '@shared/types'

const repo = vi.hoisted(() => ({
  tree: [] as ParentProject[],
  getProjectTree: vi.fn(),
  updateProjectTree: vi.fn(),
  setProjectSourceRoot: vi.fn()
}))

vi.mock('../project-repository', () => ({
  getProjectTree: repo.getProjectTree,
  updateProjectTree: repo.updateProjectTree,
  setProjectSourceRoot: repo.setProjectSourceRoot
}))

vi.mock('../logger', () => ({ writeLog: vi.fn().mockResolvedValue(undefined) }))

import {
  detectRenamedCandidates,
  importParentSelfCheck,
  previewParentSelfCheck
} from '../project-self-check'
import { scanChildProject } from '../scanner'
import { computeIdentityFingerprint } from '../scan-fingerprint'

const PARENT_ID = 'parent-搬砖'

it('background discovery skips empty directories but manual import still allows them', async () => {
  const empty = join(work, 'empty')
  await mkdir(empty)
  const request = {
    parentId: PARENT_ID,
    sourceRoot: work,
    rememberSourceRoot: false,
    requireContent: true,
    items: [{ folderPath: empty, folderName: 'empty', chapterNumber: '99', projectTitle: 'empty' }]
  }
  expect(await importParentSelfCheck(request)).toEqual({ added: 0, skipped: 1, failed: 0 })
  expect(await importParentSelfCheck({ ...request, requireContent: false })).toEqual({
    added: 1,
    skipped: 0,
    failed: 0
  })
})

function child(id: string, folderPath: string, chapterNumber = ''): ChildProject {
  return {
    id,
    parentTitle: '搬砖',
    folderPath,
    chapterNumber,
    projectTitle: folderPath.split(/[\\/]/).pop() ?? '',
    lastMtimeMs: 0
  }
}

/** 让一个目录看起来像章节目录：至少有一张图。 */
async function makeChapterDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, '01.jpg'), Buffer.alloc(64))
}

let work: string
let banZhuan: string
let wu: string
let you: string
let hongChen: string

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), 'qianzi-selfcheck-'))
  banZhuan = join(work, '搬砖')
  wu = join(banZhuan, '无')
  you = join(banZhuan, '有')
  hongChen = join(banZhuan, '【红尘】')

  await makeChapterDir(join(wu, '已存在2'))
  await makeChapterDir(join(wu, '已存在3'))
  await makeChapterDir(join(you, '已存在1'))
  await makeChapterDir(join(wu, '新章节A'))
  await makeChapterDir(join(you, '新章节B'))
  await makeChapterDir(join(hongChen, '还没登记过的分类下的章节'))

  // 与真实库同构：三个子项目、集数都是空串（界面显示"未设置集数"），
  // 第一个在 `有` 下，另外两个在 `无` 下 —— 这正是老实现踩空的那一步。
  repo.tree = [
    {
      id: PARENT_ID,
      title: '搬砖',
      children: [
        child('c1', join(you, '已存在1')),
        child('c2', join(wu, '已存在2')),
        child('c3', join(wu, '已存在3'))
      ],
      lastMtimeMs: 0
    }
  ]
  repo.getProjectTree.mockImplementation(async () => repo.tree)
  repo.updateProjectTree.mockImplementation(
    async (mutator: (projects: ParentProject[]) => unknown) => mutator(repo.tree)
  )
})

afterEach(async () => {
  await rm(work, { recursive: true, force: true })
  vi.clearAllMocks()
})

describe('previewParentSelfCheck — 扫描根', () => {
  it('uses semantic chapter parsing for discovery, ignoring dates and page ranges', async () => {
    const examples = [
      ['第十二话 完', '12'],
      ['2025-10-02 第三话 完', '3'],
      ['姊烦10.1 0101~0110', '10.1']
    ]
    for (const [name] of examples) await makeChapterDir(join(wu, name))
    const result = await previewParentSelfCheck(PARENT_ID)
    for (const [name, number] of examples) {
      expect(
        result.candidates.find((candidate) => candidate.folderName === name)?.chapterNumber
      ).toBe(number)
    }
  })
  it('子项目分散在多个目录时，扫的是它们各自所在的那一层，而不是上一层', async () => {
    const result = await previewParentSelfCheck(PARENT_ID)

    expect(result.canDetect).toBe(true)
    expect([...result.sourceRoots].sort()).toEqual([wu, you].sort())
    // 兼容字段：主根 = 第一个根
    expect(result.sourceRoot).toBe(result.sourceRoots[0])
  })

  it('分类目录本身不会被当成新章节（这是那个"莫名其妙的名字"的来源）', async () => {
    const result = await previewParentSelfCheck(PARENT_ID)

    const names = result.candidates.map((candidate) => candidate.folderName).sort()
    expect(names).toEqual(['新章节A', '新章节B'])
    for (const container of [wu, you, hongChen]) {
      expect(result.candidates.some((candidate) => candidate.folderPath === container)).toBe(false)
    }
  })

  it('未识别集数的候选不再被判成"同父级下已存在该集数"', async () => {
    const result = await previewParentSelfCheck(PARENT_ID)

    expect(result.candidates).toHaveLength(2)
    expect(result.candidates.every((candidate) => candidate.chapterNumber === '')).toBe(true)
    expect(result.candidates.every((candidate) => candidate.conflict === 'none')).toBe(true)
    expect(
      result.candidates.every((candidate) => candidate.existingChapterNumber === undefined)
    ).toBe(true)
  })

  it('已登记的目录只算重复，不算候选', async () => {
    const result = await previewParentSelfCheck(PARENT_ID)
    // 三个已登记的子项目正好就是两个根的一级子目录。
    expect(result.duplicatePaths).toBe(3)
  })

  it('没有记住过目录时才自动推导；记住的目录说了算', async () => {
    // ⚠️ 这里原来记的是 `you/已存在1` —— 那是**某一话自己的文件夹**，
    // 2026-10-05 起这种根会被守卫拒用（见下面的用例）。改成记"某一层目录"。
    repo.tree[0].sourceRoots = [wu]
    const result = await previewParentSelfCheck(PARENT_ID)

    expect(result.sourceRoots).toEqual([wu])
    // 记住 `wu` ⇒ 只看 `wu` 那一层：`新章节A` 出现，`新章节B`（在 `有` 下）**不该**出现。
    expect(result.candidates.map((c) => c.folderName)).toEqual(['新章节A'])
  })

  it('只记得一个旧字段 sourceRoot 时，等价于单根', async () => {
    repo.tree[0].sourceRoot = wu
    const result = await previewParentSelfCheck(PARENT_ID)

    expect(result.sourceRoots).toEqual([wu])
    expect(result.candidates.map((c) => c.folderName)).toEqual(['新章节A'])
  })

  it('一个根是另一个根的祖先时：两个根都保留，但容器本身不算候选', async () => {
    // 第二种真实布局：章节既直接放在父级目录下，也有放在子目录下的。
    await makeChapterDir(join(banZhuan, '直接放在父级下的新章节'))
    repo.tree[0].children = [
      child('c1', join(wu, '已存在2')),
      child('c2', join(banZhuan, '已存在的直系章节'))
    ]
    await makeChapterDir(join(banZhuan, '已存在的直系章节'))

    const result = await previewParentSelfCheck(PARENT_ID)

    expect([...result.sourceRoots].sort()).toEqual([banZhuan, wu].sort())
    const names = result.candidates.map((c) => c.folderName)
    expect(names).toContain('新章节A')
    expect(names).toContain('直接放在父级下的新章节')
    // 保证：**根本身永远不算候选**（`无` 既是根、又恰好是一级子目录）。
    expect(names).not.toContain('无')
    // 已知边界（不写成断言）：混合层级时，父级目录下那些既不是根、又不含章节的
    // 分类目录（有 / 【红尘】）在这一层看起来和章节目录一样，无法自动区分。
  })

  it('所有根都读不到时给出"无法自动确定"而不是假装扫到 0 个', async () => {
    repo.tree[0].children = [child('c1', join(work, '不存在的目录', '章节'))]
    const result = await previewParentSelfCheck(PARENT_ID)

    expect(result.canDetect).toBe(false)
    expect(result.candidates).toEqual([])
  })

  it('部分根读不到时，剩下的根照常出候选，并报告读不到的根', async () => {
    repo.tree[0].children = [
      child('c1', join(wu, '已存在2')),
      child('c2', join(work, '不存在的目录', '章节'))
    ]
    const result = await previewParentSelfCheck(PARENT_ID)

    expect(result.canDetect).toBe(true)
    // 这一话的可读根照常出候选（已存在3 在本用例里没登记，所以它也是候选）；
    // 排序交给 localeCompare，这里只比集合，避免把中文排序规则写进断言。
    expect(result.candidates.map((c) => c.folderName).sort()).toEqual(['新章节A', '已存在3'].sort())
    expect(result.unreadableRoots).toEqual([join(work, '不存在的目录')])
  })
})

describe('importParentSelfCheck — 未识别集数 / 多根', () => {
  it('两条"未识别集数"的条目导入后不会再变成两条同名「副本」', async () => {
    const items = ['新章节A', '新章节B'].map((name) => ({
      folderName: name,
      folderPath: name === '新章节A' ? join(wu, name) : join(you, name),
      chapterNumber: '',
      projectTitle: name,
      conflictAction: 'second-version' as const
    }))

    const result = await importParentSelfCheck({
      parentId: PARENT_ID,
      sourceRoot: wu,
      sourceRoots: [wu, you],
      rememberSourceRoot: true,
      items
    })

    expect(result.added).toBe(2)
    const added = repo.tree[0].children.slice(3).map((c) => c.chapterNumber)
    expect(added).toHaveLength(2)
    // 两条都作为"未设置集数"入库（和现有三个子项目一致），不再双双变成「副本」。
    expect(added).toEqual(['', ''])
    expect(added).not.toContain('副本')
  })

  it('记住多个根：sourceRoots 落库，sourceRoot 同步为主根（兼容旧读取方）', async () => {
    await importParentSelfCheck({
      parentId: PARENT_ID,
      sourceRoot: wu,
      sourceRoots: [wu, you],
      rememberSourceRoot: true,
      items: []
    })

    expect(repo.tree[0].sourceRoots).toEqual([wu, you])
    expect(repo.tree[0].sourceRoot).toBe(wu)
  })

  it('已有的同集数仍然会冲突（同一作品名下的真重复不能放过）', async () => {
    // ⚠️ 2026-10-05 起冲突键是「作品名键 + 集数」（P1）：所以这条 fixture 必须
    // 让两边**作品名一致**，否则它测的就不是"真冲突"了。
    // 两个根（wu / you）才能让"同名同号但在另一个目录"成为候选 ——
    // 同一目录下那条会被路径去重直接跳过。
    repo.tree[0].children = [
      child('c1', join(wu, '作品A 3'), '3'),
      child('c2', join(you, '填充 1'), '1')
    ]
    await makeChapterDir(join(wu, '作品A 3'))
    await makeChapterDir(join(you, '作品A 3'))

    const result = await previewParentSelfCheck(PARENT_ID)
    const conflicted = result.candidates.find((c) => c.folderName === '作品A 3')

    expect(conflicted?.conflict).toBe('same-chapter')
    expect(conflicted?.existingChapterNumber).toBe('3')
    // 2026-10-05：冲突行必须能说出"撞上的是哪一话"（标题 + 路径）。
    // ⚠️ 只报事实 —— 集数相同**不等于**同一话（用户现场指出：同一本里可能有
    // 两套命名 `… - 姐煩19` / `… - 戀上19`，还有多部作品共用同一个数字）。
    expect(conflicted?.existingChapterTitle).toBe('作品A 3')
    expect(conflicted?.existingChapterPath).toBe(join(wu, '作品A 3'))
  })

  it('撞上的那一话标题为空 ⇒ 回落到它的文件夹名（不许显示成空的"已存在："）', async () => {
    // 真实库里就有这种：集数 8 的那一话 projectTitle 是空串（`14歲 08`）。
    // 候选用 `14歲 8` —— 与它有同一个作品名键（`14歲`）、同一个集数（8）。
    repo.tree[0].children = [
      { ...child('c1', join(wu, '14歲 08')), chapterNumber: '8', projectTitle: '' },
      child('c2', join(you, '填充 1'), '1')
    ]
    await makeChapterDir(join(wu, '14歲 08'))
    await makeChapterDir(join(you, '14歲 8'))

    const result = await previewParentSelfCheck(PARENT_ID)
    const conflicted = result.candidates.find((c) => c.folderName === '14歲 8')

    expect(conflicted?.conflict).toBe('same-chapter')
    expect(conflicted?.existingChapterTitle).toBe('14歲 08')
  })
})

/**
 * 现场复现（2026-10-04）：用户点「刷新并检测新章节」，弹窗报 **28 个新章节**，
 * 而列出来的全是**别部作品**（【鹅妈妈】/【我不能呼吸都是你的错】_BL/【遗尘】/2号的我/北欧美少女…）。
 *
 * 库里逐字节取证（父级 `parent-1791111808437-6kmdccu`「老师的人偶」）：
 *   它只有一个子项，`folderPath = D:\…\嵌字\老师的人偶（米饭\`
 *   —— 指向的是「**卷的父目录**」，而不是某一卷。
 *   而 `getSourceRoots()` 在没记住过目录时按 `dirname(child.folderPath)` 反推扫描根，
 *   于是根落到了 `嵌字`（**整个作品目录**）那一层 ——
 *   它的每一个一级子目录都是一部**别的**作品，于是全部被当成"老师的人偶的新章节"。
 *
 * ⚠️ 这条锁**只咬现象**（同级作品不得出现在候选里、该报的卷要报出来）。
 * 至于"该在录入时拦住这种路径"还是"该让反推更聪明"，是这条锁变红之后才谈的事。
 */
describe('previewParentSelfCheck — 子项目指向"卷的父目录"时（2026-10-04 现场）', () => {
  it('同级作品不得被当成新章节，而卷本身要被报出来', async () => {
    const hanzi = join(work, '嵌字')
    const workRoot = join(hanzi, '老师的人偶（米饭')
    await makeChapterDir(join(workRoot, '老师的人偶5卷'))
    await makeChapterDir(join(workRoot, '老师的人偶6卷'))
    // 同级作品：它们在真实库里是**别的父级**，绝不该出现在「老师的人偶」的候选里。
    // ⚠️ 必须真把它们登记成父级 —— B1 的判据就是「别的父级的章节在不在这个根下面」。
    await makeChapterDir(join(hanzi, '【鹅妈妈】', '惡役千金LV99 - 24'))
    await makeChapterDir(join(hanzi, '北欧美少女', '北欧01'))

    repo.tree = [
      {
        id: PARENT_ID,
        title: '老师的人偶',
        // 与库里逐字节一致：结尾多一个反斜杠（实测 resolve 会剥掉它，故它不是这条锁的变量）
        children: [child('c1', `${workRoot}\\`, '5')],
        lastMtimeMs: 0
      },
      {
        id: 'parent-e-mama',
        title: '鹅妈妈',
        children: [
          {
            ...child('o1', join(hanzi, '【鹅妈妈】', '惡役千金LV99 - 24'), '24'),
            parentTitle: '鹅妈妈'
          }
        ],
        lastMtimeMs: 0
      },
      {
        id: 'parent-nordic',
        title: '北欧美少女',
        children: [
          { ...child('o2', join(hanzi, '北欧美少女', '北欧01'), '1'), parentTitle: '北欧美少女' }
        ],
        lastMtimeMs: 0
      }
    ]
    repo.getProjectTree.mockImplementation(async () => repo.tree)

    const result = await previewParentSelfCheck(PARENT_ID)
    const names = result.candidates.map((c) => c.folderName)

    // ── 唯一硬要求（现象）：同级作品不得出现在候选里 ──────────────────
    expect(names).not.toContain('【鹅妈妈】')
    expect(names).not.toContain('北欧美少女')

    // 两种都算"用户看到的没问题"，**故意不写死修法形状**：
    //   ① 推导对了 —— 根落在"卷的父目录"这一层，该报的卷要报出来；
    //   ② 明确拒绝推导 —— 让人手选一次（B1 口径，见下一条锁）。
    if (result.canDetect) {
      expect(names).toContain('老师的人偶6卷')
    } else {
      expect(result.candidates).toEqual([])
      expect(result.message).toContain('手动选择')
    }
  })
})

/**
 * B1 口径（用户 2026-10-04 拍板）：反推出来的根若是**容器层**，就不自动推导。
 *
 * 判据只用一条 —— 「**别的父级的章节出现在这个根下面**」。刻意**不引入**
 * "像不像章节"的启发式：那类启发式正是本次 bug 的来源（`hasRootProjectFiles`）。
 *
 * 用例照着**真实的白沙水族馆**搭：它的子项目路径**本身是对的**（`翻译\白い砂… 12巻`），
 * 错的只是 `dirname(它)` 落在了**分类层** `翻译` —— 所以 A（录入侧拦截）拦不住这一类，
 * 必须由 B1 兜住。
 */
describe('previewParentSelfCheck — 反推出的根是容器层时（B1 口径）', () => {
  it('根下面出现别的父级的章节 ⇒ 不自动推导，让人手选一次', async () => {
    const fanYi = join(work, '翻译')
    await makeChapterDir(join(fanYi, '白い砂のアクアトープ 12巻'))
    // 另一部作品的章节落在**分类目录**下面 —— 这正是"翻译 是分类层、不是章节层"的证据
    await makeChapterDir(join(fanYi, '『喵的』', '圣女老师的魔法出类拔萃！ 02'))

    repo.tree = [
      {
        id: PARENT_ID,
        title: '白沙水族馆',
        children: [child('c1', join(fanYi, '白い砂のアクアトープ 12巻'), '12')],
        lastMtimeMs: 0
      },
      {
        id: 'parent-other-work',
        title: '圣女老师的魔法出类拔萃',
        children: [
          {
            ...child('o1', join(fanYi, '『喵的』', '圣女老师的魔法出类拔萃！ 02'), '2'),
            parentTitle: '圣女老师的魔法出类拔萃'
          }
        ],
        lastMtimeMs: 0
      }
    ]
    repo.getProjectTree.mockImplementation(async () => repo.tree)

    const result = await previewParentSelfCheck(PARENT_ID)

    expect(result.canDetect).toBe(false)
    expect(result.candidates).toEqual([])
    expect(result.message).toContain('手动选择')
  })

  /**
   * 跨盘不能连坐（2026-10-04，**真实数据探针抓出来的**）。
   *
   * 真实库里有个父级「搬砖」的子项目**全在 E:**，而绝大多数父级在 D:。
   * `path.relative()` 在跨盘时返回的是**绝对路径**（`E:\…`）而不是 `..\…`：
   * 实现里若只判 `''` / `'..'` / `'..\'`，跨盘会被判成"在里面"，
   * 于是**所有 D 盘父级的根**都会被 E 盘那个父级触发而误挡
   * —— 实测把「鹅妈妈」连同它 8 条**真章节**一起挡掉了。
   */
  it('别的父级的章节在另一个盘上时，不算"在根里面"', async () => {
    const workRoot = join(work, '作品')
    await makeChapterDir(join(workRoot, '第1話'))
    await makeChapterDir(join(workRoot, '第2話'))

    repo.tree = [
      {
        id: PARENT_ID,
        title: '本盘的作品',
        children: [child('c1', join(workRoot, '第1話'), '1')],
        lastMtimeMs: 0
      },
      {
        id: 'parent-other-drive',
        title: '外部盘的作品',
        children: [
          {
            ...child('o1', 'Z:\\外部盘\\某作品\\第1話', ''),
            parentTitle: '外部盘的作品'
          }
        ],
        lastMtimeMs: 0
      }
    ]
    repo.getProjectTree.mockImplementation(async () => repo.tree)

    const result = await previewParentSelfCheck(PARENT_ID)

    // 跨盘不算"在里面" ⇒ 本盘这个父级的根照常可用，该报的话要报出来。
    expect(result.canDetect).toBe(true)
    expect(result.candidates.map((c) => c.folderName)).toContain('第2話')
  })
})

/**
 * 冲突键升级为「作品名键 + 集数」（2026-10-05，P1）。
 *
 * 现场（用户真实库，父级 `鹅妈妈` 里放着多部作品）：8 条候选**全部**与库里某个集数撞号，
 * 其中大多数是"不同作品数字巧合"：
 *   `一根筋 96` ↔ `矢野同學觀察日記 - 96`、`番外 22 23 24`（解析成 24）↔ `惡役千金LV99 - 24`、
 *   `姊煩10.2` ↔ `戀上10.2`、`HIGH 08` ↔ `14歲 08`。
 * 升级后：**同一作品名下同号才冲突**；认不出作品名时退回保守口径（仍算冲突）。
 */
describe('previewParentSelfCheck — 冲突键 =「作品名键 + 集数」', () => {
  /** 造两个根（wu / you）：wu 放既有话，you 放候选（同名同号在不同目录才算真冲突）。 */
  async function seed(existingName: string, existingNumber: string, candidateName: string) {
    repo.tree[0].children = [
      { ...child('c1', join(wu, existingName)), chapterNumber: existingNumber },
      child('c2', join(you, '填充 1'), '1')
    ]
    await makeChapterDir(join(wu, existingName))
    await makeChapterDir(join(you, candidateName))
    const result = await previewParentSelfCheck(PARENT_ID)
    return result.candidates.find((c) => c.folderName === candidateName)
  }

  it('不同作品的同号目录 ⇒ 不再冲突（数字巧合而已）', async () => {
    const candidate = await seed('一根筋 96', '96', '矢野同學觀察日記 - 96')
    expect(candidate?.conflict).toBe('none')
  })

  it('`番外 22 23 24` 与 `惡役千金LV99 - 24` ⇒ 不再冲突', async () => {
    const candidate = await seed(
      '惡役千金LV99 - 24',
      '24',
      '想讓高森同學安靜下來！ - 番外 22 23 24'
    )
    expect(candidate?.conflict).toBe('none')
  })

  it('´姊煩´ 与 ´戀上´ 是不同作品名 ⇒ 同号也不再冲突', async () => {
    const candidate = await seed('戀上10.2', '10.2', '姊煩10.2')
    expect(candidate?.conflict).toBe('none')
  })

  it('同一作品名、不同集数 ⇒ 不冲突（正常的新一话）', async () => {
    const candidate = await seed('jojo 3', '3', 'jojo 4')
    expect(candidate?.conflict).toBe('none')
  })

  it('同一作品名 + 同号，只差空白 ⇒ 仍然冲突（空白归一化是无歧义的）', async () => {
    const candidate = await seed('jojo 3', '3', 'jojo  3')
    expect(candidate?.conflict).toBe('same-chapter')
  })

  it('`08` 与 `8` 归一化后同号 ⇒ 仍然冲突', async () => {
    const candidate = await seed('HIGH 08', '8', 'HIGH 8')
    expect(candidate?.conflict).toBe('same-chapter')
  })

  it('既有那一话认不出作品名（整个名字就是数字）⇒ 退回保守口径：仍算冲突', async () => {
    const candidate = await seed('19', '19', 'jojo 19')
    expect(candidate?.conflict).toBe('same-chapter')
  })

  it('异体字（姊/姐）被当成两个作品名 ⇒ 不冲突（**故意**的漏报，交给指纹提示兜底）', async () => {
    const candidate = await seed('姊煩10.2', '10.2', '姐煩10.2')
    expect(candidate?.conflict).toBe('none')
  })
})

describe('importParentSelfCheck — 冲突键与预览同源（P1）', () => {
  it('不同作品名的同号目录 ⇒ 照常导入（不再被当冲突跳过）', async () => {
    repo.tree[0].children = [{ ...child('c1', join(wu, '一根筋 96')), chapterNumber: '96' }]
    await makeChapterDir(join(wu, '一根筋 96'))
    await makeChapterDir(join(wu, '矢野同學觀察日記 - 96'))

    const result = await importParentSelfCheck({
      parentId: PARENT_ID,
      sourceRoot: wu,
      rememberSourceRoot: false,
      items: [
        {
          folderName: '矢野同學觀察日記 - 96',
          folderPath: join(wu, '矢野同學觀察日記 - 96'),
          chapterNumber: '96',
          projectTitle: '矢野同學觀察日記 - 96'
        }
      ]
    })

    expect(result.added).toBe(1)
    expect(result.skipped).toBe(0)
  })

  it('同一作品名 + 同号 ⇒ 仍按冲突默认跳过', async () => {
    repo.tree[0].children = [
      { ...child('c1', join(wu, '作品A 96')), chapterNumber: '96' },
      child('c2', join(you, '填充 1'), '1')
    ]
    await makeChapterDir(join(wu, '作品A 96'))
    await makeChapterDir(join(you, '作品A 96'))

    const result = await importParentSelfCheck({
      parentId: PARENT_ID,
      sourceRoot: wu,
      rememberSourceRoot: false,
      items: [
        {
          folderName: '作品A 96',
          folderPath: join(you, '作品A 96'),
          chapterNumber: '96',
          projectTitle: '作品A 96'
        }
      ]
    })

    expect(result.added).toBe(0)
    expect(result.skipped).toBe(1)
  })
})

describe('previewParentSelfCheck — 认领时用的"既有话清单"（R2）', () => {
  it('带回本父级已有的话，并标出"目录不在"的那些（改名的第一线索）', async () => {
    repo.tree[0].children = [
      child('c1', join(wu, '在的 1'), '1'),
      child('c2', join(wu, '不在的 2'), '2')
    ]
    await makeChapterDir(join(wu, '在的 1')) // c1 的目录存在；c2 的不建

    const result = await previewParentSelfCheck(PARENT_ID)
    const list = result.existingChapters ?? []

    expect(list.map((c) => c.id).sort()).toEqual(['c1', 'c2'])
    expect(list.find((c) => c.id === 'c1')?.missing).toBe(false)
    expect(list.find((c) => c.id === 'c2')?.missing).toBe(true)
    expect(list.find((c) => c.id === 'c2')?.chapterNumber).toBe('2')
    expect(list.find((c) => c.id === 'c2')?.folderPath).toBe(join(wu, '不在的 2'))
  })
})

/**
 * 「疑似改名」检测（2026-10-05，R1）。
 *
 * 只做一件事：把候选的**内容指纹**与"目录已经不在、且记过指纹"的旧话比对 ——
 * **完全相同**才给提示（指纹是事实）。不猜名字相似度，也给"仍要用户确认"留着位置。
 */
describe('detectRenamedCandidates — 疑似改名（R1）', () => {
  it.each([false, true])('真实改名后匹配旧章节（兼容旧指纹=%s）', async (legacy) => {
    const newPath = join(wu, '新名字 19')
    const oldPath = join(wu, '旧名字 19')
    await makeChapterDir(oldPath)
    const fingerprint = await computeIdentityFingerprint(
      await scanChildProject(oldPath),
      legacy ? undefined : oldPath
    )
    await rename(oldPath, newPath)

    repo.tree[0].children = [
      {
        ...child('c1', join(wu, '旧名字 19')),
        chapterNumber: '19',
        projectTitle: '旧名字 19',
        contentFingerprint: fingerprint
      }
    ]

    const hints = await detectRenamedCandidates(PARENT_ID, [newPath])

    expect(hints).toEqual([
      { folderPath: newPath, childId: 'c1', chapterTitle: '旧名字 19', chapterNumber: '19' }
    ])
  })

  it('内容不同 ⇒ 一条提示都不给（指纹是事实，不猜名字）', async () => {
    const newPath = join(wu, '新名字 19')
    await makeChapterDir(newPath)
    repo.tree[0].children = [
      {
        ...child('c1', join(wu, '旧名字 19')),
        chapterNumber: '19',
        projectTitle: '旧名字 19',
        contentFingerprint: 'deadbeef'
      }
    ]

    expect(await detectRenamedCandidates(PARENT_ID, [newPath])).toEqual([])
  })

  it('旧话的目录**还在**（根本没改名）⇒ 一条提示都不给 —— 哪怕指纹完全相同', async () => {
    // ⚠️ 这条用例必须让"指纹完全相同"成立，否则它锁的是"指纹不同"，
    // 而不是"目录还在就不该提示"（第一次写松了，变异验证当场打绿）。
    const existing = join(wu, '在的 1')
    await makeChapterDir(existing)
    const fingerprint = await computeIdentityFingerprint(await scanChildProject(existing))
    repo.tree[0].children = [
      { ...child('c1', existing), chapterNumber: '1', contentFingerprint: fingerprint }
    ]

    expect(await detectRenamedCandidates(PARENT_ID, [existing])).toEqual([])
  })
})

/**
 * 扫描根**落在某一话自己的文件夹里**（或更深）⇒ 直接拒用（2026-10-05）。
 *
 * 现场（用户实测）：父级 `白沙水族馆` **记住的根** = 第12集自己的文件夹
 * `D:\…\翻译\白い砂のアクアトープ 12巻`。扫它只能扫到这一话**内部**的一级子目录 ——
 * 里面只有 `backup`（一摞 `.bak` 备份），于是被当成"1 个新章节"（还认不出集数）。
 *
 * 与 2026-10-04 那次是**镜像方向**：那次治"根太高"（容器层），这次治"根太低"（话内部）。
 * 判据是**路径关系**（等于或位于某一话 folderPath 之内），不引入任何启发式；
 * 记住的根也照样查这一条 —— 容器层过滤是"猜意图"，而"根在话内部"是**几何事实**。
 */
describe('previewParentSelfCheck — 扫描根落在"话内部"时拒用', () => {
  it('记住的根 == 某一话自己的文件夹 ⇒ 不扫、说清原因', async () => {
    repo.tree[0].sourceRoots = [join(wu, '已存在2')]
    const result = await previewParentSelfCheck(PARENT_ID)

    expect(result.canDetect).toBe(false)
    expect(result.candidates).toEqual([])
    expect(result.message).toContain('某一话自己的文件夹')
  })

  it('记住的根在某一话文件夹**更深处** ⇒ 同样拒用', async () => {
    // 现实里的形状：`…\白い砂のアクアトープ 12巻\backup`
    repo.tree[0].sourceRoots = [join(wu, '已存在2', 'backup')]
    const result = await previewParentSelfCheck(PARENT_ID)

    expect(result.canDetect).toBe(false)
    expect(result.message).toContain('某一话自己的文件夹')
  })

  it('手动选的目录落在话内部 ⇒ 也拒用（不是"手动就一定放行"）', async () => {
    const result = await previewParentSelfCheck(PARENT_ID, join(you, '已存在1'))

    expect(result.canDetect).toBe(false)
    expect(result.message).toContain('某一话自己的文件夹')
  })

  it('正常的"一层目录"照旧可用（守卫不能把好根一起挡掉）', async () => {
    repo.tree[0].sourceRoots = [wu, you]
    const result = await previewParentSelfCheck(PARENT_ID)

    expect(result.canDetect).toBe(true)
    expect([...result.sourceRoots].sort()).toEqual([wu, you].sort())
    expect(result.candidates.map((c) => c.folderName).sort()).toEqual(['新章节A', '新章节B'])
  })
})
