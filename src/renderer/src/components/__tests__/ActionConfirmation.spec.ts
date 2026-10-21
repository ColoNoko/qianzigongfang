// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { config, enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import ActionConfirmation from '../ActionConfirmation.vue'
import { confirmAction, settleConfirmation } from '@renderer/services/confirm'
config.global.stubs.teleport = true
config.global.renderStubDefaultSlot = true
enableAutoUnmount(afterEach)
afterEach(() => settleConfirmation(false))
it('requires explicit acceptance, cancels safely and rejects repeated requests', async () => {
  const wrapper = mount(ActionConfirmation, { attachTo: document.body })
  const canceled = confirmAction('删除项目？')
  await flushPromises()
  await expect(confirmAction('重复请求')).resolves.toBe(false)
  await wrapper.findAll('button').find(button => button.text() === '取消')!.trigger('click')
  await expect(canceled).resolves.toBe(false)
  const accepted = confirmAction('确认删除项目？')
  await flushPromises()
  await wrapper.findAll('button').find(button => button.text() === '确认')!.trigger('click')
  await expect(accepted).resolves.toBe(true)
})
