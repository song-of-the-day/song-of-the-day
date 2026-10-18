import { TriangleAlert } from 'lucide-react';

import { checkThemeContrast } from '@/lib/color';
import { COLOR_ROLES, type ColorRole, type Theme } from '@/lib/theme';

import { ColorField } from './ColorField';
import { describeContrastIssue } from './contrast';
import type { HexText } from './draft';
import { Section } from './Section';

const COLOR_LABELS: Record<ColorRole, string> = {
  background: 'Background',
  surface: 'Cards & panels',
  text: 'Text',
  accent: 'Accent',
  border: 'Lines & shadows',
};

export interface ColorSectionProps {
  theme: Theme;
  hexText: HexText;
  /** Field ids per color, so the form can move focus to one. */
  fieldId: (role: ColorRole) => string;
  errors: Partial<Record<ColorRole, string>>;
  onPick: (role: ColorRole, hex: string) => void;
  onTextChange: (role: ColorRole, text: string) => void;
  onTextBlur: (role: ColorRole) => void;
}

/** The five theme colors plus non-blocking warnings for color pairs that are hard to read. */
export function ColorSection({
  theme,
  hexText,
  fieldId,
  errors,
  onPick,
  onTextChange,
  onTextBlur,
}: ColorSectionProps) {
  const issues = checkThemeContrast(theme);
  return (
    <Section title="Colors">
      <div className="flex flex-col gap-3">
        {COLOR_ROLES.map((role) => (
          <ColorField
            key={role}
            label={COLOR_LABELS[role]}
            id={fieldId(role)}
            color={theme.colors[role]}
            text={hexText[role]}
            error={errors[role]}
            onPick={(hex) => {
              onPick(role, hex);
            }}
            onTextChange={(text) => {
              onTextChange(role, text);
            }}
            onTextBlur={() => {
              onTextBlur(role);
            }}
          />
        ))}
      </div>
      <div role="status" aria-live="polite">
        {issues.length > 0 && (
          <ul aria-label="Contrast warnings" className="flex flex-col gap-1.5">
            {issues.map((issue) => (
              <li
                key={issue.pair}
                className="flex items-start gap-2 rounded-md border border-dashed border-muted px-2.5 py-2 text-sm text-fg"
              >
                <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent" />
                <span>{describeContrastIssue(issue)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}
