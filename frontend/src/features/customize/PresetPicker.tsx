import {
  fontFamily,
  fontOptions,
  getPreset,
  isPresetKey,
  PRESET_KEYS,
  type FontKey,
  type PresetKey,
  type Theme,
} from '@/lib/theme';

import { ChoiceGroup } from './ChoiceGroup';
import { Section } from './Section';

export interface PresetPickerProps {
  theme: Theme;
  onApply: (key: PresetKey) => void;
}

function fontLabel(key: FontKey): string {
  return fontOptions.find((font) => font.key === key)?.label ?? key;
}

/** A miniature of a preset: its background, a surface window with an accent bar, and its fonts. */
function PresetSwatch({ presetKey, checked }: { presetKey: PresetKey; checked: boolean }) {
  const { label, theme } = getPreset(presetKey);
  const { background, surface, text, accent, border } = theme.colors;
  return (
    <span className="flex w-full flex-col overflow-hidden rounded-[inherit]">
      {/* Preset colors are data from theme-options.json, so they are applied inline. */}
      <span
        aria-hidden="true"
        className="relative block h-14"
        style={{ backgroundColor: background }}
      >
        <span
          className="absolute inset-x-3 top-2.5 bottom-2 flex flex-col gap-1.5 border px-1.5 pt-1"
          style={{
            backgroundColor: surface,
            borderColor: border,
            boxShadow: `2px 2px 0 ${border}`,
          }}
        >
          <span className="block h-1.5 w-8 rounded-full" style={{ backgroundColor: accent }} />
          <span
            className="truncate text-xs leading-none"
            style={{ color: text, fontFamily: fontFamily(theme.fonts.heading) }}
          >
            Aa ✦
          </span>
        </span>
      </span>
      <span className="flex flex-col gap-0.5 border-t border-line px-2 py-1.5 text-left">
        <span className="flex items-center justify-between gap-1 text-sm font-semibold">
          <span className="truncate">{label}</span>
          {checked && (
            <span aria-hidden="true" className="text-accent">
              ✦
            </span>
          )}
        </span>
        <span
          className="truncate text-xs text-muted"
          style={{ fontFamily: fontFamily(theme.fonts.heading) }}
        >
          {fontLabel(theme.fonts.heading)}
        </span>
      </span>
    </span>
  );
}

/**
 * Preset swatch cards. The applied preset is checked; once the theme is edited none is, and a
 * "custom" badge shows instead.
 */
export function PresetPicker({ theme, onApply }: PresetPickerProps) {
  const active = isPresetKey(theme.preset) ? theme.preset : null;
  return (
    <Section
      title="Presets"
      aside={
        active === null && (
          <span className="rounded-full border border-muted px-2 py-0.5 text-xs text-muted">
            ✧ custom
          </span>
        )
      }
    >
      <ChoiceGroup
        legend="Preset"
        options={PRESET_KEYS}
        value={active}
        onChange={onApply}
        optionLabel={(key) => getPreset(key).label}
        className="grid grid-cols-2 gap-2.5"
        renderOption={(key, checked) => <PresetSwatch presetKey={key} checked={checked} />}
      />
    </Section>
  );
}
