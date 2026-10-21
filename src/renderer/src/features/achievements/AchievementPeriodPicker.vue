<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Button } from '@renderer/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover';
import { ToggleGroup, ToggleGroupItem } from '@renderer/components/ui/toggle-group';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-vue-next';
const props = defineProps<{ year: number; month: number; kind: 'year' | 'month' }>();
const emit = defineEmits<{ change: [value: { year: number; month: number }] }>();
const selectYear = ref(false);
const open = ref(false),
  year = ref(props.year),
  month = ref(props.month),
  base = ref(props.year - 5);
watch(open, (v) => {
  if (v) {
    selectYear.value = false;
    year.value = props.year;
    month.value = props.month;
    base.value = props.year - 5;
  }
});
const years = computed(() => Array.from({ length: 12 }, (_, i) => base.value + i));
function chooseYear(v: unknown) {
  if (v) {
    year.value = Number(v);
    selectYear.value = false;
  }
}
function apply() {
  emit('change', { year: year.value, month: month.value });
  open.value = false;
}
function move(delta: number) {
  const d = new Date(
    props.year,
    props.kind === 'month' ? props.month - 1 + delta : props.month - 1,
    1
  );
  emit('change', {
    year: props.kind === 'year' ? props.year + delta : d.getFullYear(),
    month: d.getMonth() + 1
  });
}
</script>
<template>
  <div class="flex flex-wrap items-center gap-1">
    <Button variant="ghost" size="sm" aria-label="上一周期" @click="move(-1)">{{
      kind === 'month' ? '上月' : '上年'
    }}</Button
    ><Popover v-model:open="open"
      ><PopoverTrigger as-child
        ><Button variant="outline" size="sm" data-testid="achievement-date-picker"
          ><CalendarDays class="size-4" />{{ props.year }} 年{{
            kind === 'month' ? ` ${props.month} 月` : ''
          }}</Button
        ></PopoverTrigger
      ><PopoverContent class="w-[280px] p-4"
        ><div class="mb-3 flex items-center justify-between">
          <Button
            variant="ghost"
            size="icon"
            :disabled="year <= 1900"
            aria-label="选择上一年"
            @click="year--"
            ><ChevronLeft class="size-4"
          /></Button>
          <Button variant="ghost" size="sm" @click="selectYear = !selectYear">{{
            selectYear ? `${base} — ${base + 11}` : `${year} 年`
          }}</Button>
          <Button
            variant="ghost"
            size="icon"
            :disabled="year >= 2199"
            aria-label="选择下一年"
            @click="year++"
            ><ChevronRight class="size-4"
          /></Button>
        </div>
        <template v-if="selectYear || kind === 'year'">
          <div class="mb-2 flex justify-between">
            <Button variant="ghost" size="xs" :disabled="base <= 1900" @click="base -= 12"
              >前 12 年</Button
            ><Button variant="ghost" size="xs" :disabled="base >= 2188" @click="base += 12"
              >后 12 年</Button
            >
          </div>
          <ToggleGroup
            type="single"
            :model-value="String(year)"
            class="date-grid"
            aria-label="选择年份"
            @update:model-value="chooseYear"
            ><ToggleGroupItem v-for="y in years" :key="y" :value="String(y)">{{
              y
            }}</ToggleGroupItem></ToggleGroup
          >
        </template>
        <ToggleGroup
          v-else
          type="single"
          :model-value="String(month)"
          class="date-grid"
          aria-label="选择月份"
          @update:model-value="
            (v) => {
              if (v) month = Number(v);
            }
          "
          ><ToggleGroupItem v-for="m in 12" :key="m" :value="String(m)"
            >{{ m }} 月</ToggleGroupItem
          ></ToggleGroup
        >
        <div class="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" @click="open = false">取消</Button
          ><Button size="sm" @click="apply">应用</Button>
        </div></PopoverContent
      ></Popover
    ><Button variant="ghost" size="sm" aria-label="下一周期" @click="move(1)">{{
      kind === 'month' ? '下月' : '下年'
    }}</Button
    ><Button
      variant="ghost"
      size="sm"
      @click="emit('change', { year: new Date().getFullYear(), month: new Date().getMonth() + 1 })"
      >本期</Button
    >
  </div>
</template>
<style scoped>
.date-grid {
  display: grid !important;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px !important;
  width: 100%;
  padding: 0 !important;
  background: transparent !important;
  border: 0 !important;
  border-radius: 0 !important;
}
.date-grid :deep(button) {
  height: 38px;
  border-radius: 7px;
  box-shadow: none;
}
.date-grid :deep(button[data-state='on']) {
  background: var(--primary);
  color: var(--primary-fg);
}
</style>
