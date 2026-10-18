/**
 * A controllable `IntersectionObserver` for jsdom (which has none). `setup.ts` installs it;
 * tests call {@link triggerIntersection} to simulate an element scrolling into view.
 */

export class MockIntersectionObserver implements IntersectionObserver {
  static readonly instances = new Set<MockIntersectionObserver>();

  readonly root: Element | Document | null;
  readonly rootMargin: string;
  readonly thresholds: readonly number[];
  readonly scrollMargin = '0px';
  readonly targets = new Set<Element>();
  private readonly callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback, options: IntersectionObserverInit = {}) {
    this.callback = callback;
    this.root = options.root ?? null;
    this.rootMargin = options.rootMargin ?? '0px';
    const { threshold = 0 } = options;
    this.thresholds = Array.isArray(threshold) ? threshold : [threshold];
    MockIntersectionObserver.instances.add(this);
  }

  observe(target: Element): void {
    this.targets.add(target);
  }

  unobserve(target: Element): void {
    this.targets.delete(target);
  }

  disconnect(): void {
    this.targets.clear();
    MockIntersectionObserver.instances.delete(this);
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  /** Delivers an entry for `target` to this observer's callback. */
  fire(target: Element, isIntersecting: boolean): void {
    const rect = target.getBoundingClientRect();
    const entry: IntersectionObserverEntry = {
      target,
      isIntersecting,
      intersectionRatio: isIntersecting ? 1 : 0,
      boundingClientRect: rect,
      intersectionRect: rect,
      rootBounds: null,
      time: performance.now(),
    };
    this.callback([entry], this);
  }
}

/**
 * Simulates `target` entering (or leaving) the viewport for every observer watching it.
 *
 * @param target - The observed element.
 * @param isIntersecting - Whether it is now visible.
 */
export function triggerIntersection(target: Element, isIntersecting = true): void {
  for (const observer of MockIntersectionObserver.instances) {
    if (observer.targets.has(target)) {
      observer.fire(target, isIntersecting);
    }
  }
}
