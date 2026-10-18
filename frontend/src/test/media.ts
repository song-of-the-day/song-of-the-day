/**
 * A controllable `window.matchMedia` for tests of responsive components.
 *
 * ```ts
 * const media = mockMatchMedia((query) => query === WIDE_VIEWPORT_QUERY);
 * media.update(() => false); // the viewport just became narrow
 * ```
 *
 * The stub is a Vitest global stub, so `unstubGlobals` removes it after each test.
 */
import { vi } from 'vitest';

/** Decides whether a media query matches. */
export type MediaEvaluator = (query: string) => boolean;

export interface MediaController {
  /** Re-evaluates every query and notifies the lists whose result changed. */
  update(evaluate: MediaEvaluator): void;
}

type ChangeListener = (event: MediaQueryListEvent) => void;

interface FakeList {
  query: string;
  matches: boolean;
  /** Registered listeners, keyed by what the caller passed. */
  listeners: Map<EventListenerOrEventListenerObject, ChangeListener>;
}

function toListener(listener: EventListenerOrEventListenerObject | null): ChangeListener | null {
  if (listener === null) {
    return null;
  }
  return typeof listener === 'function'
    ? (event) => {
        listener(event);
      }
    : (event) => {
        listener.handleEvent(event);
      };
}

/**
 * Replaces `window.matchMedia` with a fake whose results come from `evaluate`.
 *
 * @param evaluate - The initial matcher.
 * @returns A controller to change the results later.
 */
export function mockMatchMedia(evaluate: MediaEvaluator): MediaController {
  let current = evaluate;
  const lists: FakeList[] = [];

  function matchMedia(query: string): MediaQueryList {
    const state: FakeList = { query, matches: current(query), listeners: new Map() };
    lists.push(state);
    const list: MediaQueryList = {
      get matches() {
        return current(query);
      },
      media: query,
      onchange: null,
      addEventListener: (_type: string, listener: EventListenerOrEventListenerObject | null) => {
        const wrapped = toListener(listener);
        if (listener !== null && wrapped !== null) {
          state.listeners.set(listener, wrapped);
        }
      },
      removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject | null) => {
        if (listener !== null) {
          state.listeners.delete(listener);
        }
      },
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    };
    return list;
  }

  vi.stubGlobal('matchMedia', matchMedia);

  return {
    update(next) {
      current = next;
      for (const list of lists) {
        const matches = next(list.query);
        if (matches !== list.matches) {
          list.matches = matches;
          const event = new Event('change') as MediaQueryListEvent;
          Object.defineProperties(event, {
            matches: { value: matches },
            media: { value: list.query },
          });
          for (const listener of list.listeners.values()) {
            listener(event);
          }
        }
      }
    },
  };
}
