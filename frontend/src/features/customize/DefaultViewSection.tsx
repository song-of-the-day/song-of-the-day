import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { defaultViewOptions, type DefaultView } from '@/lib/theme';

import { Section } from './Section';

const VIEW_OPTIONS = defaultViewOptions.map((view) => ({ value: view.key, label: view.label }));

export interface DefaultViewSectionProps {
  defaultView: DefaultView;
  onDefaultViewChange: (view: DefaultView) => void;
}

/**
 * Which view the profile opens in: the Board grid of album art or the
 * Calendar month. Visitors can still switch views with the toolbar; this only sets the default.
 */
export function DefaultViewSection({ defaultView, onDefaultViewChange }: DefaultViewSectionProps) {
  return (
    <Section title="Default view">
      <p className="text-sm text-muted">The view your page opens in.</p>
      <SegmentedControl<DefaultView>
        label="Default view"
        options={VIEW_OPTIONS}
        value={defaultView}
        onChange={onDefaultViewChange}
      />
    </Section>
  );
}
