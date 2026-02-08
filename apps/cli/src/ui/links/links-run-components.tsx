/**
 * Links run operation tree components
 */

import { performance } from 'node:perf_hooks';

import { Box, Text } from 'ink';
import { type FC, useEffect, useLayoutEffect, useReducer } from 'react';

import type { LinkingEvent } from '../../features/links/events.js';
import { type EventRelay, formatDuration, statusIcon, TreeChars } from '../shared/index.js';

import type { LifecycleBridge, LinksRunState, LoadPhase, MatchPhase, SavePhase } from './links-run-state.js';
import { createLinksRunState } from './links-run-state.js';
import { linksRunReducer } from './links-run-updater.js';

const REFRESH_INTERVAL_MS = 250;

// --- Hook ---

function useLinksRunState(relay: EventRelay<LinkingEvent>, lifecycle: LifecycleBridge, dryRun: boolean): LinksRunState {
  const [state, dispatch] = useReducer(linksRunReducer, dryRun, createLinksRunState);

  // Connect to the event relay (replays any buffered events, then forwards new ones).
  // Also register lifecycle callbacks for synchronous abort/fail/complete dispatch.
  useLayoutEffect(() => {
    lifecycle.onAbort = () => dispatch({ type: 'abort' });
    lifecycle.onFail = (errorMessage: string) => dispatch({ type: 'fail', errorMessage });
    lifecycle.onComplete = () => dispatch({ type: 'complete' });

    const disconnect = relay.connect((event: LinkingEvent) => {
      dispatch({ type: 'event', event });
    });

    return () => {
      lifecycle.onAbort = undefined;
      lifecycle.onFail = undefined;
      lifecycle.onComplete = undefined;
      disconnect();
    };
  }, [relay, lifecycle]);

  // Periodic refresh for active phase timers
  useEffect(() => {
    const timer = setInterval(() => {
      dispatch({ type: 'tick' });
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  return state;
}

// --- Components ---

interface LinksRunMonitorProps {
  dryRun: boolean;
  lifecycle: LifecycleBridge;
  relay: EventRelay<LinkingEvent>;
}

/**
 * Main links run monitor component
 */
export const LinksRunMonitor: FC<LinksRunMonitorProps> = ({ relay, lifecycle, dryRun }) => {
  const state = useLinksRunState(relay, lifecycle, dryRun);
  return (
    <Box flexDirection="column">
      {/* Blank line before first operation */}
      <Text> </Text>

      {/* Phase 1: Load transactions */}
      {state.load && <LoadSection load={state.load} />}

      {/* Phase 2: Clear existing (conditional) */}
      {state.existingCleared !== undefined && state.existingCleared > 0 && !state.dryRun && (
        <Text>
          <Text color="green">✓</Text> {state.existingCleared} existing links cleared
        </Text>
      )}

      {/* Phase 3: Matching */}
      {state.match && (
        <MatchSection
          match={state.match}
          dryRun={state.dryRun}
        />
      )}

      {/* Phase 4: Save */}
      {state.save && <SaveSection save={state.save} />}

      {/* Completion */}
      {state.isComplete && <CompletionSection state={state} />}
    </Box>
  );
};

/**
 * Load transactions section
 */
const LoadSection: FC<{ load: LoadPhase }> = ({ load }) => {
  const elapsed = load.completedAt ? load.completedAt - load.startedAt : performance.now() - load.startedAt;
  const duration = formatDuration(elapsed);

  if (load.status === 'active') {
    return (
      <Text>
        {statusIcon('active')} <Text bold>Loading transactions</Text> <Text dimColor>· {duration}</Text>
      </Text>
    );
  }

  if (load.status === 'completed') {
    // No transactions case
    if (load.totalTransactions === 0) {
      return (
        <Text>
          <Text color="green">✓</Text> Loaded 0 transactions <Text dimColor>({duration})</Text>
        </Text>
      );
    }

    // Normal case with sub-lines
    return (
      <Box flexDirection="column">
        <Text>
          <Text color="green">✓</Text> Loaded <Text color="green">{load.totalTransactions.toLocaleString()}</Text>{' '}
          transactions <Text dimColor>({duration})</Text>
        </Text>
        <Text>
          {'  '}
          <Text dimColor>{TreeChars.BRANCH}</Text> <Text color="green">{load.sourceCount.toLocaleString()}</Text>{' '}
          outflows <Text dimColor>(sources)</Text>
        </Text>
        <Text>
          {'  '}
          <Text dimColor>{TreeChars.LAST_BRANCH}</Text> <Text color="green">{load.targetCount.toLocaleString()}</Text>{' '}
          inflows <Text dimColor>(targets)</Text>
        </Text>
      </Box>
    );
  }

  return null;
};

/**
 * Matching section
 */
const MatchSection: FC<{ dryRun: boolean; match: MatchPhase }> = ({ match, dryRun }) => {
  const elapsed = match.completedAt ? match.completedAt - match.startedAt : performance.now() - match.startedAt;
  const duration = formatDuration(elapsed);

  if (match.status === 'active') {
    return (
      <Text>
        {statusIcon('active')} <Text bold>Matching</Text> <Text dimColor>· {duration}</Text>
      </Text>
    );
  }

  if (match.status === 'completed') {
    const totalMatches = match.internalCount + match.confirmedCount + match.suggestedCount;
    const hasMatches = totalMatches > 0;

    // No matches case
    if (!hasMatches) {
      return (
        <Box flexDirection="column">
          <Text>
            <Text color="green">✓</Text> Matching{dryRun && <Text color="yellow"> — dry run</Text>}{' '}
            <Text dimColor>({duration})</Text>
          </Text>
          <Text>
            {'  '}
            <Text dimColor>{TreeChars.LAST_BRANCH}</Text> <Text dimColor>No matches found</Text>
          </Text>
        </Box>
      );
    }

    // With matches - show sub-lines for counts
    const hasInternal = match.internalCount > 0;
    const hasConfirmed = match.confirmedCount > 0;
    const hasSuggested = match.suggestedCount > 0;

    // Determine which line is last (use LAST_BRANCH for it)
    const lines: {
      count: number;
      isLast: boolean;
      label: string;
      type: 'internal' | 'confirmed' | 'suggested';
    }[] = [];

    if (hasInternal) {
      lines.push({ type: 'internal', count: match.internalCount, label: 'internal (same tx hash)', isLast: false });
    }
    if (hasConfirmed) {
      lines.push({ type: 'confirmed', count: match.confirmedCount, label: 'confirmed (≥95%)', isLast: false });
    }
    if (hasSuggested) {
      lines.push({ type: 'suggested', count: match.suggestedCount, label: 'suggested (70–95%)', isLast: false });
    }

    // Mark the last line
    if (lines.length > 0) {
      lines[lines.length - 1]!.isLast = true;
    }

    return (
      <Box flexDirection="column">
        <Text>
          <Text color="green">✓</Text> Matching{dryRun && <Text color="yellow"> — dry run</Text>}{' '}
          <Text dimColor>({duration})</Text>
        </Text>
        {lines.map((line, index) => (
          <Text key={index}>
            {'  '}
            <Text dimColor>{line.isLast ? TreeChars.LAST_BRANCH : TreeChars.BRANCH}</Text>{' '}
            <Text color="green">{line.count}</Text> <Text dimColor>{line.label}</Text>
          </Text>
        ))}
      </Box>
    );
  }

  return null;
};

/**
 * Save section
 */
const SaveSection: FC<{ save: SavePhase }> = ({ save }) => {
  const elapsed = save.completedAt ? save.completedAt - save.startedAt : performance.now() - save.startedAt;
  const duration = formatDuration(elapsed);

  if (save.status === 'active') {
    return (
      <Text>
        {statusIcon('active')} <Text bold>Saving</Text> <Text dimColor>· {duration}</Text>
      </Text>
    );
  }

  if (save.status === 'completed') {
    return (
      <Text>
        <Text color="green">✓</Text> Saved <Text color="green">{save.totalSaved}</Text> links{' '}
        <Text dimColor>({duration})</Text>
      </Text>
    );
  }

  return null;
};

/**
 * Completion section
 */
const CompletionSection: FC<{ state: LinksRunState }> = ({ state }) => {
  const duration = state.totalDurationMs ? formatDuration(state.totalDurationMs) : '';

  // Failed
  if (state.errorMessage) {
    return (
      <Box flexDirection="column">
        <Text> </Text>
        <Text>
          <Text color="yellow">⚠</Text> Failed {duration && <Text dimColor>({duration})</Text>}
        </Text>
        <Text>
          {'  '}
          {state.errorMessage}
        </Text>
      </Box>
    );
  }

  // Aborted
  if (state.aborted) {
    return (
      <Box flexDirection="column">
        <Text> </Text>
        <Text>
          <Text color="yellow">⚠</Text> Aborted {duration && <Text dimColor>({duration})</Text>}
        </Text>
      </Box>
    );
  }

  // Success - determine next steps
  const hasSuggested = state.match && state.match.suggestedCount > 0;

  if (state.dryRun) {
    return (
      <Box flexDirection="column">
        <Text> </Text>
        <Text>
          <Text color="green">✓</Text> Done — <Text color="yellow">dry run, nothing saved</Text>{' '}
          {duration && <Text dimColor>({duration})</Text>}
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text> </Text>
      <Text>
        <Text color="green">✓</Text> Done {duration && <Text dimColor>({duration})</Text>}
      </Text>
      {hasSuggested && (
        <>
          <Text> </Text>
          <Text dimColor>Next: exitbook links view --status suggested</Text>
        </>
      )}
    </Box>
  );
};
