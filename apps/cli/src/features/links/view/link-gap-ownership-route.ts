import type { LinkGapEndpointOwnership } from '../links-gaps-browse-model.js';

export function buildGapOwnershipRouteLabel(
  fromOwnership: LinkGapEndpointOwnership | undefined,
  toOwnership: LinkGapEndpointOwnership | undefined
): string | undefined {
  if (fromOwnership === undefined && toOwnership === undefined) {
    return undefined;
  }

  if (fromOwnership !== undefined && toOwnership !== undefined) {
    return `${fromOwnership} source -> ${toOwnership} destination`;
  }

  if (fromOwnership !== undefined) {
    return `${fromOwnership} source`;
  }

  return `${toOwnership!} destination`;
}

export function getGapOwnershipRouteColor(value: string): 'dim' | 'green' | 'yellow' {
  if (value === 'tracked source -> untracked destination') {
    return 'yellow';
  }

  if (value === 'untracked source -> tracked destination') {
    return 'green';
  }

  return 'dim';
}
