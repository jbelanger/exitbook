/**
 * Link action result component - single-line output for confirm/reject
 */

import { Text } from 'ink';
import type { FC } from 'react';

interface LinkActionResultProps {
  action: 'confirmed' | 'rejected';
  affectedLinkCount?: number | undefined;
  proposalRef: string;
  asset: string;
  sourceAmount: string;
  targetAmount: string;
  platformKey: string;
  targetName: string;
  confidence: string;
}

/**
 * Renders a single-line summary for link confirm/reject actions
 *
 * Format: {icon} {action} {ref} · {asset} {sourceAmt} → {targetAmt} · {source} → {target} ({confidence})
 */
export const LinkActionResult: FC<LinkActionResultProps> = ({
  action,
  affectedLinkCount,
  proposalRef,
  asset,
  sourceAmount,
  targetAmount,
  platformKey,
  targetName,
  confidence,
}) => {
  const icon = action === 'confirmed' ? '✓' : '✗';
  const iconColor = action === 'confirmed' ? 'green' : 'dim';
  const actionText = action === 'confirmed' ? 'Confirmed' : 'Rejected';

  return (
    <Text>
      <Text color={iconColor}>{icon}</Text> <Text bold>{actionText}</Text> {proposalRef} <Text dimColor>·</Text> {asset}{' '}
      <Text color="green">{sourceAmount}</Text> <Text dimColor>→</Text> <Text color="green">{targetAmount}</Text>{' '}
      <Text dimColor>·</Text> <Text color="cyan">{platformKey}</Text> <Text dimColor>→</Text>{' '}
      <Text color="cyan">{targetName}</Text> <Text dimColor>({confidence})</Text>
      {affectedLinkCount !== undefined && affectedLinkCount > 1 && <Text dimColor> · {affectedLinkCount} legs</Text>}
    </Text>
  );
};

interface LinkActionErrorProps {
  message: string;
}

/**
 * Renders an error message for link actions
 */
export const LinkActionError: FC<LinkActionErrorProps> = ({ message }) => {
  return (
    <Text>
      <Text color="yellow">⚠</Text> {message}
    </Text>
  );
};
