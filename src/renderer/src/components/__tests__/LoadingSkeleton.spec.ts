// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import LoadingSkeleton from '../LoadingSkeleton.vue'

describe('LoadingSkeleton', () => {
  it('renders the correct number of rows (default 3)', () => {
    const wrapper = mount(LoadingSkeleton)
    // Each row is a flex container holding the skeleton blocks.
    const rows = wrapper.findAll('[class*="flex gap-3"]')
    expect(rows).toHaveLength(3)
  })

  it('renders the correct number of columns per row', () => {
    const wrapper = mount(LoadingSkeleton, { props: { rows: 2, columns: 4 } })
    // Total skeleton blocks = rows * columns.
    const blocks = wrapper.findAll('[data-testid="skeleton-block"]')
    expect(blocks).toHaveLength(8)
    // Each of the 2 rows should contain 4 blocks.
    const rows = wrapper.findAll('[class*="flex gap-3"]')
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row.findAll('[data-testid="skeleton-block"]')).toHaveLength(4)
    }
  })
})