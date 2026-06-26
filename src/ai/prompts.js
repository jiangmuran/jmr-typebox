// Prompt builders for the editor's one-shot AI actions (selection + whole-document).
// Pure functions returning OpenAI message arrays, so they can be unit-tested and reused.

const WRITER_SYSTEM =
  'You are a writing assistant embedded in a Markdown editor. Edit the text the user gives you ' +
  'and reply with ONLY the resulting Markdown — no explanations, no preamble, no surrounding code fences. ' +
  'Preserve the original Markdown formatting and language unless the instruction says otherwise.'

// Selection-action definitions. Each builds a user instruction around the selected text.
// `needsInput` actions also take a free-form `input` (e.g. rewrite instruction, target language).
export const SELECTION_ACTIONS = {
  improve: {
    id: 'improve',
    build: (text) => `Improve the writing quality of the following text. Make it clearer, smoother and more engaging while keeping the meaning and roughly the same length:\n\n${text}`,
  },
  polish: {
    id: 'polish',
    build: (text) => `Polish and proofread the following text: fix awkward phrasing, improve flow, keep the tone:\n\n${text}`,
  },
  grammar: {
    id: 'grammar',
    build: (text) => `Fix only the spelling, grammar and punctuation in the following text. Do not rephrase or change the style. Return the corrected text:\n\n${text}`,
  },
  shorter: {
    id: 'shorter',
    build: (text) => `Make the following text more concise — cut redundancy, keep the key points and the same language:\n\n${text}`,
  },
  longer: {
    id: 'longer',
    build: (text) => `Expand the following text with more detail, examples and explanation, keeping the same voice and language:\n\n${text}`,
  },
  translate: {
    id: 'translate',
    needsInput: true,
    build: (text, input) => `Translate the following text into ${input || 'English'}. Return only the translation:\n\n${text}`,
  },
  rewrite: {
    id: 'rewrite',
    needsInput: true,
    build: (text, input) => `Rewrite the following text according to this instruction: "${input}".\n\nText:\n${text}`,
  },
  explain: {
    id: 'explain',
    // Explain produces commentary, not a replacement — handled as a chat-style answer.
    replaces: false,
    build: (text) => `Explain the following text clearly and concisely. If it is code, explain what it does:\n\n${text}`,
  },
}

export function buildSelectionMessages(actionId, text, input) {
  const action = SELECTION_ACTIONS[actionId]
  if (!action) throw new Error(`Unknown selection action: ${actionId}`)
  const system = action.replaces === false
    ? 'You are a helpful assistant embedded in a Markdown editor. Answer concisely in Markdown.'
    : WRITER_SYSTEM
  return {
    replaces: action.replaces !== false,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: action.build(text, input) },
    ],
  }
}

// Whole-document actions.
export const DOC_ACTIONS = {
  polishDoc: {
    id: 'polishDoc',
    replaces: true,
    build: (doc) => ({
      system: WRITER_SYSTEM,
      user: `Polish and improve this entire Markdown document. Fix grammar, tighten phrasing, and improve flow while preserving structure, headings and meaning. Return the full improved document:\n\n${doc}`,
    }),
  },
  summarize: {
    id: 'summarize',
    replaces: false,
    build: (doc) => ({
      system: 'You are a precise summarizer. Reply in Markdown with only the summary.',
      user: `Summarize this document as a short list of key points followed by a one-line takeaway:\n\n${doc}`,
    }),
  },
  outline: {
    id: 'outline',
    replaces: false,
    build: (doc) => ({
      system: 'You produce clean Markdown outlines. Reply with only the outline (nested bullet list).',
      user: `Produce a structured outline of this document:\n\n${doc}`,
    }),
  },
  title: {
    id: 'title',
    replaces: false,
    build: (doc) => ({
      system: 'You write concise, compelling titles. Reply with 5 candidate titles as a Markdown list, nothing else.',
      user: `Suggest titles for this document:\n\n${doc}`,
    }),
  },
}

export function buildDocMessages(actionId, doc) {
  const action = DOC_ACTIONS[actionId]
  if (!action) throw new Error(`Unknown document action: ${actionId}`)
  const { system, user } = action.build(doc)
  return {
    replaces: action.replaces,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  }
}

// "Write an article about…" generation (whole-doc, streamed into a new/empty doc).
export function buildGenerateMessages(topic, { format = 'article' } = {}) {
  const kind = format === 'outline' ? 'a detailed Markdown outline' : 'a well-structured Markdown article'
  return [
    {
      role: 'system',
      content:
        'You are an expert writer. Produce clean, well-structured Markdown with headings, short paragraphs and lists where helpful. Reply with only the document content — no surrounding code fences.',
    },
    { role: 'user', content: `Write ${kind} about: ${topic}` },
  ]
}

// System prompt for the agent chat panel (tool-calling loop).
export function agentSystemPrompt({ docName, hasSelection } = {}) {
  return (
    'You are TypeBox AI, an assistant built into the TypeBox Markdown editor. ' +
    'You can read and edit the user\'s document and control the editor through tools. ' +
    'Guidelines:\n' +
    '- When the user asks about or to change "the document", call get_document first to see the real content.\n' +
    '- To rewrite/translate/polish the whole document, get_document, then replace_document with the full new text.\n' +
    '- To add content, prefer insert_text; to start something fresh use new_document.\n' +
    '- Only call export/set_theme when explicitly asked.\n' +
    '- Keep chat replies short; do the work with tools rather than pasting long text into chat.\n' +
    (docName ? `The active document is "${docName}".` : '') +
    (hasSelection ? ' The user currently has text selected.' : '')
  )
}
