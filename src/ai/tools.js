// Site-level tool registry for the AI agent. Each tool is an OpenAI function definition plus
// a `run(args, ctx)` implementation. Tools operate ONLY through the injected `ctx` (host
// capabilities) so this module stays free of Vue/DOM imports and is fully unit-testable.
//
// ctx contract (provided by AiPanel.vue at runtime):
//   getDocument()                  -> { name, content }
//   replaceDocument(text)          -> void   (overwrite active doc)
//   insertText(text, where?)       -> void   ('cursor' | 'end' | 'start'; default 'end')
//   appendText(text)               -> void
//   newDocument(name?, content?)   -> { name }
//   exportDocument(format)         -> Promise (format: md|txt|html|pdf|docx|png)
//   setTheme(themeId, target?)     -> { ok, id }   (target: 'writing' | 'export')
//   listThemes()                   -> [{ id, name, dark }]
//   getStats()                     -> { chars, words, lines }
//   ai(messages, opts?)            -> Promise<string>  (sub-completion, e.g. summarize)
//
// run() returns a plain JSON-serialisable result that is fed back to the model as the tool
// message. Throwing is fine — dispatch() converts errors into an { error } result.

const EXPORT_FORMATS = ['md', 'txt', 'html', 'pdf', 'docx', 'png']

export const TOOLS = [
  {
    name: 'get_document',
    description:
      "Read the user's currently active document. Returns its filename, full Markdown content, and basic stats. Call this before editing or summarizing so you work from the real text.",
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    run(_args, ctx) {
      const doc = ctx.getDocument()
      const stats = ctx.getStats?.() || {}
      return { name: doc.name, content: doc.content, chars: stats.chars, words: stats.words, lines: stats.lines }
    },
  },
  {
    name: 'replace_document',
    description:
      'Replace the ENTIRE content of the active document with new Markdown. Use this after rewriting/polishing/translating the whole document. This overwrites everything — include the full new text.',
    parameters: {
      type: 'object',
      properties: { content: { type: 'string', description: 'The full new Markdown content for the document.' } },
      required: ['content'],
      additionalProperties: false,
    },
    run(args, ctx) {
      const content = String(args.content ?? '')
      ctx.replaceDocument(content)
      return { ok: true, length: content.length }
    },
  },
  {
    name: 'insert_text',
    description:
      'Insert Markdown text into the active document without replacing existing content. Use for appending a section, inserting at the cursor, or prepending.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The Markdown text to insert.' },
        where: { type: 'string', enum: ['cursor', 'end', 'start'], description: 'Insertion point. Default "end".' },
      },
      required: ['text'],
      additionalProperties: false,
    },
    run(args, ctx) {
      const text = String(args.text ?? '')
      const where = args.where || 'end'
      ctx.insertText(text, where)
      return { ok: true, inserted: text.length, where }
    },
  },
  {
    name: 'new_document',
    description:
      'Create a NEW document tab (does not touch the current one) and optionally fill it with content. Use when the user asks to "write an article about…", draft something fresh, or start over without losing their current doc.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Filename (without extension). Optional.' },
        content: { type: 'string', description: 'Initial Markdown content. Optional.' },
      },
      additionalProperties: false,
    },
    run(args, ctx) {
      const doc = ctx.newDocument(args.name || undefined, args.content || '')
      return { ok: true, name: doc?.name }
    },
  },
  {
    name: 'export_document',
    description:
      'Export/download the active document in a given format. Triggers the same export the user would get from the Export menu.',
    parameters: {
      type: 'object',
      properties: {
        format: { type: 'string', enum: EXPORT_FORMATS, description: 'Output format.' },
      },
      required: ['format'],
      additionalProperties: false,
    },
    async run(args, ctx) {
      const format = String(args.format || '').toLowerCase()
      if (!EXPORT_FORMATS.includes(format)) {
        return { error: `Unsupported format "${format}". Supported: ${EXPORT_FORMATS.join(', ')}.` }
      }
      await ctx.exportDocument(format)
      return { ok: true, format }
    },
  },
  {
    name: 'set_theme',
    description:
      'Change the editor writing theme or the export theme. Call list_themes first if unsure of valid ids.',
    parameters: {
      type: 'object',
      properties: {
        theme: { type: 'string', description: 'Theme id (e.g. "nocturne", "inkwell", "ivory-flow", or "default").' },
        target: { type: 'string', enum: ['writing', 'export'], description: 'Which theme to set. Default "writing".' },
      },
      required: ['theme'],
      additionalProperties: false,
    },
    run(args, ctx) {
      const target = args.target === 'export' ? 'export' : 'writing'
      const res = ctx.setTheme(String(args.theme || ''), target)
      if (!res?.ok) {
        const ids = (ctx.listThemes?.() || []).map(t => t.id)
        return { error: `Unknown theme "${args.theme}". Valid ids: ${['default', ...ids].join(', ')}.` }
      }
      return { ok: true, theme: res.id, target }
    },
  },
  {
    name: 'list_themes',
    description: 'List the available editor/export theme ids and names.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    run(_args, ctx) {
      const themes = ctx.listThemes?.() || []
      return { themes: [{ id: 'default', name: 'Default' }, ...themes.map(t => ({ id: t.id, name: t.name, dark: t.dark }))] }
    },
  },
  {
    name: 'summarize_document',
    description:
      'Summarize the active document into a short TL;DR or bullet list. Returns the summary text (does not modify the document). Use insert_text or replace_document afterwards if the user wants it written in.',
    parameters: {
      type: 'object',
      properties: {
        style: { type: 'string', enum: ['tldr', 'bullets', 'abstract'], description: 'Summary style. Default "bullets".' },
      },
      additionalProperties: false,
    },
    async run(args, ctx) {
      const doc = ctx.getDocument()
      if (!doc.content.trim()) return { error: 'The document is empty.' }
      const style = args.style || 'bullets'
      const styleHint = style === 'tldr'
        ? 'a single concise TL;DR sentence'
        : style === 'abstract'
          ? 'a one-paragraph abstract'
          : 'a tight bullet-point list of the key points'
      const summary = await ctx.ai(
        [
          { role: 'system', content: 'You are a precise summarizer. Reply with only the summary, no preamble.' },
          { role: 'user', content: `Summarize the following document as ${styleHint}:\n\n${doc.content}` },
        ],
        { temperature: 0.3 }
      )
      return { summary }
    },
  },
]

// Map by name for O(1) dispatch.
export const TOOL_MAP = Object.fromEntries(TOOLS.map(t => [t.name, t]))

// OpenAI tools array (function-calling schema) for the request body.
export function toolSpecs(names) {
  const list = names ? TOOLS.filter(t => names.includes(t.name)) : TOOLS
  return list.map(t => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }))
}

// Execute one tool call against ctx. Never throws — failures come back as { error }.
// `args` is the already-parsed arguments object.
export async function dispatchTool(name, args, ctx) {
  const tool = TOOL_MAP[name]
  if (!tool) return { error: `Unknown tool: ${name}` }
  try {
    const result = await tool.run(args || {}, ctx)
    return result == null ? { ok: true } : result
  } catch (e) {
    return { error: String((e && e.message) || e) }
  }
}
