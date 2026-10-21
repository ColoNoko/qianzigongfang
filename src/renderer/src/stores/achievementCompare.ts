import { defineStore } from 'pinia'
import {
  ACHIEVEMENT_PROFILE_STORAGE_KEY,
  MAX_IMPORTED_PROFILES,
  aggregateModesPayload,
  buildExportPayload,
  normalizeNickname,
  normalizeStoredProfiles,
  parseAchievementPayload,
  profileNameFromFilePath,
  toStoredProfiles,
  type ImportedAchievementProfile
} from '@shared/achievement-profile'
import type { WorkMode } from '@shared/types'
import { useAchievementsStore } from './achievements'

/**
 * achievementCompare —— 排行对比的档案库（需求一/二/三）。
 *
 * 铁律：这里只存**导入的他人档案**，自己的成就数据永远留在 `achievements` store
 * （源头是 `memoryMarkStatistics()`）。两者物理隔离 —— 导入/删除档案都不会碰到
 * 自己的数字。
 *
 * 存储走现成的 `key_value_store`（`storeGet` / `storeSet`），一个 key 存整份列表。
 */
export type ImportProfileResult =
  | { status: 'canceled' }
  | { status: 'imported'; profile: ImportedAchievementProfile; warning?: string }
  | { status: 'error'; message: string }

export type ExportMineResult =
  { status: 'saved'; path: string } | { status: 'canceled' } | { status: 'error'; message: string }

function makeProfileId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `profile-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export const useAchievementCompareStore = defineStore('achievementCompare', {
  state: () => ({
    profiles: [] as ImportedAchievementProfile[],
    loaded: false,
    /** 自己声明的主职责（排行徽章用；导出时顺手记住）。 */
    selfDuty: null as WorkMode | null,
    /**
     * 排行对比档：综合榜（烤肉，跨职责总工作量）or 按模式（同职责公平比）。
     *
     * 默认落在**综合榜**：左侧第一档，且职责胶囊只在「按模式」档才出现
     * （2026-10-05 用户看图后的排布要求）。
     */
    rankingMode: 'overall' as 'mode' | 'overall'
  }),

  getters: {
    profileCount(state): number {
      return state.profiles.length
    }
  },

  actions: {
    async load(): Promise<void> {
      try {
        if (typeof window.comicType?.storeGet !== 'function') return
        const raw = await window.comicType.storeGet(ACHIEVEMENT_PROFILE_STORAGE_KEY)
        this.profiles = normalizeStoredProfiles(raw)
      } catch (error) {
        console.error('[achievementCompare] 读取对比档案失败:', error)
        this.profiles = []
      } finally {
        this.loaded = true
      }
    },

    /**
     * 写回本地档案库。
     *
     * ⚠️ 必须传 `toStoredProfiles()` 摊平后的**普通对象**：直接把 Pinia 的响应式数组
     * 塞进 IPC 会被 Electron 的结构化克隆拒绝，报 `An object could not be cloned.`
     * （2026-10-05 导入档案时踩到；交接文档 §13.2 记过同一条）。
     *
     * @returns 是否真的写进去了（失败只记日志，由调用方决定怎么提示用户）。
     */
    async persist(): Promise<boolean> {
      if (typeof window.comicType?.storeSet !== 'function') return false
      try {
        await window.comicType.storeSet(
          ACHIEVEMENT_PROFILE_STORAGE_KEY,
          toStoredProfiles(this.profiles)
        )
        return true
      } catch (error) {
        console.error('[achievementCompare] 保存对比档案失败:', error)
        return false
      }
    },

    /**
     * 切对比档：综合榜看四模式合计，「按模式」看单个模式。
     *
     * 「按模式」档下"只看同职责对手"由共享层纯函数 `filterEntriesByDuty` 现算
     * （不再需要第二个"职责筛选"状态字段 —— 那种双份状态正是两个口径打架的源头）。
     */
    setRankingMode(mode: 'mode' | 'overall'): void {
      this.rankingMode = mode
    },

    /**
     * 导入一份他人档案。
     * 主进程只读文件，这里负责 JSON.parse + 共享层校验 + 入库，坏文件当场报错。
     */
    async importFromFile(): Promise<ImportProfileResult> {
      if (typeof window.comicType?.achievementImportFile !== 'function') {
        return {
          status: 'error',
          message: '程序后台还是旧版本，请完全关闭程序后再重新启动一次'
        }
      }
      try {
        const result = await window.comicType.achievementImportFile()
        if (result.canceled) return { status: 'canceled' }
        if (result.error || typeof result.text !== 'string') {
          return { status: 'error', message: result.error ?? '读取文件失败' }
        }

        let parsed: unknown
        try {
          parsed = JSON.parse(result.text)
        } catch {
          return { status: 'error', message: '文件不是有效的 JSON' }
        }

        const check = parseAchievementPayload(parsed)
        if (!check.ok) return { status: 'error', message: check.error }

        if (this.profiles.length >= MAX_IMPORTED_PROFILES) {
          return {
            status: 'error',
            message: `最多只能保存 ${MAX_IMPORTED_PROFILES} 份对比档案，请先删掉一些`
          }
        }

        const profile: ImportedAchievementProfile = {
          id: makeProfileId(),
          name: check.profile.name,
          importedAt: Date.now(),
          duty: check.profile.duty,
          modes: check.profile.modes
        }
        this.profiles.push(profile)
        const saved = await this.persist()
        return saved
          ? { status: 'imported', profile }
          : {
              status: 'imported',
              profile,
              warning: '档案已导入，但写入本地失败（重启后可能丢失）'
            }
      } catch (error) {
        return { status: 'error', message: error instanceof Error ? error.message : String(error) }
      }
    },

    /**
     * 从**别人的数据库文件**导入（对面是老版本 / 别的分支、没有导出功能时用）。
     *
     * 主进程只读打开他的库、跑同一段汇总查询；这里再用**同一套聚合**把它变成
     * 四模式数字账 —— 与他用新版「导出成就数据」得到的东西等价。
     */
    async importFromDatabase(): Promise<ImportProfileResult> {
      if (typeof window.comicType?.achievementImportDatabase !== 'function') {
        return {
          status: 'error',
          message: '程序后台还是旧版本，请完全关闭程序后再重新启动一次'
        }
      }
      try {
        const result = await window.comicType.achievementImportDatabase()
        if (result.canceled) return { status: 'canceled' }
        if (result.error || !Array.isArray(result.statistics)) {
          return { status: 'error', message: result.error ?? '读不出这份数据库里的成就' }
        }
        if (this.profiles.length >= MAX_IMPORTED_PROFILES) {
          return {
            status: 'error',
            message: `最多只能保存 ${MAX_IMPORTED_PROFILES} 份对比档案，请先删掉一些`
          }
        }

        const modes = aggregateModesPayload(result.statistics)
        if (Object.values(modes).every((mode) => mode.total === 0)) {
          return { status: 'error', message: '这份库里没有任何标记记录（他是不是还没开始做？）' }
        }

        const profile: ImportedAchievementProfile = {
          id: makeProfileId(),
          name: profileNameFromFilePath(result.path ?? ''),
          importedAt: Date.now(),
          duty: null,
          modes
        }
        this.profiles.push(profile)
        const saved = await this.persist()
        return saved
          ? { status: 'imported', profile }
          : {
              status: 'imported',
              profile,
              warning: '档案已导入，但写入本地失败（重启后可能丢失）'
            }
      } catch (error) {
        return { status: 'error', message: error instanceof Error ? error.message : String(error) }
      }
    },

    async renameProfile(id: string, name: string): Promise<boolean> {
      const profile = this.profiles.find((item) => item.id === id)
      if (!profile) return false
      profile.name = normalizeNickname(name)
      return this.persist()
    },

    async removeProfile(id: string): Promise<boolean> {
      const index = this.profiles.findIndex((item) => item.id === id)
      if (index === -1) return false
      this.profiles.splice(index, 1)
      return this.persist()
    },

    /**
     * 导出自己的成就：从 achievements store 的标记记录聚合出四模式数字，
     * 组装成脱敏档案（无路径、无项目名），交给主进程弹窗写盘。
     */
    async exportMine(nickname: string, duty: WorkMode | null): Promise<ExportMineResult> {
      if (typeof window.comicType?.achievementExportFile !== 'function') {
        return {
          status: 'error',
          message: '程序后台还是旧版本，请完全关闭程序后再重新启动一次'
        }
      }
      const achievements = useAchievementsStore()
      const payload = buildExportPayload(achievements.statistics, nickname, duty, __APP_VERSION__)
      this.selfDuty = duty
      try {
        const result = await window.comicType.achievementExportFile(payload)
        if (!result.saved) {
          return result.error ? { status: 'error', message: result.error } : { status: 'canceled' }
        }
        return { status: 'saved', path: result.path ?? '' }
      } catch (error) {
        return { status: 'error', message: error instanceof Error ? error.message : String(error) }
      }
    }
  }
})
