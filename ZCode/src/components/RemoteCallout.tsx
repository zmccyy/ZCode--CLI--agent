import React, { useCallback, useEffect, useRef } from 'react'
import { isBridgeEnabled } from '../bridge/bridgeEnabled.js'
import { Box, Text } from '../ink.js'
import { getClaudeAIOAuthTokens } from '../utils/auth.js'
import { getGlobalConfig, saveGlobalConfig } from '../utils/config.js'
import type { OptionWithDescription } from './CustomSelect/select.js'
import { Select } from './CustomSelect/select.js'
import { PermissionDialog } from './permissions/PermissionDialog.js'

type RemoteCalloutSelection = 'enable' | 'dismiss'

type Props = {
  onDone: (selection: RemoteCalloutSelection) => void
}

export function RemoteCallout({ onDone }: Props): React.ReactNode {
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  const handleCancel = useCallback((): void => {
    onDoneRef.current('dismiss')
  }, [])

  useEffect(() => {
    saveGlobalConfig(current => {
      if (current.remoteDialogSeen) return current
      return {
        ...current,
        remoteDialogSeen: true,
      }
    })
  }, [])

  const handleSelect = useCallback((value: RemoteCalloutSelection): void => {
    onDoneRef.current(value)
  }, [])

  const options: OptionWithDescription<RemoteCalloutSelection>[] = [
    {
      label: 'Open this session elsewhere',
      description: 'Creates a secure web link for this terminal session.',
      value: 'enable',
    },
    {
      label: 'Never mind',
      description: 'You can always enable it later with /remote-control.',
      value: 'dismiss',
    },
  ]

  return (
    <PermissionDialog title="Remote Control">
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Box marginBottom={1} flexDirection="column">
          <Text>
            Remote Control creates a secure web link for this terminal session
            so you can resume it from another device.
          </Text>
          <Text> </Text>
          <Text>
            You can disconnect remote access anytime by running /remote-control
            again.
          </Text>
        </Box>
        <Box>
          <Select
            options={options}
            onChange={handleSelect}
            onCancel={handleCancel}
          />
        </Box>
      </Box>
    </PermissionDialog>
  )
}

export function shouldShowRemoteCallout(): boolean {
  const config = getGlobalConfig()
  if (config.remoteDialogSeen) return false
  if (!isBridgeEnabled()) return false
  const tokens = getClaudeAIOAuthTokens()
  if (!tokens?.accessToken) return false
  return true
}
