/**
 * Streaming markdown pipeline for the TUI.
 *
 * Three stages, so future markdown rules extend the middle one instead of
 * accreting branches in a single function:
 *
 *   1. createLineSplitter   — text_delta chunks in, raw lines out
 *                             (deltas split anywhere, lines are buffered).
 *   2. createBlockParser    — raw lines in, block EVENTS out:
 *                               { type: 'fence-open' }
 *                               { type: 'fence-close', unterminated? }
 *                               { type: 'line', fence?, segments }
 *                             Owns fence state (well-formed openers, glued
 *                             close tags, unterminated fences at flush).
 *   3. parseLineSegments / parseInlineSegments — one line → styled segments
 *                             (heading bold, **bold**, `code`).
 *
 * Public API (unchanged): createMarkdownStream({ onLine }) emits per-line
 * events shaped { kind: 'fence-open' | 'fence-close' | 'line', ... }. The
 * caller owns all colors and output; this module never styles or prints.
 */

// ---------------------------------------------------------------------------
// Stage 1: delta buffering → raw lines
// ---------------------------------------------------------------------------

/**
 * Buffers text_delta chunks into complete lines. onLine(text) fires
 * synchronously per complete line; flush() emits any pending partial line.
 */
export function createLineSplitter({ onLine }) {
  let lineBuffer = ''
  return {
    delta(text) {
      lineBuffer += text
      let newlineIndex = lineBuffer.indexOf('\n')
      while (newlineIndex !== -1) {
        const line = lineBuffer.slice(0, newlineIndex)
        lineBuffer = lineBuffer.slice(newlineIndex + 1)
        onLine(line)
        newlineIndex = lineBuffer.indexOf('\n')
      }
    },
    flush() {
      if (lineBuffer !== '') {
        const rest = lineBuffer
        lineBuffer = ''
        onLine(rest)
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Stage 2: raw lines → block events
// ---------------------------------------------------------------------------

// Fence opening requires the line to end after the (optional) language tag:
// "```", "```js". A line like "```txthi world" (model sloppiness — content
// glued to the info string) is NOT a fence; it renders as plain text so the
// glued content is never silently swallowed.
const FENCE_PATTERN = /^\s*(```|~~~)\s*[\w+#.-]*\s*$/
const FENCE_CLOSE_PATTERN = /^\s*(```|~~~)\s*$/

/**
 * Consumes raw lines and emits block events (see module header). flush()
 * closes an unterminated fence so the next message starts in text mode.
 */
export function createBlockParser({ onEvent }) {
  let inFence = false
  // After a malformed fence line ("```txt content"), the next bare ``` is the
  // model's intended close tag — render it literally instead of opening a
  // fence that would swallow the following text.
  let gluedFenceSeen = false

  const handleLine = line => {
    if (!inFence) {
      const startsFence = /^\s*(```|~~~)/.test(line)
      const wellFormedOpener = FENCE_PATTERN.test(line)
      if (wellFormedOpener && !gluedFenceSeen) {
        inFence = true
        gluedFenceSeen = false
        onEvent({ type: 'fence-open' })
        return
      }
      if (startsFence) {
        // Malformed fence line (e.g. "```txthi world" — content glued to the
        // info string, observed in real model output) or its matching bare
        // close tag: render verbatim, nothing swallowed.
        gluedFenceSeen = !wellFormedOpener ? true : gluedFenceSeen
        onEvent({ type: 'line', segments: [{ text: line, style: null }] })
        return
      }
      gluedFenceSeen = false
      onEvent({ type: 'line', segments: parseLineSegments(line) })
      return
    }
    if (FENCE_CLOSE_PATTERN.test(line)) {
      inFence = false
      gluedFenceSeen = false
      onEvent({ type: 'fence-close' })
      return
    }
    onEvent({ type: 'line', fence: true, segments: [{ text: line, style: 'code' }] })
  }

  return {
    line: handleLine,
    flush() {
      if (inFence) {
        inFence = false
        onEvent({ type: 'fence-close', unterminated: true })
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Stage 3: inline segment styling
// ---------------------------------------------------------------------------

/** Parses one non-fence line into styled segments. */
export function parseLineSegments(line) {
  // Headings: bold the whole line.
  if (/^#{1,6}\s+/.test(line)) {
    return [{ text: line, style: 'bold' }]
  }
  return parseInlineSegments(line)
}

/** Splits a text fragment into bold / code / plain segments. */
export function parseInlineSegments(text) {
  const segments = []
  // Inline code spans win over bold inside them.
  const codeParts = text.split(/(`[^`]*`)/g)
  for (const part of codeParts) {
    if (part.length >= 2 && part.startsWith('`') && part.endsWith('`')) {
      segments.push({ text: part, style: 'code' })
      continue
    }
    // **bold** spans within the plain part.
    const boldParts = part.split(/(\*\*[^*]+\*\*)/g)
    for (const boldPart of boldParts) {
      if (boldPart.length >= 4 && boldPart.startsWith('**') && boldPart.endsWith('**')) {
        segments.push({ text: boldPart.slice(2, -2), style: 'bold' })
      } else if (boldPart !== '') {
        segments.push({ text: boldPart, style: null })
      }
    }
  }
  return segments.length > 0 ? segments : [{ text: '', style: null }]
}

// ---------------------------------------------------------------------------
// Public entry: composes the pipeline, emits the legacy { kind } event shape
// ---------------------------------------------------------------------------

/**
 * Creates a streaming markdown processor.
 * onLine(event) is called synchronously per complete line, with one of:
 *   { kind: 'fence-open' } | { kind: 'fence-close', unterminated? }
 *   { kind: 'line', fence?, segments }
 */
export function createMarkdownStream({ onLine }) {
  const parser = createBlockParser({
    onEvent: event => {
      if (event.type === 'fence-open') {
        onLine({ kind: 'fence-open' })
      } else if (event.type === 'fence-close') {
        onLine({ kind: 'fence-close', ...(event.unterminated ? { unterminated: true } : {}) })
      } else {
        onLine({ kind: 'line', ...(event.fence ? { fence: true } : {}), segments: event.segments })
      }
    },
  })
  const splitter = createLineSplitter({ onLine: parser.line })
  return {
    delta: splitter.delta,
    flush() {
      splitter.flush()
      parser.flush()
    },
  }
}
