/**
 * The profile page's URL state: the main view, the calendar month and the open entry.
 */
import { useLocation, useNavigate, useSearchParams } from 'react-router';

import { monthKeyOf } from '@/lib/dates';
import type { DefaultView } from '@/lib/theme';

import {
  ENTRY_PARAM,
  MONTH_PARAM,
  parseEntryParam,
  parseMonthParam,
  parseViewParam,
  VIEW_PARAM,
} from './searchParams';

/** Marks history entries pushed by {@link ProfileParams.openEntry}. */
const ENTRY_OPENED_STATE = 'entryOpened';

export interface ProfileParams {
  /** `?view`, falling back to the theme's default view. */
  view: DefaultView;
  /** `?month` (`yyyy-MM`), falling back to the current month. */
  month: string;
  /** `?entry`, or `null` when no entry dialog is open. */
  entryId: number | null;
  /** Switches the view (replacing the history entry). */
  setView: (view: DefaultView) => void;
  /** Shows a calendar month (replacing the history entry); the current month drops the param. */
  setMonth: (month: string) => void;
  /** Opens an entry's dialog as a new history entry, so Back closes it. */
  openEntry: (id: number) => void;
  /** Closes the entry dialog: goes back if `openEntry` opened it, else drops the param. */
  closeEntry: () => void;
}

function openedInApp(state: unknown): boolean {
  return (
    typeof state === 'object' &&
    state !== null &&
    ENTRY_OPENED_STATE in state &&
    state[ENTRY_OPENED_STATE] === true
  );
}

function withParam(params: URLSearchParams, name: string, value: string | null): URLSearchParams {
  const next = new URLSearchParams(params);
  if (value === null) {
    next.delete(name);
  } else {
    next.set(name, value);
  }
  return next;
}

/**
 * Reads and updates `/profile`'s search parameters. Updates keep every other parameter, and
 * invalid values fall back to the defaults.
 *
 * @param defaultView - The view to show without a valid `?view` (the theme's `default_view`).
 * @param today - Today's `yyyy-MM-dd` date, for the default month.
 * @returns The current values and their setters.
 */
export function useProfileParams(defaultView: DefaultView, today: string): ProfileParams {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const currentMonth = monthKeyOf(today);

  return {
    view: parseViewParam(searchParams.get(VIEW_PARAM)) ?? defaultView,
    month: parseMonthParam(searchParams.get(MONTH_PARAM)) ?? currentMonth,
    entryId: parseEntryParam(searchParams.get(ENTRY_PARAM)),
    setView: (view) => {
      setSearchParams((params) => withParam(params, VIEW_PARAM, view), { replace: true });
    },
    setMonth: (month) => {
      const value = month === currentMonth ? null : month;
      setSearchParams((params) => withParam(params, MONTH_PARAM, value), { replace: true });
    },
    openEntry: (id) => {
      setSearchParams((params) => withParam(params, ENTRY_PARAM, String(id)), {
        state: { [ENTRY_OPENED_STATE]: true },
      });
    },
    closeEntry: () => {
      if (openedInApp(location.state)) {
        void navigate(-1);
        return;
      }
      setSearchParams((params) => withParam(params, ENTRY_PARAM, null), { replace: true });
    },
  };
}
