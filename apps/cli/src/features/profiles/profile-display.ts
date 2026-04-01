import type { ProfileService } from '@exitbook/accounts';

interface ProfileIdentity {
  displayName: string;
  profileKey: string;
}

export function formatProfileReference(profile: ProfileIdentity): string {
  if (profile.displayName === profile.profileKey) {
    return profile.profileKey;
  }

  return `${profile.profileKey} (label: ${profile.displayName})`;
}

export async function withProfileKeyHint(
  profileService: ProfileService,
  selector: string,
  error: Error
): Promise<Error> {
  if (!shouldSuggestProfileKeyFromLabel(error)) {
    return error;
  }

  const profilesResult = await profileService.list();
  if (profilesResult.isErr()) {
    return error;
  }

  const normalizedSelector = selector.trim().toLowerCase();
  const matchingProfiles = profilesResult.value.filter(
    (profile) => profile.displayName.trim().toLowerCase() === normalizedSelector
  );

  if (matchingProfiles.length !== 1) {
    return error;
  }

  const matchingProfile = matchingProfiles[0];
  if (!matchingProfile || matchingProfile.profileKey === normalizedSelector) {
    return error;
  }

  return new Error(
    `Profile selector '${selector.trim()}' did not match a profile key. Matching label found on profile '${matchingProfile.profileKey}'. Use the profile key instead.`
  );
}

function shouldSuggestProfileKeyFromLabel(error: Error): boolean {
  return /^Profile '.*' not found$/.test(error.message) || error.message.startsWith('Profile key ');
}
