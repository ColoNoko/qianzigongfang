import type {
  LabelPlusFileSelection,
  LabelPlusGenerateOptions,
  LabelPlusMatchMode
} from '@shared/labelplus-import'
import type { Ref } from 'vue'

export interface ImportFormState {
  selection: Ref<LabelPlusFileSelection | null>
  sourceDirectory: Ref<string>
  outputDirectory: Ref<string>
  matchMode: Ref<LabelPlusMatchMode>
  forcedExtension: Ref<string>
  selectedImageNames: Ref<string[]>
  selectedGroups: Ref<string[]>
  options: Ref<LabelPlusGenerateOptions>
}
