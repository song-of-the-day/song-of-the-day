import {
  useEffect,
  useEffectEvent,
  useId,
  useState,
  type KeyboardEvent,
  type RefCallback,
} from 'react';

import { SONG_SEARCH_MIN_LENGTH, useSongSearch } from '@/api/hooks/songSearch';
import { Artwork } from '@/components/entry';
import { Spinner } from '@/components/ui/Spinner';
import { TextField } from '@/components/ui/TextField';
import { TEXT_LINK_CLASS_NAME } from '@/components/ui/TextLink';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { cn } from '@/lib/cn';
import type { SongResult } from '@/lib/itunes';

import { songByline } from './songDraft';

export interface SongSearchStepProps {
  /** The search text (kept by the dialog, so it survives going back and forth). */
  term: string;
  onTermChange: (term: string) => void;
  onSelect: (song: SongResult) => void;
  /** "Can't find it? Enter it manually". */
  onEnterManually: () => void;
  /** Search failed (`SearchUnavailableError`): the dialog switches to the manual form. */
  onUnavailable: () => void;
  /** Receives the search input, which takes focus when the step opens. */
  inputRef: RefCallback<HTMLInputElement>;
}

interface ActiveOption {
  /** The search the index belongs to; a new search resets it. */
  query: string;
  index: number;
}

function resultLabel(count: number): string {
  return `${String(count)} ${count === 1 ? 'result' : 'results'}`;
}

/**
 * The log dialog's search step: an iTunes search combobox (debounced, 2+ characters) whose
 * results are picked with the arrow keys and Enter, or by clicking; plus the way out to the
 * manual form.
 */
export function SongSearchStep({
  term,
  onTermChange,
  onSelect,
  onEnterManually,
  onUnavailable,
  inputRef,
}: SongSearchStepProps) {
  const listboxId = useId();
  const debouncedTerm = useDebouncedValue(term);
  const query = debouncedTerm.trim();
  const search = useSongSearch(debouncedTerm);
  const [active, setActive] = useState<ActiveOption>({ query: '', index: -1 });
  const reportUnavailable = useEffectEvent(onUnavailable);

  const tooShort = term.trim().length < SONG_SEARCH_MIN_LENGTH;
  const settled = !tooShort && term.trim() === query && search.isSuccess && !search.isFetching;
  const results = query.length >= SONG_SEARCH_MIN_LENGTH ? (search.data ?? []) : [];
  const activeIndex = active.query === query && active.index < results.length ? active.index : -1;
  const optionId = (index: number) => `${listboxId}-${String(index)}`;
  const failed = search.isError;

  useEffect(() => {
    if (failed) {
      reportUnavailable();
    }
  }, [failed]);

  useEffect(() => {
    if (activeIndex >= 0) {
      document.getElementById(`${listboxId}-${String(activeIndex)}`)?.scrollIntoView({
        block: 'nearest',
      });
    }
  }, [listboxId, activeIndex]);

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const count = results.length;
    if (count === 0) {
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      const start = activeIndex === -1 && step === -1 ? 0 : activeIndex;
      setActive({ query, index: (start + step + count) % count });
      return;
    }
    const song = results[activeIndex];
    if (event.key === 'Enter' && song !== undefined) {
      event.preventDefault();
      onSelect(song);
    }
  }

  let status = '';
  if (!tooShort && !settled) {
    status = 'Searching…';
  } else if (settled) {
    status = results.length === 0 ? 'No matches' : resultLabel(results.length);
  }

  return (
    <div className="flex flex-col gap-4">
      <TextField
        ref={inputRef}
        label="Search for a song"
        hint={tooShort ? 'Type at least 2 characters of a title, artist or album.' : undefined}
        placeholder="Title, artist or album"
        role="combobox"
        aria-expanded={results.length > 0}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="search"
        value={term}
        onChange={(event) => {
          onTermChange(event.target.value);
        }}
        onKeyDown={handleKeyDown}
      />
      <div role="status" className="flex min-h-5 items-center gap-2 text-sm text-muted">
        {status === 'Searching…' && <Spinner size="sm" decorative />}
        <span className={cn(settled && results.length > 0 && 'sr-only')}>{status}</span>
      </div>
      <ul
        id={listboxId}
        role="listbox"
        aria-label="Search results"
        hidden={results.length === 0}
        className="-mt-2 flex flex-col gap-1"
      >
        {results.map((song, index) => (
          <li
            key={`${song.source_id}-${String(index)}`}
            id={optionId(index)}
            role="option"
            aria-selected={index === activeIndex}
            tabIndex={-1}
            className={cn(
              'flex cursor-pointer items-center gap-3 rounded-md border p-2 hover:bg-fg/5',
              index === activeIndex ? 'border-muted bg-fg/5' : 'border-transparent',
            )}
            onMouseDown={(event) => {
              // Keep focus (and the active option) in the combobox.
              event.preventDefault();
            }}
            onClick={() => {
              onSelect(song);
            }}
            // Options normally stay unfocused (focus remains in the combobox), but assistive
            // technology can focus one directly.
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelect(song);
              }
            }}
          >
            <span aria-hidden="true">
              <Artwork src={song.artwork_url} title={song.title} artist={song.artist} size="sm" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold text-fg">{song.title}</span>
              <span className="block truncate text-sm text-muted">{songByline(song)}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="text-sm text-muted">
        Can&apos;t find it?{' '}
        <button type="button" className={TEXT_LINK_CLASS_NAME} onClick={onEnterManually}>
          Enter it manually
        </button>
      </p>
    </div>
  );
}
