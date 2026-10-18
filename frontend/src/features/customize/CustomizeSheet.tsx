import { useEffect, useId, useState, type SubmitEvent } from 'react';
import { NavigationType, useBlocker } from 'react-router';

import { fieldErrors } from '@/api/errors';
import { useMe } from '@/api/hooks/auth';
import { useUpdateProfile } from '@/api/hooks/profile';
import { describeApiError } from '@/api/messages';
import type { Theme, User } from '@/api/types';
import { FormError } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Sheet } from '@/components/ui/Sheet';
import { useToast } from '@/components/ui/useToast';
import { useFormErrors } from '@/features/auth/useFormErrors';
import {
  apiFieldErrors,
  validateDisplayName,
  type FieldErrorMap,
} from '@/features/auth/validation';

import { BackgroundSection } from './BackgroundSection';
import { CardSection } from './CardSection';
import { ColorSection } from './ColorSection';
import { DefaultViewSection } from './DefaultViewSection';
import {
  DISCARD_CANCEL,
  DISCARD_CONFIRM,
  DISCARD_MESSAGE,
  DISCARD_TITLE,
  HEX_FORMAT_MESSAGE,
  SAVED_MESSAGE,
  SHEET_DESCRIPTION,
  SHEET_TITLE,
} from './copy';
import { colorField, DRAFT_FIELDS, isDraftChanged, type DraftField } from './draft';
import { FontSection } from './FontSection';
import { PresetPicker } from './PresetPicker';
import { ProfileSection } from './ProfileSection';
import { useCustomizeDraft } from './useCustomizeDraft';

export interface CustomizeSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Live preview: called with the draft theme while editing; called with null when the draft is saved or discarded. */
  onPreviewChange: (theme: Theme | null) => void;
}

/**
 * Edits the profile's look, display name and bio with a live preview of the whole page.
 * The username is changed in the account dialog, not here. Every way out
 * other than Save (Cancel, Esc, ✕, the overlay, the browser's back button) discards the draft,
 * after a "Discard changes?" confirmation when something changed. The draft is created from the
 * saved profile each time the sheet opens.
 */
export function CustomizeSheet({ open, onOpenChange, onPreviewChange }: CustomizeSheetProps) {
  const { data: user } = useMe();
  if (!open || user === undefined || user === null) {
    return null;
  }
  return (
    <CustomizeEditor
      user={user}
      onClose={() => {
        onOpenChange(false);
      }}
      onPreviewChange={onPreviewChange}
    />
  );
}

interface CustomizeEditorProps {
  user: User;
  onClose: () => void;
  onPreviewChange: (theme: Theme | null) => void;
}

function CustomizeEditor({ user, onClose, onPreviewChange }: CustomizeEditorProps) {
  const toast = useToast();
  const update = useUpdateProfile();
  const editor = useCustomizeDraft(user, onPreviewChange);
  const form = useFormErrors(DRAFT_FIELDS);
  const formId = useId();
  const [uploading, setUploading] = useState(false);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const { draft } = editor;

  function discard() {
    onPreviewChange(null);
    onClose();
  }

  function requestClose() {
    if (update.isPending) {
      return;
    }
    if (editor.changed) {
      setConfirmingDiscard(true);
    } else {
      discard();
    }
  }

  // The browser's back button closes the sheet (like Cancel) instead of leaving the page. The
  // router reverts the blocked history step; the blocker is reset if the sheet stays open.
  const blocker = useBlocker(({ historyAction }) => {
    if (historyAction !== NavigationType.Pop) {
      return false;
    }
    requestClose();
    return true;
  });
  useEffect(() => {
    if (blocker.state === 'blocked') {
      blocker.reset();
    }
  }, [blocker]);

  function edited(field: DraftField) {
    form.clearField(field);
  }

  function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (update.isPending || uploading) {
      return;
    }
    const errors: FieldErrorMap<DraftField> = {};
    for (const role of editor.invalidColors) {
      errors[colorField(role)] = HEX_FORMAT_MESSAGE;
    }
    const nameError = validateDisplayName(draft.display_name);
    if (nameError !== undefined) {
      errors.display_name = nameError;
    }
    if (form.showErrors(errors)) {
      return;
    }
    if (!isDraftChanged(draft, editor.saved)) {
      discard();
      return;
    }
    update.mutate(
      {
        display_name: draft.display_name.trim(),
        bio: draft.bio,
        theme: draft.theme,
      },
      {
        onSuccess: () => {
          toast.show(SAVED_MESSAGE, { tone: 'success' });
          discard();
        },
        onError: (error) => {
          const fields = apiFieldErrors(error, DRAFT_FIELDS);
          const shown = Object.keys(fields).length;
          const unshown = Object.keys(fieldErrors(error)).length > shown;
          form.showErrors(fields, shown === 0 || unshown ? describeApiError(error) : null);
        },
      },
    );
  }

  return (
    <>
      <Sheet
        open
        onOpenChange={(next) => {
          if (!next) {
            requestClose();
          }
        }}
        title={SHEET_TITLE}
        description={SHEET_DESCRIPTION}
        overlay="none"
        footer={
          <>
            <FormError message={form.formError} className="w-full" />
            <Button variant="secondary" disabled={update.isPending} onClick={discard}>
              Cancel
            </Button>
            <Button type="submit" form={formId} loading={update.isPending} disabled={uploading}>
              Save
            </Button>
          </>
        }
      >
        <form id={formId} noValidate onSubmit={save} className="flex flex-col">
          <PresetPicker
            theme={draft.theme}
            onApply={(key) => {
              editor.applyPreset(key);
            }}
          />
          <ColorSection
            theme={draft.theme}
            hexText={editor.hexText}
            fieldId={(role) => form.fieldId(colorField(role))}
            errors={{
              background: form.errors['theme.colors.background'],
              surface: form.errors['theme.colors.surface'],
              text: form.errors['theme.colors.text'],
              accent: form.errors['theme.colors.accent'],
              border: form.errors['theme.colors.border'],
            }}
            onPick={(role, hex) => {
              edited(colorField(role));
              editor.setColor(role, hex);
            }}
            onTextChange={(role, text) => {
              edited(colorField(role));
              editor.setHexText(role, text);
            }}
            onTextBlur={(role) => {
              editor.normalizeHexText(role);
            }}
          />
          <FontSection
            fonts={draft.theme.fonts}
            fieldId={(slot) => form.fieldId(`theme.fonts.${slot}`)}
            errors={{
              heading: form.errors['theme.fonts.heading'],
              body: form.errors['theme.fonts.body'],
            }}
            onChange={(slot, font) => {
              edited(`theme.fonts.${slot}`);
              editor.editTheme({ fonts: { [slot]: font } });
            }}
          />
          <BackgroundSection
            background={draft.theme.background}
            imageFieldId={form.fieldId('theme.background.image_upload_id')}
            imageError={form.errors['theme.background.image_upload_id']}
            onUploadingChange={setUploading}
            onChange={(background) => {
              edited('theme.background.image_upload_id');
              editor.editTheme({ background });
            }}
          />
          <CardSection
            cardStyle={draft.theme.card_style}
            onCardStyleChange={(card_style) => {
              editor.editTheme({ card_style });
            }}
          />
          <DefaultViewSection
            defaultView={draft.theme.default_view}
            onDefaultViewChange={(default_view) => {
              editor.editTheme({ default_view });
            }}
          />
          <ProfileSection
            displayName={draft.display_name}
            bio={draft.bio}
            displayNameId={form.fieldId('display_name')}
            bioId={form.fieldId('bio')}
            displayNameError={form.errors.display_name}
            bioError={form.errors.bio}
            onDisplayNameChange={(value) => {
              edited('display_name');
              editor.setDisplayName(value);
            }}
            onBioChange={(value) => {
              edited('bio');
              editor.setBio(value);
            }}
          />
        </form>
      </Sheet>
      <ConfirmDialog
        open={confirmingDiscard}
        onOpenChange={setConfirmingDiscard}
        title={DISCARD_TITLE}
        message={DISCARD_MESSAGE}
        confirmLabel={DISCARD_CONFIRM}
        cancelLabel={DISCARD_CANCEL}
        destructive
        onConfirm={() => {
          setConfirmingDiscard(false);
          discard();
        }}
      />
    </>
  );
}
