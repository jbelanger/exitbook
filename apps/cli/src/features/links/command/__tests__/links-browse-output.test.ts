import { describe, expect, it } from 'vitest';

import { createMockLinksBatch } from '../../__tests__/test-utils.js';
import type { CliJsonOutput } from '../../../../cli/command.js';
import { buildLinkProposalRef } from '../../link-selector.js';
import { createLinksViewState } from '../../view/links-view-state.js';
import { buildLinksBrowseCompletion } from '../links-browse-output.js';

describe('links-browse-output', () => {
  it('includes provenance in json detail output', () => {
    const links = createMockLinksBatch(1);
    links[0] = {
      ...links[0]!,
      link: {
        ...links[0]!.link,
        metadata: {
          linkProvenance: 'user',
          overrideId: 'override-1',
          overrideLinkType: 'transfer',
        },
      },
    };

    const state = createLinksViewState(links);
    const selectedProposal = {
      proposal: state.proposals[0]!,
      proposalRef: buildLinkProposalRef(state.proposals[0]!.proposalKey),
    };
    const result = buildLinksBrowseCompletion(
      {
        mode: 'links',
        proposals: [selectedProposal],
        selectedProposal,
        state,
      },
      'detail',
      'json',
      {}
    );

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    const output = result.value.output as CliJsonOutput;
    const payload = output.data as {
      data: {
        legs: { overrideId?: string; overrideLinkType?: string }[];
        linkedAmount: string;
        overrideIds: string[];
        overrideLinkTypes: string[];
        provenance: string;
        provenanceDetail: string;
      };
    };

    expect(payload.data.provenance).toBe('user');
    expect(payload.data.overrideIds).toEqual(['override-1']);
    expect(payload.data.overrideLinkTypes).toEqual(['transfer']);
    expect(payload.data.linkedAmount).toBe(links[0].link.sourceAmount.toFixed());
    expect(payload.data.provenanceDetail).toBe('1 user-reviewed leg · 1 override · transfer type');
    expect(payload.data.legs[0]?.overrideId).toBe('override-1');
    expect(payload.data.legs[0]?.overrideLinkType).toBe('transfer');
  });
});
