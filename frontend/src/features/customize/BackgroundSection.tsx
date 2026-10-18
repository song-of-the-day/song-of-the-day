import { ImagePlus, Trash2 } from 'lucide-react';
import { useState, type ChangeEvent } from 'react';

import { useUploadImage } from '@/api/hooks/profile';
import { Button } from '@/components/ui/Button';
import { buttonClassName } from '@/components/ui/buttonStyles';
import { joinIds } from '@/components/ui/field';
import { FieldError, FieldHint } from '@/components/ui/FieldMessage';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Spinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/cn';
import {
  imageFitOptions,
  PATTERN_KEYS,
  patternOptions,
  uploadUrl,
  type ImageFit,
  type PatternKey,
  type ThemeBackground,
} from '@/lib/theme';

import { ChoiceGroup } from './ChoiceGroup';
import { PATTERN_DISABLED_HINT } from './copy';
import { Section } from './Section';
import {
  ACCEPTED_IMAGE_TYPES,
  describeUploadError,
  MAX_UPLOAD_BYTES,
  TOO_LARGE_MESSAGE,
  UPLOAD_HINT,
} from './uploadErrors';

const FIT_OPTIONS = imageFitOptions.map((fit) => ({ value: fit.key, label: fit.label }));

function patternLabel(key: PatternKey): string {
  return patternOptions.find((pattern) => pattern.key === key)?.label ?? key;
}

export interface BackgroundSectionProps {
  background: ThemeBackground;
  /** Id for the file input, so the form can move focus to it. */
  imageFieldId: string;
  /** A message about the image from a save attempt. */
  imageError?: string;
  /** Called while an upload starts (`true`) and ends (`false`). */
  onUploadingChange: (uploading: boolean) => void;
  onChange: (background: Partial<ThemeBackground>) => void;
}

/** Background pattern chips, or an uploaded image with its fit. */
export function BackgroundSection({
  background,
  imageFieldId,
  imageError,
  onUploadingChange,
  onChange,
}: BackgroundSectionProps) {
  const upload = useUploadImage();
  const [uploadError, setUploadError] = useState<string | null>(null);
  const hasImage = background.image_upload_id !== null;
  const hintId = `${imageFieldId}-hint`;
  const errorId = `${imageFieldId}-error`;
  const message = uploadError ?? imageError;

  function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Clear the input so choosing the same file again still fires a change.
    event.target.value = '';
    if (file === undefined) {
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setUploadError(TOO_LARGE_MESSAGE);
      return;
    }
    setUploadError(null);
    onUploadingChange(true);
    upload.mutate(file, {
      onSuccess: (uploaded) => {
        onChange({ image_upload_id: uploaded.id });
      },
      onError: (error) => {
        setUploadError(describeUploadError(error));
      },
      onSettled: () => {
        onUploadingChange(false);
      },
    });
  }

  return (
    <Section title="Background">
      <ChoiceGroup
        legend="Pattern"
        showLegend
        options={PATTERN_KEYS}
        value={background.pattern}
        disabled={hasImage}
        hint={hasImage ? PATTERN_DISABLED_HINT : undefined}
        onChange={(pattern) => {
          onChange({ pattern });
        }}
        className="flex flex-wrap gap-2"
        optionClassName="rounded-full"
        renderOption={(key) => (
          <span className="flex items-center gap-2 py-1 pr-3 pl-1">
            <span
              aria-hidden="true"
              data-pattern={key}
              className="size-7 shrink-0 rounded-full border border-line bg-bg"
            />
            <span className="text-sm">{patternLabel(key)}</span>
          </span>
        )}
      />

      <div className="flex flex-col gap-2">
        <span aria-hidden="true" className="text-sm font-medium text-fg">
          Image
        </span>
        {background.image_upload_id !== null && (
          <img
            src={uploadUrl(background.image_upload_id)}
            alt="Current background"
            className="h-24 w-full rounded-md border border-line object-cover"
          />
        )}
        <div className="flex flex-wrap items-center gap-2">
          <label
            className={cn(
              buttonClassName({ variant: 'secondary', size: 'sm' }),
              'cursor-pointer has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent',
              upload.isPending && 'pointer-events-none opacity-60',
            )}
          >
            <ImagePlus aria-hidden="true" className="size-4" />
            {hasImage ? 'Replace image' : 'Upload image'}
            <input
              id={imageFieldId}
              type="file"
              accept={ACCEPTED_IMAGE_TYPES}
              disabled={upload.isPending}
              aria-invalid={message !== undefined || undefined}
              aria-describedby={joinIds(hintId, message !== undefined && errorId)}
              onChange={handleFile}
              className="sr-only"
            />
          </label>
          {hasImage && (
            <Button
              variant="ghost"
              size="sm"
              icon={<Trash2 aria-hidden="true" className="size-4" />}
              disabled={upload.isPending}
              onClick={() => {
                setUploadError(null);
                onChange({ image_upload_id: null });
              }}
            >
              Remove image
            </Button>
          )}
          {upload.isPending && <Spinner size="sm" label="Uploading image…" />}
        </div>
        <FieldHint id={hintId}>{UPLOAD_HINT}</FieldHint>
        {message !== undefined && <FieldError id={errorId}>{message}</FieldError>}
      </div>

      {hasImage && (
        <div className="flex flex-col gap-2">
          <span aria-hidden="true" className="text-sm font-medium text-fg">
            Image fit
          </span>
          <SegmentedControl<ImageFit>
            label="Image fit"
            size="sm"
            options={FIT_OPTIONS}
            value={background.image_fit}
            onChange={(image_fit) => {
              onChange({ image_fit });
            }}
            className="self-start"
          />
        </div>
      )}
    </Section>
  );
}
