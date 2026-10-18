/**
 * Browser APIs that jsdom lacks but components use. Each is installed only when missing, except
 * media playback, which jsdom implements as "not implemented" errors.
 */
import { MockIntersectionObserver } from './observers';

class MockResizeObserver implements ResizeObserver {
  observe(): void {
    // Layout never changes in jsdom, so there is nothing to report.
  }

  unobserve(): void {
    // See observe().
  }

  disconnect(): void {
    // See observe().
  }
}

type MaybeGlobals = Partial<
  Pick<typeof globalThis, 'matchMedia' | 'IntersectionObserver' | 'ResizeObserver'>
>;
type MaybeElement = Partial<
  Pick<
    Element,
    'scrollIntoView' | 'hasPointerCapture' | 'setPointerCapture' | 'releasePointerCapture'
  >
>;

function matchMedia(query: string): MediaQueryList {
  return {
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  };
}

/** Installs the polyfills on the jsdom globals. */
export function installPolyfills(): void {
  // In Vitest's jsdom environment `window` is `globalThis`.
  const existing: MaybeGlobals = globalThis;
  if (existing.matchMedia === undefined) {
    globalThis.matchMedia = matchMedia;
  }
  if (existing.IntersectionObserver === undefined) {
    globalThis.IntersectionObserver = MockIntersectionObserver;
  }
  if (existing.ResizeObserver === undefined) {
    globalThis.ResizeObserver = MockResizeObserver;
  }
  const element: MaybeElement = Element.prototype;
  if (element.scrollIntoView === undefined) {
    Element.prototype.scrollIntoView = () => undefined;
  }
  if (element.hasPointerCapture === undefined) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (element.setPointerCapture === undefined) {
    Element.prototype.setPointerCapture = () => undefined;
  }
  if (element.releasePointerCapture === undefined) {
    Element.prototype.releasePointerCapture = () => undefined;
  }
  // jsdom logs "not implemented" for media playback; behave like a muted, paused element.
  HTMLMediaElement.prototype.play = () => Promise.resolve();
  HTMLMediaElement.prototype.pause = () => undefined;
  HTMLMediaElement.prototype.load = () => undefined;
}
