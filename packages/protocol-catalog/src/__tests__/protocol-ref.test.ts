import { describe, expect, it } from 'vitest';

import { formatProtocolRef, protocolRefsEqual } from '../index.js';

describe('formatProtocolRef', () => {
  it('formats an unversioned protocol ref without a suffix', () => {
    expect(formatProtocolRef({ id: 'wormhole' })).toBe('wormhole');
  });

  it('formats a versioned protocol ref with an at-suffixed version', () => {
    expect(formatProtocolRef({ id: 'uniswap', version: 'v3' })).toBe('uniswap@v3');
  });
});

describe('protocolRefsEqual', () => {
  it('treats matching id and version as equal', () => {
    expect(protocolRefsEqual({ id: 'aave', version: 'v3' }, { id: 'aave', version: 'v3' })).toBe(true);
  });

  it('treats differing versions as distinct', () => {
    expect(protocolRefsEqual({ id: 'aave', version: 'v2' }, { id: 'aave', version: 'v3' })).toBe(false);
  });

  it('treats missing version as equivalent to another missing version', () => {
    expect(protocolRefsEqual({ id: 'ibc' }, { id: 'ibc' })).toBe(true);
  });
});
