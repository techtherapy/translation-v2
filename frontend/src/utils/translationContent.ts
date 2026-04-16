/**
 * Dual-format content utilities for translations.
 *
 * Every consumer of `translated_text` must handle both formats:
 *   - 'plain' (default, legacy): raw text string
 *   - 'prosemirror': serialized ProseMirror JSON with tracked change marks
 *
 * The exact mark/attribute names come from the spike validation
 * (see components/editor/__tests__/trackChangesSpike.test.ts).
 */

interface TranslationLike {
  content_format?: string | null
  translated_text: string | null
}

/**
 * Check if a translation uses ProseMirror JSON format.
 */
export function isJsonContent(translation: TranslationLike): boolean {
  return translation.content_format === 'prosemirror'
}

/**
 * Parse translation content into its native format.
 * Returns string for plain, parsed JSON object for prosemirror.
 * Returns raw string on parse failure (not empty string).
 */
export function parseTranslationContent(
  translation: TranslationLike
): string | Record<string, unknown> {
  if (!translation.translated_text) return ''
  if (!isJsonContent(translation)) return translation.translated_text

  try {
    return JSON.parse(translation.translated_text)
  } catch {
    return translation.translated_text
  }
}

/**
 * Extract clean plain text from a translation, regardless of content_format.
 *
 * For 'prosemirror' format, walks the JSON tree applying the state matrix:
 *   | Change status | Insert  | Delete  |
 *   |---------------|---------|---------|
 *   | pending       | Include | Skip    |
 *   | accepted      | Include | Skip    |
 *   | rejected      | Skip    | Include |
 *
 * Returns raw string on parse failure (not empty string).
 */
export function extractCleanText(translation: TranslationLike): string {
  if (!translation.translated_text) return ''
  if (!isJsonContent(translation)) return translation.translated_text

  try {
    const doc = JSON.parse(translation.translated_text)
    return extractTextFromDoc(doc)
  } catch {
    return translation.translated_text
  }
}

/**
 * Same as extractCleanText but accepts raw string + format.
 * Used by VersionHistoryPanel for historical snapshots that aren't Translation objects.
 */
export function extractCleanTextFromRaw(text: string, format: string): string {
  if (!text) return ''
  if (format !== 'prosemirror') return text

  try {
    const doc = JSON.parse(text)
    return extractTextFromDoc(doc)
  } catch {
    return text
  }
}
// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface PmNode {
  type: string
  text?: string
  content?: PmNode[]
  attrs?: { dataTracked?: TrackedAttr[] | TrackedAttr | null }
  marks?: PmMark[]
}

interface PmMark {
  type: string
  attrs?: { dataTracked?: TrackedAttr | null }
}

interface TrackedAttr {
  operation?: string
  status?: string
}

function extractTextFromDoc(doc: PmNode): string {
  if (!doc?.content) return ''
  return doc.content.map(extractTextFromBlock).filter(Boolean).join('\n')
}

function extractTextFromBlock(node: PmNode): string {
  if (shouldExcludeNode(node)) return ''

  if (node.type === 'text') {
    if (node.marks?.some(shouldExcludeMark)) return ''
    return node.text ?? ''
  }

  if (node.content) {
    return node.content.map(extractTextFromBlock).join('')
  }

  return ''
}

/**
 * Should this node be excluded from clean text output?
 * Checks node-level dataTracked (block-level changes).
 */
function shouldExcludeNode(node: PmNode): boolean {
  if (!node.attrs?.dataTracked) return false
  const tracked = Array.isArray(node.attrs.dataTracked)
    ? node.attrs.dataTracked
    : [node.attrs.dataTracked]
  return tracked.some(isExcludedChange)
}

/**
 * Should this mark cause its text to be excluded?
 * Checks mark-level dataTracked (inline changes).
 */
function shouldExcludeMark(mark: PmMark): boolean {
  if (!mark.attrs?.dataTracked) return false
  return isExcludedChange(mark.attrs.dataTracked)
}

/**
 * State matrix: should this tracked change be excluded from clean text?
 *   - pending/accepted delete → exclude (text removed or proposed removal)
 *   - rejected insert → exclude (text discarded)
 *   - everything else → include
 */
function isExcludedChange(t: TrackedAttr): boolean {
  return (
    (t.operation === 'delete' && (t.status === 'pending' || t.status === 'accepted')) ||
    (t.operation === 'insert' && t.status === 'rejected')
  )
}
