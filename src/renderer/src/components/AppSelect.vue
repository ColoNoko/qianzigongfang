<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

export interface AppSelectOption {
  value: string | number
  label: string
  disabled?: boolean
}

const props = withDefaults(
  defineProps<{
    modelValue: string | number
    options: AppSelectOption[]
    testId?: string
    size?: 'small' | 'medium'
    searchable?: boolean
    searchPlaceholder?: string
  }>(),
  {
    testId: '',
    size: 'medium',
    searchable: false,
    searchPlaceholder: '搜索…'
  }
)

const emit = defineEmits<{
  (event: 'update:modelValue', value: string | number): void
  (event: 'change', value: string | number): void
}>()

const root = ref<HTMLElement | null>(null)
const searchInput = ref<HTMLInputElement | null>(null)
const open = ref(false)
const query = ref('')
const selectedOption = computed(
  () =>
    props.options.find((option) => String(option.value) === String(props.modelValue)) ??
    props.options[0]
)

const filteredOptions = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase()
  if (!needle) return props.options
  return props.options.filter((option) => option.label.toLocaleLowerCase().includes(needle))
})

async function openMenu(): Promise<void> {
  open.value = true
  if (props.searchable) {
    await nextTick()
    searchInput.value?.focus()
  }
}

function closeMenu(): void {
  open.value = false
  query.value = ''
}

function choose(option: AppSelectOption): void {
  if (option.disabled) return
  emit('update:modelValue', option.value)
  emit('change', option.value)
  closeMenu()
}

function onNativeChange(event: Event): void {
  const raw = (event.target as HTMLSelectElement).value
  const option = props.options.find((item) => String(item.value) === raw)
  if (option) choose(option)
}

function onDocumentPointerDown(event: PointerEvent): void {
  if (!root.value?.contains(event.target as Node)) open.value = false
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    closeMenu()
    return
  }
  if (props.searchable && !open.value && event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
    event.preventDefault()
    query.value = event.key
    void openMenu()
    return
  }
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    if (open.value) closeMenu()
    else void openMenu()
  }
}

onMounted(() => document.addEventListener('pointerdown', onDocumentPointerDown))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocumentPointerDown))
</script>

<template>
  <div ref="root" class="relative inline-block min-w-0">
    <!-- Kept for forms and assistive tooling; the visible popup is app-rendered. -->
    <select
      class="sr-only"
      tabindex="-1"
      :value="modelValue"
      :data-testid="testId || undefined"
      aria-hidden="true"
      @change="onNativeChange"
    >
      <option
        v-for="option in options"
        :key="String(option.value)"
        :value="option.value"
        :disabled="option.disabled"
      >
        {{ option.label }}
      </option>
    </select>

    <button
      type="button"
      class="flex w-full items-center justify-between gap-3 rounded-badge border border-border bg-card-bg text-left text-text-primary outline-none transition-colors hover:border-border-strong focus:border-accent"
      :class="size === 'small' ? 'h-8 px-2 text-xs' : 'h-9 px-2.5 text-sm'"
      :aria-expanded="open"
      aria-haspopup="listbox"
      :data-testid="testId ? `${testId}-trigger` : undefined"
      @click="open ? closeMenu() : void openMenu()"
      @keydown="onKeydown"
    >
      <span class="truncate">{{ selectedOption?.label }}</span>
      <svg
        class="h-3.5 w-3.5 shrink-0 text-text-tertiary transition-transform"
        :class="open ? 'rotate-180' : ''"
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="m5.5 7.5 4.5 4.5 4.5-4.5z" />
      </svg>
    </button>

    <div
      v-if="open"
      class="absolute left-0 top-full z-[80] mt-1 max-h-72 min-w-full overflow-y-auto rounded-lg border border-border bg-card-bg p-1 shadow-[var(--shadow-2)]"
      role="listbox"
      :data-testid="testId ? `${testId}-menu` : undefined"
    >
      <input
        v-if="searchable"
        ref="searchInput"
        v-model="query"
        type="search"
        :placeholder="searchPlaceholder"
        class="mb-1 h-8 w-full rounded-badge border border-border bg-app-bg px-2 text-xs text-text-primary outline-none focus:border-accent"
        :data-testid="testId ? `${testId}-search` : undefined"
        role="searchbox"
        @click.stop
        @keydown.escape.stop="closeMenu"
      />
      <button
        v-for="option in filteredOptions"
        :key="String(option.value)"
        type="button"
        role="option"
        class="block w-full whitespace-nowrap rounded-badge px-3 py-2 text-left transition-colors"
        :class="
          String(option.value) === String(modelValue)
            ? 'bg-selected-bg font-medium text-accent ring-1 ring-inset ring-selected-border'
            : 'text-text-primary hover:bg-selected-bg focus:bg-selected-bg focus:outline-none'
        "
        :disabled="option.disabled"
        :aria-selected="String(option.value) === String(modelValue)"
        :data-testid="testId ? `${testId}-option-${String(option.value)}` : undefined"
        @click="choose(option)"
      >
        {{ option.label }}
      </button>
      <p v-if="filteredOptions.length === 0" class="px-3 py-2 text-xs text-text-tertiary">
        没有匹配项
      </p>
    </div>
  </div>
</template>
