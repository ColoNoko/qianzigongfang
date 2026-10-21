// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest'
import {mount,flushPromises,enableAutoUnmount} from '@vue/test-utils'
import {createPinia,setActivePinia} from 'pinia'
import Achievements from '../Achievements.vue'
import {useAchievementCompareStore} from '@renderer/stores/achievementCompare'
vi.mock('vue-router',()=>({useRouter:()=>({push:vi.fn()})}))
enableAutoUnmount(afterEach)
it('retains real profile controls and changing rank view never writes achievement data',async()=>{window.comicType={memoryMarkStatistics:vi.fn().mockResolvedValue([]),storeGet:vi.fn().mockResolvedValue(undefined),storeSet:vi.fn()} as unknown as typeof window.comicType;const pinia=createPinia();setActivePinia(pinia);const w=mount(Achievements,{global:{plugins:[pinia],renderStubDefaultSlot:true,stubs:{teleport:true}}});await flushPromises();await w.get('[data-testid=achievement-tab-ranking]').trigger('click');expect(w.text()).toContain('导入他人档案');expect(w.text()).toContain('档案管理');expect(w.text()).toContain('暂无排名');await w.findAll('button').find(b=>b.text()==='按工序')!.trigger('click');expect(useAchievementCompareStore().rankingMode).toBe('mode');expect(window.comicType.storeSet).not.toHaveBeenCalled()})
