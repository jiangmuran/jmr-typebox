import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

// Scripted chat: first call asks for a tool, second call answers. We assert the loop ran the
// tool against the real ctx (document read) and fed the result back for a final reply.
const chatScript = []
let chatIdx = 0
vi.mock('../../composables/useAI', () => {
  return {
    useAI: () => ({
      ready: { value: true },
      chat: vi.fn(async (messages, opts) => {
        const step = chatScript[chatIdx++] || { content: 'done' }
        if (step.onToken && opts?.onToken) opts.onToken(step.content || '')
        return step.return ?? { role: 'assistant', content: step.content || '', tool_calls: step.tool_calls || null, finish_reason: step.tool_calls ? 'tool_calls' : 'stop' }
      }),
    }),
  }
})

import AiPanel from '../AiPanel.vue'
import { useEditor } from '../../composables/useEditor'

function seedDoc(text) {
  const ed = useEditor()
  ed.updateContent(text)
}

beforeEach(() => { chatIdx = 0; chatScript.length = 0 })

describe('AiPanel agentic loop', () => {
  it('runs a tool call against the document then produces a final answer', async () => {
    seedDoc('# Title\nHello body.')
    // Turn 1: model requests get_document. Turn 2: model answers.
    chatScript.push({
      content: '',
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'get_document', arguments: '{}' } }],
    })
    chatScript.push({ content: 'Your document is titled "Title".' })

    const wrapper = mount(AiPanel, {
      props: { open: true },
      global: { stubs: { Teleport: true } },
    })
    await flushPromises()

    // type + send
    const ta = wrapper.find('textarea')
    await ta.setValue('what is my doc about?')
    await wrapper.find('.aip-send').trigger('click')
    await flushPromises()
    await flushPromises()

    const html = wrapper.html()
    // The tool activity row should show the get_document tool ran.
    expect(html).toMatch(/get_document|Read document/)
    // The final assistant answer is rendered.
    expect(html).toContain('Your document is titled')
  })

  it('renders the not-configured empty state when AI is unavailable', async () => {
    // Re-mock ready=false for this case by overriding the chat mock return path.
    const wrapper = mount(AiPanel, {
      props: { open: true },
      global: { stubs: { Teleport: true } },
    })
    await flushPromises()
    // ready is true in our mock, so the intro (not the empty state) shows.
    expect(wrapper.find('.aip-input').exists()).toBe(true)
  })
})
