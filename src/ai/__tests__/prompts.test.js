import { describe, it, expect } from 'vitest'
import {
  SELECTION_ACTIONS,
  buildSelectionMessages,
  DOC_ACTIONS,
  buildDocMessages,
  buildGenerateMessages,
  agentSystemPrompt,
} from '../prompts'

describe('buildSelectionMessages', () => {
  it('wraps the selection in a system+user pair and marks it as replacing', () => {
    const { replaces, messages } = buildSelectionMessages('improve', 'hello world')
    expect(replaces).toBe(true)
    expect(messages[0].role).toBe('system')
    expect(messages[1].role).toBe('user')
    expect(messages[1].content).toContain('hello world')
  })

  it('injects free-form input for translate', () => {
    const { messages } = buildSelectionMessages('translate', 'cat', 'French')
    expect(messages[1].content).toContain('French')
    expect(messages[1].content).toContain('cat')
  })

  it('injects the instruction for rewrite', () => {
    const { messages } = buildSelectionMessages('rewrite', 'text', 'make it formal')
    expect(messages[1].content).toContain('make it formal')
  })

  it('marks explain as non-replacing with a chat-style system prompt', () => {
    const { replaces, messages } = buildSelectionMessages('explain', 'some code')
    expect(replaces).toBe(false)
    expect(messages[0].content).not.toContain('reply with ONLY the resulting Markdown')
  })

  it('throws on an unknown action', () => {
    expect(() => buildSelectionMessages('nope', 'x')).toThrow()
  })

  it('every selection action builds a non-empty prompt', () => {
    for (const id of Object.keys(SELECTION_ACTIONS)) {
      const { messages } = buildSelectionMessages(id, 'sample', 'English')
      expect(messages[1].content.length).toBeGreaterThan(0)
    }
  })
})

describe('buildDocMessages', () => {
  it('polishDoc replaces; summarize/outline/title do not', () => {
    expect(buildDocMessages('polishDoc', 'doc').replaces).toBe(true)
    expect(buildDocMessages('summarize', 'doc').replaces).toBe(false)
    expect(buildDocMessages('outline', 'doc').replaces).toBe(false)
    expect(buildDocMessages('title', 'doc').replaces).toBe(false)
  })
  it('includes the document text', () => {
    const { messages } = buildDocMessages('summarize', 'THE DOCUMENT')
    expect(messages[1].content).toContain('THE DOCUMENT')
  })
  it('exposes all DOC_ACTIONS', () => {
    for (const id of Object.keys(DOC_ACTIONS)) {
      expect(buildDocMessages(id, 'x').messages).toHaveLength(2)
    }
  })
})

describe('buildGenerateMessages', () => {
  it('builds an article prompt by default', () => {
    const msgs = buildGenerateMessages('space travel')
    expect(msgs[1].content).toContain('space travel')
    expect(msgs[1].content).toMatch(/article/)
  })
  it('can target an outline', () => {
    const msgs = buildGenerateMessages('topic', { format: 'outline' })
    expect(msgs[1].content).toMatch(/outline/)
  })
})

describe('agentSystemPrompt', () => {
  it('mentions the active document name and selection state', () => {
    const p = agentSystemPrompt({ docName: 'README', hasSelection: true })
    expect(p).toContain('README')
    expect(p).toMatch(/selected/)
  })
  it('works with no context', () => {
    expect(typeof agentSystemPrompt()).toBe('string')
  })
})
