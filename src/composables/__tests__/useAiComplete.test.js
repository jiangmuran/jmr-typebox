import { describe, it, expect } from 'vitest'
import {
  shouldSuggestAt,
  buildCompletionMessages,
  sanitizeCompletion,
  acceptInto,
  MAX_CONTEXT_BEFORE,
  MAX_CONTEXT_AFTER,
} from '../useAiComplete'

describe('shouldSuggestAt', () => {
  it('suggests when the caret is at the end of the text with enough context', () => {
    expect(shouldSuggestAt('Hello world', 11, 11)).toBe(true)
  })

  it('suggests at the end of a line even if more lines follow', () => {
    const v = 'first line\nsecond'
    // caret right after "first line" (before the newline) → end of that line
    expect(shouldSuggestAt(v, 10, 10)).toBe(true)
  })

  it('does NOT suggest in the middle of a line', () => {
    // caret after "Hel" with "lo" still on the line
    expect(shouldSuggestAt('Hello', 3, 3)).toBe(false)
  })

  it('does NOT suggest when a range is selected', () => {
    expect(shouldSuggestAt('Hello world', 0, 5)).toBe(false)
  })

  it('does NOT suggest without enough preceding context', () => {
    expect(shouldSuggestAt('a', 1, 1)).toBe(false)
    expect(shouldSuggestAt('   ', 3, 3)).toBe(false)
    expect(shouldSuggestAt('', 0, 0)).toBe(false)
  })

  it('guards against out-of-range / non-string input', () => {
    expect(shouldSuggestAt('hello', -1, -1)).toBe(false)
    expect(shouldSuggestAt('hello', 99, 99)).toBe(false)
    expect(shouldSuggestAt(null, 0, 0)).toBe(false)
  })
})

describe('buildCompletionMessages', () => {
  it('produces a system + user message with the before-context embedded', () => {
    const msgs = buildCompletionMessages('The quick brown', '')
    expect(msgs).toHaveLength(2)
    expect(msgs[0].role).toBe('system')
    expect(msgs[1].role).toBe('user')
    expect(msgs[1].content).toContain('The quick brown')
    expect(msgs[1].content).not.toMatch(/after the cursor/i)
  })

  it('includes the after-context only when present', () => {
    const msgs = buildCompletionMessages('before', 'after text')
    expect(msgs[1].content).toMatch(/after the cursor/i)
    expect(msgs[1].content).toContain('after text')
  })

  it('caps the before/after context to the configured limits', () => {
    // Use digits as sentinels — the prompt template contains none, so counts are exact.
    const longBefore = '1'.repeat(MAX_CONTEXT_BEFORE + 500)
    const longAfter = '2'.repeat(MAX_CONTEXT_AFTER + 500)
    const msgs = buildCompletionMessages(longBefore, longAfter)
    const ones = (msgs[1].content.match(/1/g) || []).length
    const twos = (msgs[1].content.match(/2/g) || []).length
    expect(ones).toBe(MAX_CONTEXT_BEFORE)
    expect(twos).toBe(MAX_CONTEXT_AFTER)
  })
})

describe('sanitizeCompletion', () => {
  it('returns empty for empty/nullish', () => {
    expect(sanitizeCompletion('')).toBe('')
    expect(sanitizeCompletion(null)).toBe('')
  })

  it('strips wrapping code fences', () => {
    expect(sanitizeCompletion('```\n continues here \n```')).toBe(' continues here')
  })

  it('strips a single pair of wrapping quotes', () => {
    expect(sanitizeCompletion('"and then"')).toBe('and then')
  })

  it('strips an echoed whole-tail prefix it should not repeat', () => {
    // before ends with "The quick brown ", model echoed the whole thing back then continued.
    const out = sanitizeCompletion('The quick brown fox jumps', 'The quick brown ')
    expect(out).toBe('fox jumps')
  })

  it('strips an echoed partial word (model restarted the current word)', () => {
    // before ends mid-word "brow"; model restarted with "brown ..."
    const out = sanitizeCompletion('brown fox', 'The quick brow')
    expect(out).toBe('n fox')
  })

  it('caps a runaway completion in length and line count', () => {
    const long = Array.from({ length: 10 }, (_, i) => `line ${i}`).join('\n')
    const out = sanitizeCompletion(long)
    expect(out.split('\n').length).toBeLessThanOrEqual(4)
    expect(out.length).toBeLessThanOrEqual(240)
  })

  it('preserves meaningful internal text and trims trailing whitespace', () => {
    expect(sanitizeCompletion(' and more.   ')).toBe(' and more.')
  })
})

describe('acceptInto', () => {
  it('inserts the suggestion at pos and reports the caret at its end', () => {
    const r = acceptInto('Hello', 5, ' world')
    expect(r.value).toBe('Hello world')
    expect(r.caret).toBe(11)
  })

  it('clamps an out-of-range position', () => {
    const r = acceptInto('Hi', 99, '!')
    expect(r.value).toBe('Hi!')
    expect(r.caret).toBe(3)
  })

  it('handles nullish inputs without throwing', () => {
    const r = acceptInto(null, 0, null)
    expect(r.value).toBe('')
    expect(r.caret).toBe(0)
  })
})
