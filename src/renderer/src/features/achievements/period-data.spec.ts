import {expect,it} from 'vitest'
import {achievementPeriodRows,rankForPeriod,inPeriod} from './period-data'
import type {ChildMarkStatistics} from '@shared/ipc-api'
import type {RankingEntry} from '@shared/achievement-ranking'
const at=(m:number,d:number)=>new Date(2026,m-1,d,12).getTime()
const p={year:2026,month:10,kind:'month' as const}
it('keeps duplicate page dates and mixed sources, respects month boundaries and full chapter completion',()=>{
 const stat:ChildMarkStatistics={childId:'a',folderPath:'C:/Comic/Chapter',fileCount:3,completedTimestamps:{typeset:[at(9,30),at(10,1),at(10,1)],translated:[],proofread:[],supervised:[]},datedEntries:{typeset:[{at:at(10,1),source:'file'},{at:at(10,1),source:'manual'},{at:at(9,30),source:'mark'}]}}
 const [r]=achievementPeriodRows([stat],[],'typeset',p);expect(r.periodEntries).toHaveLength(2);expect(r.periodEntries.map(e=>e.source)).toEqual(['file','manual']);expect(r.complete).toBe(true);expect(inPeriod(r.last,p)).toBe(true);expect(achievementPeriodRows([stat],[],'translated',p)).toEqual([]);expect(stat.datedEntries!.typeset).toHaveLength(3)
})
it('retains historical chapters without workspace metadata and leaves unfinished chapters unfinished',()=>{
 const stat:ChildMarkStatistics={childId:'old',folderPath:'C:\\旧漫画\\第1话',fileCount:3,completedTimestamps:{typeset:[at(10,1)],translated:[],proofread:[],supervised:[]}}
 const [r]=achievementPeriodRows([stat],[],'typeset',p);expect(r.title).toBe('旧漫画');expect(r.available).toBe(false);expect(r.complete).toBe(false);expect(r.periodEntries[0].source).toBe('mark')
})
it('ranks only the selected period, preserves ties and sums modes only in overall',()=>{
 const modes={typeset:{total:103,monthly:[{month:'2026-09',count:100,projectCount:5},{month:'2026-10',count:3,projectCount:1}]},translated:{total:2,monthly:[{month:'2026-10',count:2,projectCount:1}]},proofread:{total:0,monthly:[]},supervised:{total:0,monthly:[]}}
 const entries:RankingEntry[]=[{id:'a',name:'A',isSelf:true,duty:null,modes},{id:'b',name:'B',isSelf:false,duty:null,modes}];expect(rankForPeriod(entries,'typeset',p).map(r=>[r.count,r.rank])).toEqual([[3,1],[3,1]]);expect(rankForPeriod(entries,'overall',p)[0].count).toBe(5);expect(rankForPeriod(entries,'typeset',{...p,kind:'year'})[0].count).toBe(103)
})
