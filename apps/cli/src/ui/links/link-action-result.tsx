/**
 * Link action result component - single-line output for confirm/reject
 */

import { Text } from 'ink';
import type { FC } from 'react';

interface LinkActionResultProps {
  action: 'confirmed' | 'rejected';
  linkId: string;
  asset: string;
  sourceAmount: string;
  targetAmount: string;
  sourceName: string;
  targetName: string;
  confidence: string;
}

/**
 * Renders a single-line summary for link confirm/reject actions
 *
 * Format: {icon} {action} {id} · {asset} {sourceAmt} → {targetAmt} · {source} → {target} ({confidence})
 */
export const LinkActionResult: FC<LinkActionResultProps> = ({
  action,
  linkId,
  asset,
  sourceAmount,
  targetAmount,
  sourceName,
  targetName,
  confidence,
}) => {
  const shortId = linkId.substring(0, 8);
  const icon = action === 'confirmed' ? '✓' : '✗';
  const iconColor = action === 'confirmed' ? 'green' : 'dim';
  const actionText = action === 'confirmed' ? 'Confirmed' : 'Rejected';

  return (
    <Text>
      <Text color={iconColor}>{icon}</Text> <Text bold>{actionText}</Text> {shortId} <Text dimColor>·</Text> {asset}{' '}
      <Text color="green">{sourceAmount}</Text> <Text dimColor>→</Text> <Text color="green">{targetAmount}</Text>{' '}
      <Text dimColor>·</Text> <Text color="cyan">{sourceName}</Text> <Text dimColor>→</Text>{' '}
      <Text color="cyan">{targetName}</Text> <Text dimColor>({confidence})</Text>
    </Text>
  );
};

interface LinkActionErrorProps {
  linkId: string;
  message: string;
}

/**
 * Renders an error message for link actions
 */
export const LinkActionError: FC<LinkActionErrorProps> = ({ linkId, message }) => {
  const shortId = linkId.substring(0, 8);

  return (
    <Text>
      <Text color="yellow">⚠</Text> {message.replace(linkId, shortId)}
    </Text>
  );
};
