import React, { useMemo } from 'react'
import type { CliHighlight } from '../utils/cliHighlight.js'
import { Ansi, Box, Text, useTheme } from '../ink.js'

type Props = {
  code: string
  language?: string
  highlight: CliHighlight | null
  /** Total messages columns for width-constrained rendering */
  columns?: number
}

/**
 * Renders a standalone code block with syntax highlighting, language label,
 * and line count. Designed as a React component (rather than an ANSI string)
 * so future interactions like "Apply to file" can be added as child elements.
 */
export function CodeBlock({ code, language, highlight }: Props) {
  const [theme] = useTheme()

  const highlighted = useMemo(() => {
    if (!highlight) return code
    const lang = language && highlight.supportsLanguage(language)
      ? language
      : 'plaintext'
    return highlight.highlight(code, { language: lang })
  }, [code, language, highlight])

  const lineCount = useMemo(() => {
    // count newlines + 1 for the last line (or 1 if empty)
    let count = 1
    for (let i = 0; i < code.length; i++) {
      if (code[i] === '\n') count++
    }
    return count
  }, [code])

  const langLabel = language || 'text'
  const linesLabel = `${lineCount} line${lineCount !== 1 ? 's' : ''}`

  return (
    <Box flexDirection="column" marginY={1}>
      <Box flexDirection="row" gap={2}>
        <Text color={theme.claude} bold>
          {langLabel}
        </Text>
        <Text color={theme.inactive}>
          {linesLabel}
        </Text>
      </Box>
      <Box marginTop={0}>
        <Text>
          <Ansi>{highlighted.trim()}</Ansi>
        </Text>
      </Box>
    </Box>
  )
}
