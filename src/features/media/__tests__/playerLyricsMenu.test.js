// Regression: opening the lyric context menu used to crash the whole panel render —
// the template computed `Math.min(x, window.innerWidth - 220)` inline, and `window` does not
// exist in a Vue template scope (it compiles to ctx.window → undefined → TypeError).
// The menu position is now clamped in script; this mounts the real component and right-clicks a line.
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import PlayerLyrics from '../PlayerLyrics.vue'
import { usePlayerStore } from '../usePlayerStore'

describe('PlayerLyrics context menu', () => {
  it('opens on right-click without a render error and closes via the scrim', async () => {
    const store = usePlayerStore()
    store.liveLyrics.value = {
      original: '[00:01.00]first line\n[00:05.00]second line\n[00:09.00]third line',
      translation: '', romaji: '', yrc: '',
    }
    const wrapper = mount(PlayerLyrics, {
      global: { stubs: { 'router-link': true }, mocks: { $router: { push: () => {} } } },
    })
    await wrapper.vm.$nextTick()
    const lines = wrapper.findAll('.ll-line')
    expect(lines.length).toBe(3)

    await lines[1].trigger('contextmenu', { clientX: 5000, clientY: 5000 })
    const menu = wrapper.find('.ll-menu')
    expect(menu.exists()).toBe(true)
    // Clamped into the viewport, not parked at the raw (5000, 5000).
    const style = menu.attributes('style') || ''
    const left = parseInt(style.match(/left:\s*(-?\d+)px/)?.[1] ?? 'NaN', 10)
    expect(Number.isFinite(left)).toBe(true)
    expect(left).toBeLessThan(5000)

    await wrapper.find('.ll-menu-scrim').trigger('click')
    expect(wrapper.find('.ll-menu').exists()).toBe(false)
  })
})
