/**
 * Benchmark TUI components
 */

import { Box, Text, useApp } from 'ink';
import Spinner from 'ink-spinner';
import { useEffect, useReducer, type FC } from 'react';

import type { BenchmarkProgressEvent } from '../../providers-benchmark/benchmark-tool.js';

import type { BenchmarkState, BurstTest, SustainedTest } from './benchmark-state.js';
import { benchmarkReducer } from './benchmark-state.js';

interface BenchmarkAppProps {
  initialState: BenchmarkState;
  runBenchmark: (onProgress: (event: BenchmarkProgressEvent) => void) => Promise<{
    burstLimits?: { limit: number; success: boolean }[] | undefined;
    maxSafeRate: number;
    recommended: {
      burstLimit?: number | undefined;
      requestsPerSecond: number;
    };
    testResults: { rate: number; responseTimeMs?: number | undefined; success: boolean }[];
  }>;
}

export const BenchmarkApp: FC<BenchmarkAppProps> = ({ initialState, runBenchmark }) => {
  const [state, dispatch] = useReducer(benchmarkReducer, initialState);
  const { exit } = useApp();

  useEffect(() => {
    // Run benchmark on mount
    runBenchmark((event) => {
      dispatch({ type: 'PROGRESS', event });
    })
      .then((result) => {
        dispatch({ type: 'COMPLETE', result });
      })
      .catch((error) => {
        dispatch({ type: 'ERROR', message: error instanceof Error ? error.message : String(error) });
      });
  }, [runBenchmark]);

  // Exit when complete or on error
  useEffect(() => {
    if (state.phase === 'complete' || state.phase === 'error') {
      // Small delay to ensure final render is visible
      const timer = setTimeout(() => {
        exit();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [state.phase, exit]);

  return (
    <Box flexDirection="column">
      <Text> </Text>
      <BenchmarkHeader state={state} />
      <Text> </Text>
      <ProviderInfoSection state={state} />
      <Text> </Text>
      <SustainedRateTests tests={state.sustainedTests} />
      {!state.skipBurst && state.burstTests.length > 0 && (
        <>
          <Text> </Text>
          <BurstLimitTests tests={state.burstTests} />
        </>
      )}
      {state.phase === 'complete' && (
        <>
          <Text> </Text>
          <ResultsSummary state={state} />
        </>
      )}
      {state.phase === 'error' && (
        <>
          <Text> </Text>
          <Text color="red">✗ Error: {state.errorMessage}</Text>
        </>
      )}
      <Text> </Text>
    </Box>
  );
};

// --- Header ---

const BenchmarkHeader: FC<{ state: BenchmarkState }> = ({ state }) => {
  const phaseLabel = state.phase === 'testing' ? 'running' : state.phase;

  return (
    <Box>
      <Text bold>Benchmark</Text>
      <Text> </Text>
      <Text color="cyan">{state.providerName}</Text>
      <Text dimColor> · </Text>
      <Text>{state.blockchain}</Text>
      <Text> </Text>
      <Text dimColor>·</Text>
      <Text> </Text>
      {state.phase === 'testing' ? (
        <Text color="yellow">{phaseLabel}</Text>
      ) : state.phase === 'complete' ? (
        <Text color="green">{phaseLabel}</Text>
      ) : (
        <Text color="red">{phaseLabel}</Text>
      )}
    </Box>
  );
};

// --- Provider Info ---

const ProviderInfoSection: FC<{ state: BenchmarkState }> = ({ state }) => {
  return (
    <Box flexDirection="column">
      <Text dimColor>Provider Info</Text>
      <Text>
        {'  '}
        <Text dimColor>Current rate limit: </Text>
        <Text>{JSON.stringify(state.currentRateLimit)}</Text>
      </Text>
      <Text>
        {'  '}
        <Text dimColor>Requests per test: </Text>
        <Text>{state.numRequests}</Text>
      </Text>
      <Text>
        {'  '}
        <Text dimColor>Burst testing: </Text>
        <Text>{state.skipBurst ? 'disabled' : 'enabled'}</Text>
      </Text>
    </Box>
  );
};

// --- Sustained Rate Tests ---

const SustainedRateTests: FC<{ tests: SustainedTest[] }> = ({ tests }) => {
  return (
    <Box flexDirection="column">
      <Text dimColor>Sustained Rate Tests</Text>
      {tests.map((test) => (
        <SustainedTestRow
          key={test.rate}
          test={test}
        />
      ))}
    </Box>
  );
};

const SustainedTestRow: FC<{ test: SustainedTest }> = ({ test }) => {
  const rateLabel = `${test.rate} req/sec`.padEnd(14);

  return (
    <Box>
      <Text>{'  '}</Text>
      {test.status === 'pending' && <Text dimColor>· {rateLabel}</Text>}
      {test.status === 'running' && (
        <>
          <Text color="yellow">
            <Spinner type="dots" />
          </Text>
          <Text> {rateLabel}</Text>
        </>
      )}
      {test.status === 'success' && (
        <>
          <Text color="green">✓</Text>
          <Text> {rateLabel}</Text>
          {test.responseTimeMs !== undefined && <Text dimColor> avg {test.responseTimeMs.toFixed(0)}ms</Text>}
        </>
      )}
      {test.status === 'failed' && (
        <>
          <Text color="red">✗</Text>
          <Text> {rateLabel}</Text>
          {test.responseTimeMs !== undefined && <Text dimColor> avg {test.responseTimeMs.toFixed(0)}ms</Text>}
        </>
      )}
    </Box>
  );
};

// --- Burst Limit Tests ---

const BurstLimitTests: FC<{ tests: BurstTest[] }> = ({ tests }) => {
  return (
    <Box flexDirection="column">
      <Text dimColor>Burst Limit Tests</Text>
      {tests.map((test) => (
        <BurstTestRow
          key={test.limit}
          test={test}
        />
      ))}
    </Box>
  );
};

const BurstTestRow: FC<{ test: BurstTest }> = ({ test }) => {
  const limitLabel = `${test.limit} req/min`.padEnd(14);

  return (
    <Box>
      <Text>{'  '}</Text>
      {test.status === 'pending' && <Text dimColor>· {limitLabel}</Text>}
      {test.status === 'running' && (
        <>
          <Text color="yellow">
            <Spinner type="dots" />
          </Text>
          <Text> {limitLabel}</Text>
        </>
      )}
      {test.status === 'success' && (
        <>
          <Text color="green">✓</Text>
          <Text> {limitLabel}</Text>
        </>
      )}
      {test.status === 'failed' && (
        <>
          <Text color="red">✗</Text>
          <Text> {limitLabel}</Text>
        </>
      )}
    </Box>
  );
};

// --- Results Summary ---

const ResultsSummary: FC<{ state: BenchmarkState }> = ({ state }) => {
  if (!state.maxSafeRate || !state.recommended) {
    return null;
  }

  return (
    <Box flexDirection="column">
      <Text>
        <Text color="green">✓</Text>
        <Text> Benchmark complete</Text>
      </Text>
      <Text> </Text>
      <Text>
        <Text dimColor>Max safe rate: </Text>
        <Text bold>{state.maxSafeRate} req/sec</Text>
      </Text>
      <Text> </Text>
      <Text dimColor>Recommended configuration (80% safety margin):</Text>
      <Text>
        {'  '}
        {JSON.stringify(state.recommended, undefined, 2)}
      </Text>
      <Text> </Text>
      <Text dimColor>To update the configuration, edit:</Text>
      <Text>{'  '}apps/cli/config/blockchain-explorers.json</Text>
      <Text> </Text>
      <Text dimColor>Example override for {state.providerName}:</Text>
      <Text>
        {'  '}
        {JSON.stringify(state.configOverride, undefined, 2)}
      </Text>
    </Box>
  );
};
