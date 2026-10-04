<script setup lang="ts">
/**
 * 引导图例库 —— 15 张"复刻重画的迷你控件"（2026-10-03 加了进阶栏那四张）。
 *
 * 规矩（用户 2026-09-27 定的）：
 *   1. **布局照着参照图复刻**（哪一栏在哪、按钮在左还是在右、进度在文字哪侧，都对得上）；
 *   2. **漫画画面一律换成纯色块 + 中间两个字**（`bg-media-bg` + 「原图 / PSD」），
 *      不放真截图 —— 昼夜模式自动都对，也不会把漫画画面和用户的硬盘路径打进安装包；
 *   3. 只用主题 token（`--card-bg` / `--media-bg` / `--primary-soft` / `--done` / `--hairline`…），
 *      所以白天夜里都对。
 *
 * 每张图例自带"凹陷面板"的外观（`bg-sunken` + 细边框 + 圆角），由本组件负责，
 * 这样 `GuideDialog` 只管"文字下面紧跟哪几张图例"，不用逐张写尺寸。
 */
import {
  GUIDE_DUTY_CHIPS,
  GUIDE_DUTY_CHOSEN,
  GUIDE_HINT_LABEL,
  GUIDE_NAV_SECTIONS,
  GUIDE_LEDGER_ROWS,
  GUIDE_MODULE_CARDS,
  GUIDE_MODE_CHIPS,
  GUIDE_PROGRESS_ROWS,
  GUIDE_WIRE_WORDS,
  GUIDE_WORKBENCH_ROWS,
  type GuideArtId
} from './guide-pages'
import { WORK_MODE_SHORT_LABELS } from '@shared/modes'
import { computed } from 'vue'
import type { GuideNavWire } from './guide-pages'

const props = defineProps<{ art: GuideArtId; focus?: GuideNavWire }>()

/**
 * 导航图右边画哪一张线框 —— 由 `focus` 决定（第 1 页翻到哪一条，就画那一项的"大概样貌"）。
 * 左边的高亮用的是**同一个键**，所以"左边亮哪项 / 右边画哪页"不可能不同步。
 * 没给 focus 时退到第一项（首页），与"翻到第 1 条"一致。
 */
const activeNavWire = computed<GuideNavWire>(() => props.focus ?? 'dashboard')

/** 图例里"漫画页"的替身：纯色块 + 中间两个字。 */
const PAGE_LABELS = ['原图', '原图', '原图', '原图', '原图', '原图', '原图', '原图'] as const
</script>

<template>
  <div
    class="mx-auto flex w-fit max-w-full items-center justify-center rounded-[var(--radius-card)] border border-hairline bg-sunken p-4"
    :class="{
      'min-h-[190px]': art === 'nav' || art === 'parent-duty' || art === 'mark-ledger',
      'min-h-[230px]': art === 'workbench',
      'min-h-[150px]': art === 'toolbar-strip' || art === 'viewer-controls',
      'min-h-[200px]': art === 'add-project' || art === 'sidebar-manage',
      'min-h-[110px]': art === 'card-actions' || art === 'modules',
      'min-h-[100px]': art === 'row-progress',
      'min-h-[180px]': art === 'compare',
      'min-h-[210px]': art === 'mode-dropdown',
      'min-h-[160px]': art === 'progress'
    }"
    data-testid="guide-art"
    :data-art="art"
    aria-hidden="true"
  >
    <!-- ① 左侧导航（图一参照：六个方块 + 设置高亮） -->
    <div v-if="art === 'nav'" class="flex w-fit max-w-full items-stretch justify-center gap-3">
      <div class="flex w-16 flex-col gap-1 rounded-badge border border-border bg-card-bg p-1.5">
        <!-- 八项（七页 + 左下角「指引」）。**高亮跟着 `focus` 走** ——
             与右边那张线框同一个键，所以不可能不同步。 -->
        <div
          v-for="section in GUIDE_NAV_SECTIONS"
          :key="section.wire"
          class="flex flex-col items-center justify-center gap-1 rounded-[6px] py-1 text-[10px] leading-none"
          :class="
            section.wire === activeNavWire
              ? 'bg-primary-soft font-medium text-accent ring-1 ring-inset ring-accent'
              : 'text-text-secondary'
          "
          :data-nav-wire="section.wire"
        >
          <span
            class="h-3 w-3 rounded-[3px]"
            :class="section.wire === activeNavWire ? 'bg-accent' : 'bg-border-strong'"
          />
          {{ section.wire === 'guide' ? GUIDE_HINT_LABEL : section.label }}
        </div>
      </div>
      <!-- 右半边：当前那一项的"大概样貌"（8 张简笔线框，只用方块与 token，昼夜自动对） -->
      <!-- 右半边：当前那一项的"大概样貌"（8 张简笔线框，只用方块与 token，昼夜自动对）。
           ⚠️ 里面写的字**取自该条文案**（`GUIDE_WIRE_WORDS`，源头是 `wireWords`）——
           图负责"长什么样"、文案负责"叫什么"，两边共用同一批词，读者一眼能对上号
           （用户 2026-10-04 第 3 条）。 -->
      <div class="flex w-72 flex-col gap-2 rounded-badge border border-border bg-card-bg p-2.5">
        <!-- 首页：三张概览卡（写的就是文案里那三样）+ 清单 -->
        <template v-if="activeNavWire === 'dashboard'">
          <div class="grid grid-cols-3 gap-2">
            <div
              v-for="word in GUIDE_WIRE_WORDS.dashboard"
              :key="word"
              class="flex flex-col gap-1 rounded-[6px] border border-border bg-app-bg p-2"
            >
              <span class="text-[9px] leading-none text-text-secondary">{{ word }}</span>
              <span class="h-3 w-6 rounded-[3px] bg-accent" />
            </div>
          </div>
          <div class="flex flex-col gap-1">
            <span v-for="n in 3" :key="n" class="h-2 rounded-[3px] bg-media-bg" />
          </div>
        </template>

        <!-- 项目：左树（父级）+ 右卡片网格（话） -->
        <template v-else-if="activeNavWire === 'project'">
          <div class="flex min-h-0 flex-1 gap-2">
            <div
              class="flex w-16 shrink-0 flex-col gap-1 rounded-[6px] border border-border bg-app-bg p-1"
            >
              <span class="text-[9px] leading-none text-text-secondary">{{
                GUIDE_WIRE_WORDS.project[0]
              }}</span>
              <span v-for="n in 4" :key="n" class="h-2 rounded-[3px] bg-media-bg" />
            </div>
            <div class="flex min-w-0 flex-1 flex-col gap-1">
              <span class="text-[9px] leading-none text-text-secondary">{{
                GUIDE_WIRE_WORDS.project[1]
              }}</span>
              <div class="grid min-w-0 flex-1 grid-cols-3 gap-1.5">
                <span v-for="n in 6" :key="n" class="h-6 rounded-[4px] bg-media-bg" />
              </div>
            </div>
          </div>
        </template>

        <!-- 进度：一行一本的欠账清单（带真职责胶囊），表头用文案里那几个词 -->
        <template v-else-if="activeNavWire === 'progress'">
          <div class="flex items-center gap-2 text-[9px] leading-none text-text-tertiary">
            <span class="min-w-0 flex-1">{{ GUIDE_WIRE_WORDS.progress[0] }}</span>
            <span class="w-10 text-center">{{ GUIDE_WIRE_WORDS.progress[1] }}</span>
            <span class="w-14 text-right">{{ GUIDE_WIRE_WORDS.progress[2] }}</span>
          </div>
          <div
            v-for="n in 4"
            :key="n"
            class="flex items-center gap-2 rounded-[4px] border border-hairline px-1.5 py-1"
          >
            <span class="h-1.5 w-12 rounded-full bg-border-strong" />
            <span class="flex w-10 justify-center">
              <span class="duty-chip duty-chip--single"><span class="duty-chip__seg">校</span></span>
            </span>
            <span class="flex w-14 items-center justify-end gap-1">
              <span class="h-1.5 w-6 rounded-full bg-media-bg" />
              <span class="h-1.5 w-4 rounded-full bg-done" />
            </span>
          </div>
        </template>

        <!-- 成就：按月 / 按年 + 数字 + 柱状图 -->
        <template v-else-if="activeNavWire === 'achievements'">
          <div class="flex items-center gap-2">
            <span
              v-for="word in GUIDE_WIRE_WORDS.achievements"
              :key="word"
              class="rounded-full bg-primary-soft px-2 py-0.5 text-[9px] leading-none text-accent"
              >{{ word }}</span
            >
          </div>
          <span class="h-4 w-16 rounded-[3px] bg-accent" />
          <div class="flex min-h-0 flex-1 items-end gap-1.5">
            <span
              v-for="(bar, index) in [8, 14, 6, 18, 10, 16]"
              :key="index"
              class="w-3 rounded-t-[3px] bg-done"
              :style="{ height: bar * 2 + 'px' }"
            />
          </div>
        </template>

        <!-- 字体：扫描 / 安装 / 卸载 + 字体行 -->
        <template v-else-if="activeNavWire === 'fonts'">
          <div class="flex items-center gap-1.5">
            <span
              v-for="word in GUIDE_WIRE_WORDS.fonts"
              :key="word"
              class="rounded-badge px-1.5 py-0.5 text-[9px] leading-none text-text-secondary ring-1 ring-inset ring-border"
              >{{ word }}</span
            >
          </div>
          <span class="h-4 rounded-[4px] bg-media-bg" />
          <div
            v-for="n in 3"
            :key="n"
            class="flex items-center gap-2 rounded-[4px] border border-hairline px-1.5 py-1"
          >
            <span class="h-2 w-10 rounded-[3px] bg-media-bg" />
            <span class="h-1.5 w-8 rounded-full bg-border-strong" />
            <span class="ml-auto h-1.5 w-6 rounded-full bg-primary-soft" />
          </div>
        </template>

        <!-- 导入：读 txt → 生成 PSD -->
        <template v-else-if="activeNavWire === 'import'">
          <div class="flex items-center gap-1 text-[9px] leading-none text-text-secondary">
            <span class="h-2 w-2 rounded-full bg-accent" />
            <span>{{ GUIDE_WIRE_WORDS.import[0] }}</span>
            <span class="mx-1 h-px w-4 bg-border-strong" />
            <span class="h-2 w-2 rounded-full bg-border-strong" />
            <span>{{ GUIDE_WIRE_WORDS.import[1] }}</span>
          </div>
          <div class="flex min-h-0 flex-1 flex-col gap-1.5">
            <span v-for="n in 3" :key="n" class="h-3 rounded-[3px] bg-media-bg" />
            <span class="mt-auto h-4 w-16 rounded-badge bg-accent" />
          </div>
        </template>

        <!-- 设置：三张分组卡（写的就是文案里那三样）+ 一张空位 -->
        <template v-else-if="activeNavWire === 'settings'">
          <div class="grid grid-cols-2 gap-2">
            <span
              v-for="word in GUIDE_WIRE_WORDS.settings"
              :key="word"
              class="flex h-8 items-center rounded-[6px] border border-border bg-app-bg px-1.5 text-[9px] leading-tight text-text-secondary"
              >{{ word }}</span
            >
            <span class="h-8 rounded-[6px] border border-border bg-app-bg" />
          </div>
        </template>

        <!-- 指引：左下角那两枚按钮（指引 / 夜间） -->
        <template v-else>
          <div class="flex min-h-0 flex-1 items-center justify-start gap-2">
            <span
              class="flex h-6 w-6 items-center justify-center rounded-full bg-primary-soft text-[8px] text-accent ring-1 ring-inset ring-accent"
              >?</span
            >
            <span class="text-[9px] leading-none text-text-secondary">{{
              GUIDE_WIRE_WORDS.guide[0]
            }}</span>
            <span
              class="flex h-6 w-6 items-center justify-center rounded-full bg-media-bg text-[8px] text-text-tertiary"
              >☾</span
            >
          </div>
        </template>

        <span class="text-[10px] text-text-tertiary">点哪一项，右边就换成哪一页</span>
      </div>
    </div>

    <!-- ② 整张工作台（图二参照：左树 + 右卡片网格） -->
    <div v-else-if="art === 'workbench'" class="flex w-full max-w-lg gap-2">
      <div class="flex w-40 shrink-0 flex-col gap-1 rounded-badge border border-border bg-card-bg p-1.5">
        <div class="flex gap-1 text-[9px]">
          <span class="rounded-[3px] bg-accent px-1.5 py-0.5 font-medium text-text-on-accent">添加</span>
          <span class="whitespace-nowrap rounded-[3px] px-1.5 py-0.5 text-text-secondary ring-1 ring-inset ring-border">修改</span>
          <span class="whitespace-nowrap rounded-[3px] px-1.5 py-0.5 text-text-secondary ring-1 ring-inset ring-border">删除</span>
          <span class="whitespace-nowrap rounded-[3px] px-1 py-0.5 text-text-secondary">管理</span>
        </div>
        <div class="mt-1 flex items-center gap-1 border-b border-hairline pb-1 text-[10px] text-text-primary">
          <span class="text-text-tertiary">▾</span>
          <!-- ⚠️ 这里以前画的是那颗旧 6px 小圆点 —— 它早被**职责胶囊**取代了
               （用户 2026-10-03 指出"图四框选圆点已改为职责胶囊标签"）。用真原语画。 -->
          <span class="duty-chip duty-chip--single"><span class="duty-chip__seg">嵌</span></span>
          <span class="font-bold">町野同学</span>
          <span class="ml-auto text-text-tertiary">↻</span>
        </div>
        <div
          v-for="(row, index) in GUIDE_WORKBENCH_ROWS"
          :key="row.chapter"
          class="flex items-center gap-1 rounded-[4px] px-1 py-0.5 text-[9px]"
          :class="index === 1 ? 'bg-card-bg-hover font-medium text-accent' : 'text-text-secondary'"
        >
          <span class="truncate">{{ row.chapter }}</span>
          <span class="ml-auto shrink-0 tabular-nums text-text-tertiary">{{ row.progress }}</span>
        </div>
      </div>
      <div class="grid min-w-0 flex-1 grid-cols-4 gap-1.5">
        <div
          v-for="(label, index) in PAGE_LABELS"
          :key="index"
          class="flex flex-col gap-1 rounded-badge border border-border bg-card-bg p-1"
        >
          <div class="flex h-10 items-center justify-center rounded-[4px] bg-media-bg text-[9px] text-text-tertiary">
            {{ label }}
          </div>
          <div class="truncate text-[8px] text-text-tertiary">00{{ index + 1 }}.jpg</div>
          <div class="flex items-center justify-between text-[8px] text-text-tertiary">
            <span class="h-2 w-2 rounded-full border border-border-strong" />
            <span class="rounded-full px-1 ring-1 ring-inset ring-border">去嵌字</span>
          </div>
        </div>
      </div>
    </div>

    <!-- ③ 添加项目表单（2026-10-04 新增：点「添加」后看到的那张表单）。
         复刻 `components/ProjectFormModal.vue` —— 字段名与真实标签一致；
         四条注意点**写在各自的框内**（用户 2026-10-04 第 4 条的原话）。 -->
    <div
      v-else-if="art === 'add-project'"
      class="flex w-full max-w-sm flex-col gap-2 rounded-badge border border-border bg-card-bg p-3"
    >
      <div class="text-[11px] font-medium text-text-primary">添加项目</div>
      <div class="flex flex-col gap-1">
        <div class="text-[10px] text-text-secondary">项目所在文件夹路径</div>
        <div class="flex items-center gap-1.5">
          <span
            class="flex h-7 min-w-0 flex-1 items-center rounded-badge bg-app-bg px-2 text-[9px] leading-snug text-text-tertiary ring-1 ring-inset ring-border"
            >填入想选漫画对应的文件夹地址</span
          >
          <span
            class="shrink-0 rounded-badge bg-accent px-2 py-1 text-[9px] leading-none text-text-on-accent"
            >浏览</span
          >
        </div>
      </div>
      <div class="flex flex-col gap-1">
        <div class="text-[10px] text-text-secondary">漫画名称(父级)</div>
        <span
          class="flex min-h-7 items-center rounded-badge bg-app-bg px-2 py-1 text-[9px] leading-snug text-text-tertiary ring-1 ring-inset ring-border"
          >已有漫画下拉列表选择；新加漫画在此输入期望标题</span
        >
      </div>
      <div class="flex flex-col gap-1">
        <div class="text-[10px] text-text-secondary">集数</div>
        <!-- 真实表单在"添加"时自动聚焦集数 ⇒ 图里也给它主色描边（与真机一致） -->
        <span
          class="flex min-h-7 items-center rounded-badge bg-app-bg px-2 py-1 text-[9px] leading-snug text-text-tertiary ring-1 ring-inset ring-accent"
          >单话集数，可汉字（如番外）；初次新建无需填写。</span
        >
      </div>
      <div class="flex flex-col gap-1">
        <div class="text-[10px] text-text-secondary">项目标题</div>
        <span
          class="flex min-h-7 items-center rounded-badge bg-app-bg px-2 py-1 text-[9px] leading-snug text-text-tertiary ring-1 ring-inset ring-border"
          >单话标题；初次新建无需填写。</span
        >
      </div>
      <div class="flex items-center justify-end gap-1.5">
        <span
          class="rounded-badge px-2 py-1 text-[9px] leading-none text-text-secondary ring-1 ring-inset ring-border"
          >取消</span
        >
        <span class="rounded-badge bg-primary-soft px-2 py-1 text-[9px] leading-none text-accent"
          >保存</span
        >
      </div>
    </div>

    <!-- ④ 侧栏工具条 + 管理面板 + 父级行（原图三 + 图四合成为一张，2026-10-04） -->
    <div v-else-if="art === 'sidebar-manage'" class="flex w-full max-w-sm flex-col gap-1.5">
      <div class="flex items-center gap-1.5">
        <span
          class="rounded-badge bg-accent px-2.5 py-1 text-[11px] font-medium text-text-on-accent"
          >添加</span
        >
        <span
          class="rounded-badge px-2.5 py-1 text-[11px] text-text-secondary ring-1 ring-inset ring-border"
          >修改</span
        >
        <span
          class="rounded-badge px-2.5 py-1 text-[11px] text-text-secondary ring-1 ring-inset ring-border"
          >删除</span
        >
        <span
          class="ml-auto flex items-center gap-1 rounded-badge px-1.5 py-1 text-[11px] text-text-secondary"
        >
          <span
            class="flex h-3 w-3 items-center justify-center rounded-[3px] text-[7px] ring-1 ring-inset ring-border"
            >✓</span
          >
          管理
        </span>
      </div>
      <div class="flex flex-col gap-1.5 rounded-badge border border-border bg-card-bg p-2">
        <div class="flex items-center gap-1.5 text-[10px] text-text-secondary">
          <span class="rounded-badge px-1.5 py-0.5 ring-1 ring-inset ring-border">已嵌全部</span>
          <span class="rounded-badge px-1.5 py-0.5 ring-1 ring-inset ring-border">未嵌全部</span>
          <span class="rounded-badge px-1.5 py-0.5 ring-1 ring-inset ring-border">删除选中</span>
          <span
            class="ml-auto rounded-badge px-1.5 py-0.5 text-text-primary ring-1 ring-inset ring-border"
            >取消</span
          >
        </div>
        <div class="flex flex-col border-t border-hairline pt-1.5">
          <div
            class="flex items-center gap-1.5 pb-1 text-[10px] text-text-secondary"
          >
            <span class="text-text-tertiary">›</span>
            <span class="h-1.5 w-1.5 rounded-full bg-border-strong" />
            <span class="font-bold text-text-primary">町野同学</span>
            <span class="ml-auto text-text-tertiary">重命名</span>
            <span class="text-text-tertiary">⋮⋮</span>
          </div>
          <div class="flex items-center gap-1.5 text-[10px] text-text-secondary">
            <span class="text-text-tertiary">›</span>
            <span class="h-1.5 w-1.5 rounded-full bg-border-strong" />
            <span class="font-bold text-text-primary">青梅亭亭</span>
            <span class="ml-auto text-text-tertiary">重命名</span>
            <span class="text-text-tertiary">⋮⋮</span>
          </div>
        </div>
      </div>
    </div>

    <!-- ⑤ 每行进度（图五参照：父级行 + 两话，进度在文字右侧） -->
    <div v-else-if="art === 'row-progress'" class="flex w-full max-w-sm flex-col rounded-badge border border-border bg-card-bg">
      <div class="flex items-center gap-1.5 px-2 py-1.5 text-[11px] text-text-primary">
        <span class="text-text-tertiary">▾</span>
        <span class="h-1.5 w-1.5 rounded-full bg-accent" />
        <span class="font-bold">町野同学</span>
        <span class="ml-auto text-text-tertiary">↻</span>
      </div>
      <div class="border-t border-hairline px-2 py-1.5 text-[10px] text-text-secondary">
        <div class="flex items-center gap-2">
          <span class="truncate">第20集 · conv</span>
          <span class="ml-auto flex shrink-0 items-center gap-1.5">
            <span class="h-1 w-8 overflow-hidden rounded-full bg-media-bg">
              <span class="block h-full w-0 rounded-full bg-done" />
            </span>
            <span class="tabular-nums text-text-tertiary">翻译进度0/24</span>
          </span>
        </div>
      </div>
      <div class="border-t border-hairline bg-card-bg-hover px-2 py-1.5 text-[10px] text-text-accent">
        <div class="flex items-center gap-2 font-medium text-accent">
          <span class="truncate">第19集 · conv</span>
          <span class="ml-auto flex shrink-0 items-center gap-1.5">
            <span class="h-1 w-8 overflow-hidden rounded-full bg-media-bg">
              <span class="block h-full w-full rounded-full bg-done" />
            </span>
            <span class="tabular-nums text-text-tertiary">翻译进度16/16</span>
          </span>
        </div>
      </div>
    </div>

    <!-- ⑥ 卡片右下「去X」（图六 + 图七参照：两张卡片各带一枚胶囊） -->
    <div v-else-if="art === 'card-actions'" class="flex items-center gap-3">
      <div class="flex w-28 flex-col gap-1 rounded-badge border border-border bg-card-bg p-1.5">
        <div class="flex h-8 items-center justify-center rounded-[4px] bg-media-bg text-[9px] text-text-tertiary">
          原图
        </div>
        <div class="flex justify-end">
          <span class="rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-medium text-accent ring-1 ring-inset ring-accent">
            去嵌字
          </span>
        </div>
      </div>
      <div class="flex w-28 flex-col gap-1 rounded-badge border border-border bg-card-bg p-1.5">
        <div class="flex h-8 items-center justify-center rounded-[4px] bg-media-bg text-[9px] text-text-tertiary">
          原图
        </div>
        <div class="flex justify-end">
          <span class="rounded-full px-2 py-0.5 text-[10px] text-accent ring-1 ring-inset ring-border">
            去翻译
          </span>
        </div>
      </div>
    </div>

    <!-- ⑦ 对照模式（图八参照：头部四个按钮 + 原图 | PSD 两栏） -->
    <div v-else-if="art === 'compare'" class="flex w-full max-w-md flex-col gap-1.5">
      <div class="flex items-center gap-1.5 rounded-badge border border-border bg-card-bg px-2 py-1.5">
        <span class="text-[11px] font-semibold text-accent">对照视图</span>
        <span class="text-[10px] text-text-secondary">10.psd</span>
        <span class="ml-auto flex items-center gap-1 text-[9px]">
          <span class="rounded-badge bg-accent px-1.5 py-0.5 font-medium text-text-on-accent">标记嵌字</span>
          <span class="rounded-badge bg-primary-soft px-1.5 py-0.5 text-accent">标记未嵌字</span>
          <span class="rounded-badge px-1.5 py-0.5 text-text-secondary ring-1 ring-inset ring-border">去嵌字</span>
          <span class="rounded-badge bg-accent px-1.5 py-0.5 font-medium text-text-on-accent">退出预览</span>
        </span>
      </div>
      <div class="flex gap-1.5">
        <div class="flex flex-1 flex-col gap-1 rounded-badge border border-border bg-card-bg p-1.5">
          <span class="text-[9px] text-text-tertiary">原图</span>
          <div class="flex h-20 items-center justify-center rounded-[4px] bg-media-bg text-[10px] text-text-tertiary">
            原图
          </div>
        </div>
        <div class="flex flex-1 flex-col gap-1 rounded-badge border border-border bg-card-bg p-1.5">
          <span class="text-[9px] text-text-tertiary">PSD</span>
          <div class="flex h-20 items-center justify-center rounded-[4px] bg-media-bg text-[10px] text-text-tertiary">
            PSD
          </div>
        </div>
      </div>
    </div>

    <!-- ⑧ 工作台工具条左上角（图二左上角那三个控件） -->
    <div v-else-if="art === 'toolbar-strip'" class="flex w-full max-w-sm items-center gap-1.5">
      <span class="rounded-badge px-2 py-1 text-[10px] text-text-secondary ring-1 ring-inset ring-border">
        打开当前文件夹
      </span>
      <span class="rounded-badge px-2 py-1 text-[10px] text-text-secondary ring-1 ring-inset ring-border">刷新</span>
      <span class="flex items-center gap-1 rounded-badge px-2 py-1 text-[10px] text-text-secondary ring-1 ring-inset ring-accent">
        嵌字 <span class="text-[8px] text-accent">▾</span>
      </span>
    </div>

    <!-- ⑨ 模式下拉展开（图九参照） -->
    <div v-else-if="art === 'mode-dropdown'" class="flex flex-col items-start gap-1">
      <span class="flex items-center gap-1 rounded-badge bg-card-bg px-2.5 py-1 text-[11px] text-text-secondary ring-1 ring-inset ring-accent">
        嵌字 <span class="text-[9px] text-accent">▴</span>
      </span>
      <div class="flex w-28 flex-col rounded-badge border border-border bg-card-bg p-1 shadow-[var(--shadow-2)]">
        <span
          v-for="(chip, index) in GUIDE_MODE_CHIPS"
          :key="chip.mode"
          class="rounded-[4px] px-2 py-1 text-[11px] leading-none"
          :class="
            index === 0
              ? 'bg-primary-soft font-medium text-accent'
              : index === 1
                ? 'bg-card-bg-hover text-text-secondary'
                : 'text-text-secondary'
          "
        >
          {{ chip.label }}
        </span>
      </div>
      <span class="pl-1 text-[9px] text-text-tertiary">切一下就跟着变：标记X / 去X / 每行进度 / 成就统计</span>
    </div>

    <!-- ⑩ 设置页的外部工具那张示意图**已删**（用户 2026-10-04 第 8 条：
         第 4 页改成"一处介绍紧跟一处填写框"，不再放示意图） -->

    <!-- ⑫ 父级「职责」（进阶第 1 页，2026-10-03）：胶囊 + 展开的菜单 -->
    <div v-else-if="art === 'parent-duty'" class="flex w-full max-w-sm flex-col gap-1.5">
      <div class="flex w-full items-center gap-1.5 rounded-badge border border-border bg-card-bg px-2 py-2">
        <span class="text-[10px] text-text-tertiary">▾</span>
        <!-- 这一枚是**真原语**（styles/index.css 的 .duty-chip），不是另画一套：
             图例与程序必须长得一样（2026-10-03 收敛时把第三份拷贝也收了）。 -->
        <span class="duty-chip duty-chip--pair">
          <span
            v-for="(chip, index) in GUIDE_DUTY_CHIPS.filter((item) =>
              GUIDE_DUTY_CHOSEN.includes(item.mode)
            )"
            :key="chip.mode"
            class="duty-chip__seg"
            :class="index === 0 ? 'duty-chip__seg--divide' : ''"
          >
            {{ chip.short }}
          </span>
        </span>
        <span class="text-[12px] font-bold text-text-primary">青梅亭亭</span>
        <span class="ml-auto text-[11px] text-text-tertiary">⟳</span>
      </div>
      <div class="ml-6 flex w-32 flex-col rounded-badge border border-border bg-card-bg p-1 shadow-[var(--shadow-2)]">
        <span
          v-for="chip in GUIDE_DUTY_CHIPS"
          :key="chip.mode"
          class="rounded-badge px-2 py-1 text-[11px] leading-none"
          :class="
            GUIDE_DUTY_CHOSEN.includes(chip.mode)
              ? 'bg-primary-soft font-medium text-accent'
              : 'text-text-primary'
          "
        >
          {{ chip.label }}{{ GUIDE_DUTY_CHOSEN.includes(chip.mode) ? ' ✓' : '' }}
        </span>
        <span class="px-2 pt-1 pb-0.5 text-[10px] leading-4 text-text-tertiary">最多 2 个</span>
      </div>
      <span class="pl-1 text-[9px] text-text-tertiary">
        点这枚胶囊就能改；进这一本时模式会自动切过去
      </span>
    </div>

    <!-- 进度页（进阶第 2 页，2026-10-03 新增）：逐本欠账清单 -->
    <div v-else-if="art === 'progress'" class="flex w-full max-w-md flex-col gap-1">
      <div class="flex items-center gap-2 px-2 text-[9px] font-medium text-text-tertiary">
        <span class="min-w-0 flex-1">漫画</span>
        <span class="w-10 text-center">职责</span>
        <span class="w-12 text-right">待烤</span>
        <span class="w-16 text-right">完成度</span>
      </div>
      <div
        v-for="row in GUIDE_PROGRESS_ROWS"
        :key="row.title"
        class="flex items-center gap-2 rounded-[6px] border border-hairline bg-card-bg px-2 py-1.5"
      >
        <span class="min-w-0 flex-1 truncate text-[11px] font-medium text-text-primary">{{
          row.title
        }}</span>
        <span class="flex w-10 justify-center">
          <span
            class="duty-chip"
            :class="row.duties.length > 1 ? 'duty-chip--pair' : 'duty-chip--single'"
          >
            <span
              v-for="(mode, index) in row.duties"
              :key="mode"
              class="duty-chip__seg"
              :class="index === 0 && row.duties.length > 1 ? 'duty-chip__seg--divide' : ''"
              >{{ WORK_MODE_SHORT_LABELS[mode] }}</span
            >
          </span>
        </span>
        <span
          class="w-12 text-right text-[10px] font-semibold"
          :class="row.uncooked === '✓ 全熟' ? 'text-success' : 'text-done'"
          >{{ row.uncooked }}</span
        >
        <span class="flex w-16 items-center justify-end gap-1">
          <span class="relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-media-bg">
            <span
              class="absolute inset-y-0 left-0 rounded-full bg-done"
              :style="{ width: Math.round((row.done / row.total) * 100) + '%' }"
            />
          </span>
          <span class="text-[9px] tabular-nums text-text-tertiary">{{ row.done }}/{{ row.total }}</span>
        </span>
      </div>
    </div>

    <!-- ⑬ 标记有记录（进阶第 3 页）：撤销 + 台账 + 备份 -->
    <div v-else-if="art === 'mark-ledger'" class="flex w-full max-w-sm flex-col gap-2">
      <div class="flex items-center gap-2">
        <span class="flex items-center gap-1 rounded-badge bg-accent px-2 py-1 text-[11px] text-text-on-accent">
          ↺ 撤销
        </span>
        <span class="text-[10px] text-text-tertiary">最近一次标记（Ctrl+Z 也行）</span>
      </div>
      <div class="flex flex-col rounded-badge border border-border bg-card-bg p-2 shadow-[var(--shadow-2)]">
        <div class="flex items-center gap-2 pb-1">
          <span class="text-[11px] font-medium text-text-primary">标记记录</span>
          <!-- 示例数字：图例里的数都是举例子，跟 GUIDE_WORKBENCH_ROWS 一样 -->
          <span class="rounded-full bg-primary-soft px-1.5 py-0.5 text-[9px] text-accent">共 28 次</span>
        </div>
        <div
          v-for="row in GUIDE_LEDGER_ROWS"
          :key="row.when"
          class="flex items-center gap-2 border-t border-hairline py-1 text-[10px] text-text-secondary"
        >
          <span class="text-text-tertiary">{{ row.when }}</span>
          <span>{{ row.mode }}</span>
          <span>{{ row.files }}</span>
          <span
            class="ml-auto rounded-badge border border-border px-1.5 py-0.5 text-[9px]"
            :class="row.settled === '还原' ? 'text-accent' : 'text-text-tertiary'"
          >
            {{ row.settled }}
          </span>
        </div>
      </div>
      <div class="flex items-center gap-2 rounded-badge border border-border bg-card-bg px-2 py-1.5">
        <span class="text-[10px] text-text-tertiary">设置 › 数据安全</span>
        <span class="text-[10px] text-text-primary">备份 20 份</span>
        <span class="ml-auto rounded-badge border border-border px-1.5 py-0.5 text-[9px] text-accent">
          从备份还原标记
        </span>
      </div>
      <span class="pl-1 text-[9px] text-text-tertiary">
        还原前会先把差异摆给你看，确认了才写回去
      </span>
    </div>

    <!-- ⑭ 看图三件套 + 标记后下一张（进阶第 4 页） -->
    <div v-else-if="art === 'viewer-controls'" class="flex w-full flex-col gap-2">
      <div
        class="flex w-full items-center gap-1.5 whitespace-nowrap rounded-badge border border-border bg-card-bg px-2 py-1.5"
      >
        <span class="rounded-[4px] bg-primary-soft px-1.5 py-0.5 text-[10px] text-accent">100%</span>
        <span class="text-[11px] text-text-secondary">−</span>
        <span class="text-[11px] text-text-secondary">+</span>
        <span class="mx-1 h-3 w-px bg-border" />
        <span class="text-[10px] text-text-secondary">▶ 播放</span>
        <span class="text-[10px] text-text-secondary">▤ 胶片</span>
        <span class="mx-1 h-3 w-px bg-border" />
        <!-- 这枚在**对照视图的工具条**上（不在设置页）—— 画出来省得读者去猜 -->
        <span
          class="rounded-[4px] border border-primary-border bg-primary-soft px-1.5 py-0.5 text-[10px] text-accent"
          data-testid="guide-art-advance-chip"
        >
          ⇥ 下一张
        </span>
      </div>
      <div class="flex items-center gap-1">
        <span
          v-for="page in ['03', '04', '05', '06']"
          :key="page"
          class="flex h-8 w-6 items-center justify-center rounded-[4px] bg-media-bg text-[9px]"
          :class="page === '05' ? 'font-medium text-accent ring-1 ring-inset ring-accent' : 'text-text-tertiary'"
        >
          {{ page }}
        </span>
        <span class="ml-1 text-[9px] text-text-tertiary">点哪张跳哪张</span>
      </div>
      <span class="pl-1 text-[9px] text-text-tertiary">
        Ctrl+滚轮也能缩、双击画面回适应窗口；播放中：点画面任意处 / 翻页 / 退出预览都会停
      </span>
    </div>

    <!-- ⑪ 另外三个模块（第 5 页） -->
    <div v-else class="flex flex-wrap justify-center gap-3">
      <div
        v-for="card in GUIDE_MODULE_CARDS"
        :key="card.title"
        class="flex w-28 flex-col gap-1 rounded-badge border border-border bg-card-bg p-2"
      >
        <div class="text-[11px] font-medium text-text-primary">{{ card.title }}</div>
        <div class="text-[10px] leading-snug text-text-tertiary">{{ card.hint }}</div>
      </div>
    </div>
  </div>
</template>
