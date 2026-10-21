// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {mount,flushPromises,enableAutoUnmount} from '@vue/test-utils'
import {createPinia} from 'pinia'
import Achievements from '../Achievements.vue'
import AchievementPeriodPicker from '@renderer/features/achievements/AchievementPeriodPicker.vue'
vi.mock('vue-router',()=>({useRouter:()=>({push:vi.fn()})}))
enableAutoUnmount(afterEach)
beforeEach(()=>{window.comicType={memoryMarkStatistics:vi.fn().mockResolvedValue([{childId:'a',folderPath:'C:/漫画/第1话',fileCount:3,completedTimestamps:{typeset:[new Date(2026,9,1,12).getTime(),new Date(2026,9,2,12).getTime()],translated:[],proofread:[],supervised:[]}}]),storeGet:vi.fn().mockResolvedValue(undefined),storeSet:vi.fn()} as unknown as typeof window.comicType})
it('filters chapter rows without changing whole-period totals and opens historical record details',async()=>{const w=mount(Achievements,{global:{plugins:[createPinia()],renderStubDefaultSlot:true,stubs:{teleport:true}}});await flushPromises();w.findComponent(AchievementPeriodPicker).vm.$emit('change',{year:2026,month:10});await flushPromises();expect(w.text()).toContain('漫画');await w.get('button[aria-label="1日，1 页，点击筛选"]').trigger('click');expect(w.text()).toContain('清除筛选');expect(w.text()).toContain('2 / 3 页');const detail=w.findAll('button').find(b=>b.text().includes('查看详情'))!;await detail.trigger('click');expect(w.text()).toContain('按日完成记录');expect(w.text()).toContain('该章节已不在项目列表中');expect(window.comicType.storeSet).not.toHaveBeenCalled()})
it('date selection is a draft until applied',async()=>{const w=mount(AchievementPeriodPicker,{props:{year:2026,month:10,kind:'month'},global:{renderStubDefaultSlot:true,stubs:{teleport:true}}});await w.get('[data-testid=achievement-date-picker]').trigger('click');await flushPromises();await w.findAll('button').find(b=>b.text()==='9 月')!.trigger('click');expect(w.emitted('change')).toBeUndefined();await w.findAll('button').find(b=>b.text()==='应用')!.trigger('click');expect(w.emitted('change')).toEqual([[{year:2026,month:9}]])})
