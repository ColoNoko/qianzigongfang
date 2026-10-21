// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { PAIRED_PSD_STATS_VERSION } from '@shared/status'
import type { DashboardParent } from '@renderer/stores/project'
import { useAchievementsStore } from '@renderer/stores/achievements'
import { useSettingsStore } from '@renderer/stores/settings'
const { push } = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('vue-router', () => ({ useRouter: () => ({push}) }))
vi.mock('@renderer/features/dashboard/HomeCover.vue', () => ({default:{template:'<span />'}}))
vi.mock('@renderer/features/dashboard/HomeGreeting.vue', () => ({default:{template:'<span />'}}))
import Dashboard from '../Dashboard.vue'
enableAutoUnmount(afterEach)
const done = {mtimeMs:600000,ctimeMs:0}, pending = {mtimeMs:0,ctimeMs:0}
const fixture = (): DashboardParent[] => [{id:'p',title:'测试漫画',lastMtimeMs:100,children:[
 {id:'working',parentTitle:'测试漫画',folderPath:'/work',chapterNumber:'1',projectTitle:'进行中章节',lastMtimeMs:300,psdStats:[done,pending],statsVersion:PAIRED_PSD_STATS_VERSION},
 {id:'pending',parentTitle:'测试漫画',folderPath:'/pending',chapterNumber:'2',projectTitle:'待做章节',lastMtimeMs:200,psdStats:[pending],statsVersion:PAIRED_PSD_STATS_VERSION},
 {id:'done',parentTitle:'测试漫画',folderPath:'/done',chapterNumber:'3',projectTitle:'完成章节',lastMtimeMs:100,psdStats:[done],statsVersion:PAIRED_PSD_STATS_VERSION}
]}]
async function setup(data=fixture(),modern=false) {
 window.comicType = {projectGetTree:vi.fn().mockResolvedValue(data),storeGet:vi.fn().mockImplementation(key=>Promise.resolve(key==='recentProjectIds'?['pending','working','done']:undefined)),storeSet:vi.fn().mockResolvedValue(undefined),projectSaveProgress:vi.fn().mockResolvedValue(undefined)} as unknown as typeof window.comicType
 const pinia=createPinia();setActivePinia(pinia);if(modern)useSettingsStore().homeStyle='modern'
 const wrapper=mount(Dashboard,{global:{plugins:[pinia]}});await flushPromises();return wrapper
}
beforeEach(()=>push.mockReset())
describe.each([false,true])('home shared behavior modern=%s', modern=>{
 it('empty registry offers the real add-project route',async()=>{const w=await setup([],modern);await w.get('[data-testid="add-project-cta"]').trigger('click');expect(push).toHaveBeenCalledWith('/project?add=1')})
 it('keeps half-finished chapters visible and separates untouched/completed ones',async()=>{
  const w=await setup(fixture(),modern)
  expect(w.get('[data-testid="ongoing-section"]').text()).toContain('进行中章节')
  expect(w.get('[data-testid="ongoing-section"]').text()).toContain('还剩 1 页')
  expect(w.get('[data-testid="pending-section"]').text()).toContain('待做章节')
  expect(w.get('[data-testid="completed-section"]').text()).toContain('完成章节')
 })
 it('recent work follows visits rather than file dates and opens the chapter',async()=>{
  const w=await setup(fixture(),modern),cards=w.findAll('[data-testid="recent-project-card"]')
  expect(cards[0].text()).toContain('待做章节');await cards[0].trigger('click');expect(push).toHaveBeenCalledWith('/project/'+encodeURIComponent('测试漫画')+'/pending')
 })
 it('mode switch updates progress lists and monthly achievement totals together',async()=>{
  const data=fixture();data[0].children[0].psdModeStats={typeset:[],translated:[],proofread:[done,done],supervised:[]}
  const w=await setup(data,modern);const stats=useAchievementsStore();stats.statistics=[{childId:'working',folderPath:'/work',fileCount:2,completedTimestamps:{typeset:[],translated:[],proofread:[Date.now(),Date.now()],supervised:[]}}]
  w.findComponent({name:'WorkModeSegments'}).vm.$emit('update:modelValue','proofread');await flushPromises()
  expect(stats.selectedMode).toBe('proofread');expect(w.get('[data-testid="completed-section"]').text()).toContain('进行中章节')
  expect(w.get('[data-testid="dashboard-month-count"]').text()).toContain('本月校对完成');expect(stats.currentMonthTotal).toBe(2)
 })
 it('completed list dates and order follow statistics dates rather than filesystem dates',async()=>{
  const data=fixture();data[0].children[0].psdStats=[done];const w=await setup(data,modern);const stats=useAchievementsStore()
  stats.statistics=['working','done'].map((childId,index)=>({childId,folderPath:'/',fileCount:1,completedTimestamps:{typeset:[new Date(2020+index,0,1).getTime()],translated:[],proofread:[],supervised:[]}}));await flushPromises()
  const rows=w.get('[data-testid="completed-section"]').findAll('li');expect(rows[0].text()).toContain('完成章节');expect(rows[0].text()).toContain('2021');expect(rows[1].text()).toContain('2020')
 })
})
