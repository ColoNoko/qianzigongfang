import { expect, it } from 'vitest'
import { workProgress } from './work-progress'
import type { ParentProject } from '@shared/types'
import type { ChildMarkStatistics } from '@shared/ipc-api'
it('continues an unfinished chapter, keeps unknown totals open and uses actual operations', () => {
  const parent = {id:'p',title:'作品',children:[{id:'done',lastMtimeMs:123,psdStats:[{}]},{id:'pending',lastMtimeMs:99999,psdStats:[{},{}]},{id:'unknown'}]} as ParentProject
  const make = (id:string, count:number, at:number):ChildMarkStatistics => ({childId:id,folderPath:'',fileCount:count,completedTimestamps:{typeset:Array(count).fill(1),translated:[],proofread:[],supervised:[]},lastOperationAtByMode:{typeset:at}})
  const row=workProgress(parent,'typeset',new Map([['done',make('done',1,999)],['pending',make('pending',1,500)]]))
  expect(row.next?.child.id).toBe('pending')
  expect(row.at).toBe(123)
  expect(row.remaining).toBe(1)
  expect(row.unknown).toBe(1)
  expect(row.completed).toBe(1)
  const translated=workProgress(parent,'translated',new Map([['done',make('done',1,999)]]))
  expect(translated.at).toBe(0)
  expect(translated.completed).toBe(0)
})
