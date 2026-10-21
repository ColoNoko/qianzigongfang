import { computed, type Ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useAchievementsStore } from '@renderer/stores/achievements'
import { useAchievementCompareStore } from '@renderer/stores/achievementCompare'
import { aggregateModesPayload } from '@shared/achievement-profile'
import { WORK_MODE_LABELS } from '@shared/modes'
import type { WorkMode } from '@shared/types'
import { axisStyle, valueAxisStyle, tooltipStyle, type ChartPalette } from './chart-palette'
import {
  avatarInitial,
  buildKpiCards,
  buildRankingSeries,
  crownPoints,
  CROWN_SERIES_NAME,
  filterEntriesByDuty,
  MEDAL_BADGES,
  rankingMedals,
  sortEntriesByTotal,
  type RankingEntry,
  type RankingKind
} from '@shared/achievement-ranking'

/** v1.2.0 ranking rules: role filters, participants, totals, medals and monthly crowns. */
export function useAchievementRanking(
  viewMode: Ref<'month' | 'year'>,
  hiddenNames: Ref<string[]>,
  chartPalette: Ref<ChartPalette>
) {
  const store = useAchievementsStore()
  const compare = useAchievementCompareStore()
  const { loaded, selectedMode } = storeToRefs(store)
  const { profiles, rankingMode } = storeToRefs(compare)
  const CROWN_PATH =
    'path://M3 18 L3 7 L8.5 12 L12 5 L15.5 12 L21 7 L21 18 Z M3 19.5 L21 19.5 L21 21.5 L3 21.5 Z'
  const MEDAL_GOLD = '#e0a32e'
  function escapeTooltip(value: string): string {
    return value.replace(
      /[&<>"']/g,
      (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!
    )
  }
  const rankingKind = computed<RankingKind>(() =>
    rankingMode.value === 'overall' ? 'overall' : selectedMode.value
  )

  const rankingEntries = computed<RankingEntry[]>(() => {
    const entries: RankingEntry[] = []
    if (loaded.value) {
      entries.push({
        id: 'self',
        name: '我',
        duty: compare.selfDuty,
        isSelf: true,
        modes: aggregateModesPayload(store.statistics)
      })
    }
    for (const profile of profiles.value) {
      entries.push({
        id: profile.id,
        name: profile.name,
        duty: profile.duty,
        isSelf: false,
        modes: profile.modes
      })
    }
    return entries
  })

  /**
   * 「按模式」档只留同职责的对手（自己永远在场）；「综合榜」档跨职责，全都在。
   *
   * ⚠️ 「对比看哪个模式」取的就是页头那个 `selectedMode`（**同一个字段**，
   * 绝不新建第二个模式状态）—— 所以胶囊点下去术语与数字都会跟着换。
   */
  const dutyFiltered = computed(() => filterEntriesByDuty(rankingEntries.value, rankingKind.value))

  /** 有资格参赛的人（职责档下已筛过；自己永远在场）。 */
  const candidateEntries = computed(() => dutyFiltered.value.visible)

  /** 被职责筛掉的对手人数：如实提示，免得导入的档案看起来"凭空消失"。 */
  const hiddenRivals = computed(() => dutyFiltered.value.hidden)

  /** 真正上场的：扣掉被图例勾掉的人（勾掉谁 = 谁不参赛：卡片与参与者都按这个算）。 */
  const visibleEntries = computed(() =>
    candidateEntries.value.filter((entry) => !hiddenNames.value.includes(entry.name))
  )

  /** 参与者那一行的显示顺序：按当前对比档的累计从高到低。 */
  const participantRow = computed(() => sortEntriesByTotal(visibleEntries.value, rankingKind.value))

  /**
   * 折线数据里**始终带着所有有资格参赛的人**。
   *
   * ⚠️ 2026-10-05 现场踩过：把"被勾掉的人"整条从 series 里移除后，ECharts 的图例项
   * 也跟着消失 —— 用户就再也勾不回来了。正确做法是**系列常驻**、由 ECharts 自己的
   * 图例负责"画不画"（它天生支持），卡片那边才按勾选算。
   */
  const rankingSeries = computed(() =>
    buildRankingSeries(
      candidateEntries.value,
      rankingKind.value,
      viewMode.value,
      candidateEntries.value
    )
  )

  const kpiCards = computed(() => buildKpiCards(visibleEntries.value, rankingKind.value))

  /** 金/银/铜名次（按当前对比档的累计），挂在参与者胶囊上。 */
  const medalByName = computed(
    () =>
      new Map(rankingMedals(visibleEntries.value, rankingKind.value).map((m) => [m.name, m.rank]))
  )

  function medalBadge(name: string): string {
    const rank = medalByName.value.get(name)
    return rank ? MEDAL_BADGES[rank] : ''
  }

  /** 王冠只发给**真正上场**的人：把被勾掉的线排除后再评"每月最高"。 */
  const crowns = computed(() =>
    crownPoints(
      rankingSeries.value.categories,
      rankingSeries.value.series.filter((item) => !hiddenNames.value.includes(item.name))
    )
  )

  function dutyLabel(duty: WorkMode | null): string {
    return duty ? WORK_MODE_LABELS[duty] : '未填'
  }

  function kpiUnit(card: { kind: RankingKind }): string {
    return card.kind === 'overall' ? '张次' : '张'
  }

  const rankingChartOption = computed(() => {
    const palette = chartPalette.value
    const { categories, series } = rankingSeries.value
    // 只有"连横轴都没有"时才不画；把所有线都勾掉时仍要画（图例还在，用户能勾回来）
    if (categories.length === 0) return null

    return {
      color: palette.colors,
      textStyle: { color: palette.text },
      tooltip: {
        trigger: 'axis',
        ...tooltipStyle(palette),
        formatter: (params: { dataIndex: number; value: number; seriesName: string }[]) => {
          const category = categories[params[0]?.dataIndex ?? 0] ?? ''
          const lines = params
            .filter((p) => typeof p.value === 'number' && p.value > 0)
            .map(
              (p) =>
                `${escapeTooltip(p.seriesName)}: ${p.value}${rankingKind.value === 'overall' ? '张次' : '张'}`
            )
          return lines.length > 0
            ? `${category}<br/>${lines.join('<br/>')}`
            : `${category}<br/>暂无数据`
        }
      },
      legend: {
        // 图例 = 参赛名单：勾掉谁，谁就不参赛（卡片、折线、参与者行一起跟着变）
        data: candidateEntries.value.map((entry) => entry.name),
        selected: Object.fromEntries(
          candidateEntries.value.map((entry) => [
            entry.name,
            !hiddenNames.value.includes(entry.name)
          ])
        ),
        textStyle: { color: palette.text, fontSize: 13, fontWeight: 600 },
        top: 4
      },
      xAxis: { type: 'category', data: categories, ...axisStyle(palette) },
      yAxis: {
        type: 'value',
        ...valueAxisStyle(palette),
        // 顶部留一点余量：否则最高点头上那顶王冠会被画布边缘切掉
        max: (value: { min: number; max: number }) => Math.ceil(value.max * 1.12)
      },
      series: [
        ...series.map((item, index) => {
          // 节点 = 该条线颜色的圆，圆里是白色首字昵称（"头像"）。
          // 颜色显式绑到这一条 series 上，于是线 / 节点 / 图例色块永远同色。
          const color = palette.colors[index % palette.colors.length]
          const size = item.isSelf ? 30 : 26
          const initial = avatarInitial(item.name)
          return {
            name: item.name,
            type: 'line' as const,
            // 直线相连（2026-10-05 用户要求：不要平滑曲线）
            smooth: false,
            /**
             * ⚠️ 关掉"图例悬停联动"（2026-10-05 现场：点图例后整张图发白、得切页面才恢复）。
             *
             * 折线开着 `emphasis.focus: 'series'` 时，**点图例**会把那条线设成"聚焦"、
             * 其余线被虚化；可这条线紧接着又被勾掉了 ⇒ 剩下的线全部保持虚化。
             * 图例只负责"选谁上场"，不做聚焦；**图内**悬停一条线时的聚焦仍保留（鼠标移开就散）。
             */
            legendHoverLink: false,
            symbol: 'circle',
            symbolSize: size,
            lineStyle: { width: item.isSelf ? 4 : 2, color },
            itemStyle: { color, borderWidth: item.isSelf ? 2 : 0, borderColor: palette.text },
            z: item.isSelf ? 10 : 2,
            emphasis: { focus: 'series' },
            // null = 首尾空月份被裁掉（不画）；0 = 那个月真没干活（点不画、线照走）
            data: item.data.map((value) => ({
              value,
              symbolSize: typeof value === 'number' && value > 0 ? size : 0
            })),
            label: {
              show: true,
              position: 'inside' as const,
              color: '#ffffff',
              fontSize: item.isSelf ? 13 : 12,
              fontWeight: 'bold',
              formatter: (params: { value: number }) => (params.value > 0 ? initial : '')
            }
          }
        }),
        // 每个月最高者头上那顶王冠（并列则都戴；该月没人干活就不戴）
        ...(crowns.value.length > 0
          ? [
              {
                name: CROWN_SERIES_NAME,
                type: 'scatter' as const,
                symbol: CROWN_PATH,
                symbolSize: 20,
                symbolOffset: [0, -28],
                itemStyle: { color: MEDAL_GOLD },
                data: crowns.value.map((crown) => crown.point),
                z: 30,
                silent: true,
                legendHoverLink: false,
                tooltip: { show: false },
                label: { show: false }
              }
            ]
          : [])
      ]
    }
  })

  return {
    rankingKind,
    rankingSeries,
    rankingChartOption,
    visibleEntries,
    participantRow,
    hiddenRivals,
    kpiCards,
    medalBadge,
    dutyLabel,
    kpiUnit
  }
}
