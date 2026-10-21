// @vitest-environment node
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, writeFileSync, utimesSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSchema } from '../schema'
let db: DatabaseSync
vi.mock('../connection', () => ({ getDatabase: async () => db }))
import { getStatisticsTime, setStatisticsTime, syncStatisticsTime, undoStatisticsTime, statisticsTimeOperations, restoreStatisticsTimes } from '../statistics-time-store'
import { collectMarkStatisticsFrom } from '../mark-stats-store'
import { buildTimelineEvents } from '@shared/progress'
import { aggregateMarkStatistics } from '@shared/mark-stats'
import { normalizePathKey } from '@shared/paths'
let folder: string, file: string
beforeEach(() => {
 db = new DatabaseSync(':memory:'); createSchema(db)
 folder=mkdtempSync(join(tmpdir(),'statistics-time-'));file=join(folder,'001.psd');writeFileSync(file,'fixture');utimesSync(file,new Date('2020-03-01T12:00:00'),new Date('2020-03-01T12:00:00'))
 db.prepare('INSERT INTO key_value_store VALUES (?, ?, ?)').run('projects',JSON.stringify([{id:'p',children:[{id:'c',psdStats:[{},{}]}]}]),1)
 db.prepare('INSERT INTO project_memory VALUES (?, ?, ?)').run('c',folder,100)
 for (let i=1;i<=2;i++) db.prepare('INSERT INTO project_memory_files VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('c',normalizePathKey(i===1?file:join(folder,'002.psd')),i===1?file:join(folder,'002.psd'),'done',10,100,JSON.stringify({typeset:true,proofread:true,translated:false}),JSON.stringify({typeset:100,proofread:200}))
})
afterEach(()=>{db.close();rmSync(folder,{recursive:true,force:true})})
it('manual changes the selected mode only; achievements and timeline use identical dates; original times stay intact',async()=>{
 await setStatisticsTime({childId:'c',mode:'proofread',source:'manual',date:'2021-05-02'})
 const result=collectMarkStatisticsFrom(db)
 expect(result[0].lastOperationAtByMode).toMatchObject({typeset:100,proofread:200})
 expect(result[0].completedTimestamps.typeset).toEqual([100,100]);expect(result[0].completedTimestamps.proofread.every(t=>new Date(t).getFullYear()===2021)).toBe(true)
 expect(aggregateMarkStatistics(result,'proofread').data.get('2021-05')).toBe(2)
 const events=buildTimelineEvents(result,new Map([['c',{parentTitle:'p',chapterNumber:'1'}]]))
 expect(events.find(e=>e.mode==='proofread')).toMatchObject({fileCount:2,timeSources:['manual'],chapterCompleted:true})
 expect(JSON.parse((db.prepare('SELECT mode_timestamps_json FROM project_memory_files LIMIT 1').get() as any).mode_timestamps_json).proofread).toBe(200)
})
it('file dates are frozen; missing files fall back; mark mode restores original dates',async()=>{
 expect(await setStatisticsTime({parentId:'p',mode:'typeset',source:'file'})).toEqual({changed:2,fallback:1})
 const first=collectMarkStatisticsFrom(db)[0].completedTimestamps.typeset
 utimesSync(file,new Date(),new Date());syncStatisticsTime(db,'c',normalizePathKey(file),file,{typeset:true,proofread:true},{typeset:100,proofread:200},300)
 expect(collectMarkStatisticsFrom(db)[0].completedTimestamps.typeset).toEqual(first)
 await setStatisticsTime({childId:'c',mode:'typeset',source:'mark'})
 expect(collectMarkStatisticsFrom(db)[0].completedTimestamps.typeset).toEqual([100,100])
})
it('page override is scoped; undo restores both assignments and inherited rules',async()=>{
 await setStatisticsTime({parentId:'p',mode:'proofread',source:'file'})
 await setStatisticsTime({childId:'c',paths:[file],mode:'proofread',source:'manual',date:'2022-01-02'})
 const op=(await statisticsTimeOperations())[0];expect(op.source).toBe('statistics-time')
 await undoStatisticsTime(op.opId)
 expect(await getStatisticsTime({childId:'c',paths:[file]},'proofread')).toBe('file')
 expect(await getStatisticsTime({childId:'c'},'proofread')).toBe('file')
})
it('manual applies only to completed pages and does not become the date of future completions',async()=>{
 const request={parentId:'p',mode:'translated' as const,source:'manual' as const,date:'2020-01-01'}
 expect((await setStatisticsTime(request)).changed).toBe(0)
 syncStatisticsTime(db,'c',normalizePathKey(file),file,{translated:true},{translated:900},900)
 const row=db.prepare("SELECT at,source FROM statistics_time_pages WHERE mode = 'translated'").get()
 expect(row).toEqual({at:900,source:'mark'})
})
it('rejects invalid dates without modifying rules or records',async()=>{
 await expect(setStatisticsTime({childId:'c',mode:'proofread',source:'manual',date:'2021-02-30'})).rejects.toThrow()
 expect(db.prepare('SELECT count(*) AS n FROM statistics_time_rules').get()).toEqual({n:0})
})

it('SQLite backup restores statistics dates and rules without changing completion flags',async()=>{
 const backup=join(folder,'snapshot.sqlite')
 db.exec(`VACUUM INTO '${backup.replace(/'/g,"''")}'`)
 await setStatisticsTime({parentId:'p',mode:'proofread',source:'manual',date:'2020-01-01'})
 expect(await restoreStatisticsTimes(backup)).toBeGreaterThan(0)
 await restoreStatisticsTimes(backup,true)
 expect(await getStatisticsTime({parentId:'p'},'proofread')).toBe('mark')
 expect(collectMarkStatisticsFrom(db)[0].completedTimestamps.proofread).toEqual([200,200])
})
it('cancel then undo preserves the manual date; a new completion uses a fresh mark time',async()=>{
 await setStatisticsTime({childId:'c',mode:'proofread',source:'manual',date:'2020-01-01'})
 const before=collectMarkStatisticsFrom(db)[0].completedTimestamps.proofread
 syncStatisticsTime(db,'c',normalizePathKey(file),file,{proofread:false},{},500)
 syncStatisticsTime(db,'c',normalizePathKey(file),file,{proofread:true},{proofread:200},600)
 expect(collectMarkStatisticsFrom(db)[0].completedTimestamps.proofread).toEqual(before)
 syncStatisticsTime(db,'c',normalizePathKey(file),file,{proofread:true},{proofread:700},700)
 expect(db.prepare("SELECT at FROM statistics_time_pages WHERE path_key = ? AND mode = 'proofread'").get(normalizePathKey(file))).toEqual({at:700})
})


import { currentMarkSnapshot } from '../mark-snapshot-store'
import { getStoredProjectMemory, setStoredProjectMemoryStatuses } from '../project-memory-store'
it.each(['', '{}', '{broken'])('preserves legacy completion and its original date on another-mode edit (%s)', async raw => {
 db.prepare('UPDATE project_memory_files SET mode_statuses_json = ?, mode_timestamps_json = ?').run(raw, '{}')
 expect((await getStoredProjectMemory('c'))!.files[normalizePathKey(file)].modes!.typeset).toBe(true)
 expect(collectMarkStatisticsFrom(db)[0].completedTimestamps.typeset).toEqual([100,100])
 await setStoredProjectMemoryStatuses('c',folder,[{pathKey:normalizePathKey(file),path:file,status:'pending',mtimeMs:10,modes:{proofread:true},modeTimestamps:{proofread:500}}])
 const entry=(await getStoredProjectMemory('c'))!.files[normalizePathKey(file)]
 expect(entry.modes).toMatchObject({typeset:true,proofread:true})
 expect(entry.modeTimestamps?.typeset).toBe(100)
 const snapshot=await currentMarkSnapshot()
 expect(snapshot.children.c.files[normalizePathKey(join(folder,'002.psd'))]).toMatchObject({modes:{typeset:true},timestamps:{typeset:100}})
 expect(collectMarkStatisticsFrom(db)[0].completedTimestamps.typeset).toEqual([100,100])
})
it('honors explicit typeset false over a stale legacy done flag',async()=>{
 db.prepare('UPDATE project_memory_files SET mode_statuses_json = ?').run(JSON.stringify({typeset:false,proofread:true}))
 expect((await getStoredProjectMemory('c'))!.files[normalizePathKey(file)].modes!.typeset).toBe(false)
 expect(collectMarkStatisticsFrom(db)[0].completedTimestamps.typeset).toEqual([])
})
it('does not create a second undo step for an unchanged statistics date',async()=>{
 const request={childId:'c',mode:'proofread' as const,source:'manual' as const,date:'2020-01-01'}
 await setStatisticsTime(request)
 expect((await setStatisticsTime(request)).changed).toBe(0)
 expect(await statisticsTimeOperations()).toHaveLength(1)
})
