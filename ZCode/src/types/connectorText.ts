import type { BetaContentBlock } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'

export type ConnectorTextBlock = {
  type: 'connector_text'
  id: string
  connector_text: string
  connector_id?: string
  connector_name?: string
}

export type ConnectorTextDelta = {
  type: 'connector_text_delta'
  id: string
  connector_text: string
}

export function isConnectorTextBlock(
  block: BetaContentBlock | ConnectorTextBlock,
): block is ConnectorTextBlock {
  return block.type === 'connector_text'
}
