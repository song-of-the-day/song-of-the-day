import { CARD_STYLE_KEYS, cardStyleOptions, type CardStyle } from '@/lib/theme';

import { ChoiceGroup } from './ChoiceGroup';
import { Section } from './Section';

function cardStyleLabel(key: CardStyle): string {
  return cardStyleOptions.find((style) => style.key === key)?.label ?? key;
}

/** A tiny drawing of a card in the given style, in the draft theme's colors. */
function CardPreview({ cardStyle }: { cardStyle: CardStyle }) {
  if (cardStyle === 'window') {
    return (
      <span className="flex w-12 flex-col border border-line bg-surface shadow-[2px_2px_0_var(--sotd-border)]">
        <span className="flex h-2.5 items-center gap-0.5 border-b border-line px-1">
          <span className="size-1 rounded-full bg-accent" />
          <span className="size-1 rounded-full bg-muted" />
          <span className="size-1 rounded-full bg-line" />
        </span>
        <span className="m-1 block aspect-square bg-accent/25" />
        <span className="mx-1 mb-1 block h-1 w-7 rounded-full bg-fg/60" />
      </span>
    );
  }
  if (cardStyle === 'polaroid') {
    return (
      <span className="flex w-12 flex-col border border-line bg-surface p-1.5 pb-2 shadow-[0_2px_0_var(--sotd-border)]">
        <span className="block aspect-square bg-accent/25" />
        <span className="mx-auto mt-1.5 block h-1 w-6 rounded-full bg-fg/60" />
      </span>
    );
  }
  return (
    <span className="flex w-12 flex-col gap-1 p-0.5">
      <span className="block aspect-square border border-line bg-accent/25" />
      <span className="block h-1 w-8 rounded-full bg-fg/60" />
      <span className="block h-1 w-5 rounded-full bg-muted" />
    </span>
  );
}

export interface CardSectionProps {
  cardStyle: CardStyle;
  onCardStyleChange: (cardStyle: CardStyle) => void;
}

/** The board's card style. */
export function CardSection({ cardStyle, onCardStyleChange }: CardSectionProps) {
  return (
    <Section title="Cards">
      <ChoiceGroup
        legend="Card style"
        options={CARD_STYLE_KEYS}
        value={cardStyle}
        onChange={onCardStyleChange}
        className="grid grid-cols-3 gap-2"
        optionClassName="justify-center"
        renderOption={(key) => (
          <span className="flex flex-col items-center gap-2 px-1 pt-3 pb-2">
            <span aria-hidden="true" className="flex h-18 items-center">
              <CardPreview cardStyle={key} />
            </span>
            <span className="text-sm">{cardStyleLabel(key)}</span>
          </span>
        )}
      />
    </Section>
  );
}
