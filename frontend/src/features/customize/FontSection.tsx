import { Select } from '@/components/ui/Select';
import {
  FONT_KEYS,
  fontFamily,
  fontOptions,
  type FontKey,
  type FontSlot,
  type ThemeFonts,
} from '@/lib/theme';

import { Section } from './Section';

const SLOT_LABELS: Record<FontSlot, string> = { heading: 'Heading font', body: 'Body font' };
const SLOTS: readonly FontSlot[] = ['heading', 'body'];

function isFontKey(value: string): value is FontKey {
  const keys: readonly string[] = FONT_KEYS;
  return keys.includes(value);
}

export interface FontSectionProps {
  fonts: ThemeFonts;
  fieldId: (slot: FontSlot) => string;
  errors: Partial<Record<FontSlot, string>>;
  onChange: (slot: FontSlot, font: FontKey) => void;
}

/** Heading and body font pickers (each option drawn in its own font) and a live sample. */
export function FontSection({ fonts, fieldId, errors, onChange }: FontSectionProps) {
  return (
    <Section title="Fonts">
      {SLOTS.map((slot) => (
        <Select
          key={slot}
          id={fieldId(slot)}
          label={SLOT_LABELS[slot]}
          value={fonts[slot]}
          error={errors[slot]}
          style={{ fontFamily: fontFamily(fonts[slot]) }}
          onChange={(event) => {
            const { value } = event.target;
            if (isFontKey(value)) {
              onChange(slot, value);
            }
          }}
        >
          {fontOptions.map((font) => (
            <option key={font.key} value={font.key} style={{ fontFamily: font.family }}>
              {font.label}
            </option>
          ))}
        </Select>
      ))}
      <div
        aria-label="Font sample"
        role="group"
        className="rounded-md border border-dashed border-muted px-3 py-2.5"
      >
        <p className="text-lg leading-snug" style={{ fontFamily: fontFamily(fonts.heading) }}>
          song of the day ✦
        </p>
        <p className="text-sm text-muted" style={{ fontFamily: fontFamily(fonts.body) }}>
          The track I had on repeat all afternoon.
        </p>
      </div>
    </Section>
  );
}
