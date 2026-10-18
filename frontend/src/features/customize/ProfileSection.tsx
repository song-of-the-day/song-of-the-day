import { TextArea } from '@/components/ui/TextArea';
import { TextField } from '@/components/ui/TextField';
import { DISPLAY_NAME_MAX_LENGTH } from '@/features/auth/validation';

import { BIO_MAX_LENGTH } from './draft';
import { Section } from './Section';

export interface ProfileSectionProps {
  displayName: string;
  bio: string;
  displayNameId: string;
  bioId: string;
  displayNameError?: string;
  bioError?: string;
  onDisplayNameChange: (value: string) => void;
  onBioChange: (value: string) => void;
}

/**
 * The display name and bio shown in the profile header. The username (the profile link) is
 * changed in the account dialog, not here.
 */
export function ProfileSection({
  displayName,
  bio,
  displayNameId,
  bioId,
  displayNameError,
  bioError,
  onDisplayNameChange,
  onBioChange,
}: ProfileSectionProps) {
  return (
    <Section title="Profile">
      <TextField
        id={displayNameId}
        label="Display name"
        value={displayName}
        autoComplete="nickname"
        hint={`Up to ${String(DISPLAY_NAME_MAX_LENGTH)} characters.`}
        error={displayNameError}
        onChange={(event) => {
          onDisplayNameChange(event.target.value);
        }}
      />
      <TextArea
        id={bioId}
        label="Bio"
        rows={3}
        value={bio}
        maxLength={BIO_MAX_LENGTH}
        showCount
        error={bioError}
        onChange={(event) => {
          onBioChange(event.target.value);
        }}
      />
    </Section>
  );
}
