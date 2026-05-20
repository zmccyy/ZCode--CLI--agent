import { basename } from 'path'
import React from 'react'
import { getOriginalCwd } from '../../bootstrap/state.js'
import { getProductName } from '../../config/brandText.js'
import { Box, Text } from '../../ink.js'

const WELCOME_V2_WIDTH = 58
const DIVIDER = '-'.repeat(WELCOME_V2_WIDTH)

export function WelcomeV2(): React.ReactNode {
  const cwdName = basename(getOriginalCwd()) || '.'
  const productName = getProductName()

  return (
    <Box width={WELCOME_V2_WIDTH} flexDirection="column">
      <Text>
        <Text bold color="claude">
          {productName}
        </Text>
        <Text dimColor> · v{MACRO.VERSION}</Text>
      </Text>
      <Text dimColor>{DIVIDER}</Text>
      <Text>cwd: {cwdName} · mode: interactive</Text>
      <Text dimColor>ask, edit, run, inspect</Text>
    </Box>
  )
}
