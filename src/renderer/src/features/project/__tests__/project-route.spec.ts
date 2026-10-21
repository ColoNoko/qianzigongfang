// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  PROJECT_LIST_PATH,
  childWorkbenchPath,
  resolveProjectNavPath,
  resolveStartupPath
} from '../project-route'
import type { ChildProject, ParentProject } from '@shared/types'

function chapter(id: string, parentTitle: string, chapterNumber = '第1話'): ChildProject {
  return {
    id,
    parentTitle,
    folderPath: `/tmp/${parentTitle}/${chapterNumber}`,
    chapterNumber,
    projectTitle: chapterNumber,
    lastMtimeMs: 0
  }
}

function parents(): ParentProject[] {
  return [
    { id: 'p1', title: 'ドラゴンボール', lastMtimeMs: 2000, children: [chapter('c1', 'ドラゴンボール')] },
    { id: 'p2', title: 'ワンピース', lastMtimeMs: 1000, children: [chapter('c3', 'ワンピース', '第10話')] }
  ]
}

describe('childWorkbenchPath', () => {
  it('encodes the parent title and keeps the child id verbatim', () => {
    expect(childWorkbenchPath('ドラゴンボール', 'c1')).toBe(
      '/project/' + encodeURIComponent('ドラゴンボール') + '/c1'
    )
    expect(childWorkbenchPath('青梅亭亭', 'child-1790064122672-o9omabj')).toBe(
      '/project/' + encodeURIComponent('青梅亭亭') + '/child-1790064122672-o9omabj'
    )
  })
})

describe('resolveStartupPath', () => {
  it('uses home by default and honors an explicit home preference despite history', () => {
    for (const startupPage of [undefined, 'home'] as const) {
      expect(resolveStartupPath({ startupPage, routeName: 'dashboard', recentChildIds: ['c1'], parents: parents() })).toBe('/')
    }
  })

  it('leaves an explicit entry point alone', () => {
    // A deep link, or the standalone LabelPlus preview window.
    for (const routeName of ['project', 'projectIndex', 'labelplusPreview', 'settings']) {
      expect(
        resolveStartupPath({ startupPage: 'project', routeName, recentChildIds: ['c1'], parents: parents() })
      ).toBeNull()
    }
  })

  it('leaves the window alone while the initial navigation is unresolved', () => {
    // Callers must await router.isReady() first; this pins that requirement.
    expect(
      resolveStartupPath({ startupPage: 'project', routeName: undefined, recentChildIds: ['c1'], parents: parents() })
    ).toBeNull()
  })

  it('opens the chapter the user last worked on', () => {
    expect(
      resolveStartupPath({ startupPage: 'project', routeName: 'dashboard', recentChildIds: ['c3'], parents: parents() })
    ).toBe(childWorkbenchPath('ワンピース', 'c3'))
  })

  it('skips remembered chapters that no longer exist', () => {
    expect(
      resolveStartupPath({ startupPage: 'project',
        routeName: 'dashboard',
        recentChildIds: ['deleted', 'c1'],
        parents: parents()
      })
    ).toBe(childWorkbenchPath('ドラゴンボール', 'c1'))
  })

  it('falls back to the picker when every remembered chapter is gone', () => {
    expect(
      resolveStartupPath({ startupPage: 'project', routeName: 'dashboard', recentChildIds: ['gone'], parents: parents() })
    ).toBe(PROJECT_LIST_PATH)
  })

  it('opens the only chapter when the library holds exactly one', () => {
    const single: ParentProject[] = [
      { id: 'p1', title: 'ドラゴンボール', lastMtimeMs: 0, children: [chapter('c1', 'ドラゴンボール')] }
    ]
    expect(
      resolveStartupPath({ startupPage: 'project', routeName: 'dashboard', recentChildIds: [], parents: single })
    ).toBe(childWorkbenchPath('ドラゴンボール', 'c1'))
  })

  it('opens the picker with no history and more than one chapter', () => {
    expect(
      resolveStartupPath({ startupPage: 'project', routeName: 'dashboard', recentChildIds: [], parents: parents() })
    ).toBe(PROJECT_LIST_PATH)
  })

  it('opens the picker (empty state) when there are no projects at all', () => {
    expect(
      resolveStartupPath({ startupPage: 'project', routeName: 'dashboard', recentChildIds: [], parents: [] })
    ).toBe(PROJECT_LIST_PATH)
  })

describe('resolveProjectNavPath', () => {
  const active = { id: 'c1', parentTitle: 'ドラゴンボール' }

  it('从别的页面切回来时回到本会话正在看的那一话', () => {
    expect(
      resolveProjectNavPath({ routeName: 'dashboard', activeChild: active, parents: parents() })
    ).toBe(childWorkbenchPath('ドラゴンボール', 'c1'))
    expect(
      resolveProjectNavPath({ routeName: 'achievements', activeChild: active, parents: parents() })
    ).toBe('/project/%E3%83%89%E3%83%A9%E3%82%B4%E3%83%B3%E3%83%9C%E3%83%BC%E3%83%AB/c1')
  })

  it('没看过任何一话时仍然停在列表页', () => {
    expect(
      resolveProjectNavPath({ routeName: 'dashboard', activeChild: null, parents: parents() })
    ).toBe(PROJECT_LIST_PATH)
    expect(
      resolveProjectNavPath({ routeName: 'settings', activeChild: null, parents: [] })
    ).toBe(PROJECT_LIST_PATH)
  })

  it('那一话已经被删 / 注册表重建过 → 回列表页，不把人送进"项目不存在"', () => {
    expect(
      resolveProjectNavPath({
        routeName: 'dashboard',
        activeChild: { id: 'gone', parentTitle: 'ドラゴンボール' },
        parents: parents()
      })
    ).toBe(PROJECT_LIST_PATH)
    expect(
      resolveProjectNavPath({ routeName: 'dashboard', activeChild: active, parents: [] })
    ).toBe(PROJECT_LIST_PATH)
  })

  it('已经在项目页面上再点「项目」→ 回列表页（否则列表页再也到不了）', () => {
    expect(
      resolveProjectNavPath({ routeName: 'projectIndex', activeChild: active, parents: parents() })
    ).toBe(PROJECT_LIST_PATH)
    expect(
      resolveProjectNavPath({ routeName: 'project', activeChild: active, parents: parents() })
    ).toBe(PROJECT_LIST_PATH)
  })
})

})
