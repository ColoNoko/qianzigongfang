import { shallowRef } from 'vue'

export const confirmation = shallowRef<{ message: string; resolve: (accepted: boolean) => void } | null>(null)

/** Only one destructive confirmation can be pending; repeated clicks are ignored. */
export function confirmAction(message: string): Promise<boolean> {
  if (confirmation.value) return Promise.resolve(false)
  return new Promise(resolve => { confirmation.value = { message, resolve } })
}

export function settleConfirmation(accepted: boolean): void {
  const pending = confirmation.value
  confirmation.value = null
  pending?.resolve(accepted)
}
