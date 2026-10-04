import { describe, expect, it } from 'vitest'
import type { ParentProject } from '@shared/types'
import { findChildAfterDeletion } from '../projectDeletionNavigation'

function child(id: string, parentTitle: string, chapterNumber: string) {
  return {
    id,
    parentTitle,
    chapterNumber,
    projectTitle: id,
    folderPath: `/tmp/${id}`,
    lastMtimeMs: 0
  }
}

const parents: ParentProject[] = [
  {
    id: 'p1',
    title: '漫画一',
    lastMtimeMs: 0,
    children: [child('c10', '漫画一', '10'), child('c1', '漫画一', '1'), child('c2', '漫画一', '2')]
  },
  {
    id: 'p2',
    title: '漫画二',
    lastMtimeMs: 0,
    children: [child('d2', '漫画二', '2'), child('d1', '漫画二', '1')]
  }
]

describe('findChildAfterDeletion', () => {
  it('chooses the next chapter in natural chapter order', () => {
    expect(findChildAfterDeletion(parents, 'c1', ['c1'])?.id).toBe('c2')
  })

  it('falls back to the previous chapter when there is no next chapter', () => {
    expect(findChildAfterDeletion(parents, 'c10', ['c10'])?.id).toBe('c2')
  })

  it('skips every batch-deleted sibling before crossing to the next parent', () => {
    expect(findChildAfterDeletion(parents, 'c1', ['c1', 'c2', 'c10'])?.id).toBe('d1')
  })

  it('returns null when the deletion leaves no child project', () => {
    expect(findChildAfterDeletion(parents.slice(0, 1), 'c1', ['c1', 'c2', 'c10'])).toBeNull()
  })

  it('follows descending chapter order when selecting the next destination', () => {
    expect(findChildAfterDeletion(parents, 'c10', ['c10'], 'descending')?.id).toBe('c2')
  })
})
