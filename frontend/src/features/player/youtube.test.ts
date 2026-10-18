import { afterEach, describe, expect, it, vi } from 'vitest';

import type { YouTubeIframeApi } from './youtube';

const SCRIPT_SELECTOR = 'script[src="https://www.youtube.com/iframe_api"]';

/** Imports a fresh copy of the loader, so each test starts without a cached promise. */
async function freshLoader() {
  vi.resetModules();
  return import('./youtube');
}

function injectedScripts(): HTMLScriptElement[] {
  return [...document.querySelectorAll<HTMLScriptElement>(SCRIPT_SELECTOR)];
}

function fakeApi(): YouTubeIframeApi {
  return { loaded: 1, Player: vi.fn() };
}

/** What YouTube's script does once it has loaded. */
function announceReady(api: YouTubeIframeApi = fakeApi()): YouTubeIframeApi {
  vi.stubGlobal('YT', api);
  window.onYouTubeIframeAPIReady?.();
  return api;
}

afterEach(() => {
  vi.useRealTimers();
  for (const script of injectedScripts()) {
    script.remove();
  }
  delete window.onYouTubeIframeAPIReady;
});

describe('loadYouTubeIframeApi', () => {
  it('injects the API script once and resolves every caller when YouTube is ready', async () => {
    const { loadYouTubeIframeApi } = await freshLoader();

    const first = loadYouTubeIframeApi();
    const second = loadYouTubeIframeApi();

    expect(second).toBe(first);
    expect(injectedScripts()).toHaveLength(1);
    expect(injectedScripts()[0]?.async).toBe(true);

    const api = announceReady();

    await expect(first).resolves.toBe(api);
    await expect(second).resolves.toBe(api);
  });

  it('resolves at once without a script when the API is already loaded', async () => {
    const { loadYouTubeIframeApi } = await freshLoader();
    const api = fakeApi();
    vi.stubGlobal('YT', api);

    await expect(loadYouTubeIframeApi()).resolves.toBe(api);
    expect(injectedScripts()).toHaveLength(0);
  });

  it('keeps calling a ready handler that was installed before it', async () => {
    const { loadYouTubeIframeApi } = await freshLoader();
    const previous = vi.fn();
    window.onYouTubeIframeAPIReady = previous;

    const loading = loadYouTubeIframeApi();
    const api = announceReady();

    await expect(loading).resolves.toBe(api);
    expect(previous).toHaveBeenCalledTimes(1);
  });

  it('rejects when the script fails to load, then injects it again on the next call', async () => {
    const { loadYouTubeIframeApi, YouTubeLoadError } = await freshLoader();

    const failing = loadYouTubeIframeApi();
    injectedScripts()[0]?.dispatchEvent(new Event('error'));

    await expect(failing).rejects.toBeInstanceOf(YouTubeLoadError);
    expect(injectedScripts()).toHaveLength(0);

    const retry = loadYouTubeIframeApi();

    expect(retry).not.toBe(failing);
    expect(injectedScripts()).toHaveLength(1);
    const api = announceReady();
    await expect(retry).resolves.toBe(api);
  });

  it('rejects after 10 seconds without a ready call and allows a retry', async () => {
    vi.useFakeTimers();
    const { loadYouTubeIframeApi, LOAD_TIMEOUT_MS } = await freshLoader();

    const waiting = loadYouTubeIframeApi();
    const outcome = waiting.then(
      () => 'resolved',
      (error: unknown) => (error instanceof Error ? error.message : 'rejected'),
    );
    vi.advanceTimersByTime(LOAD_TIMEOUT_MS - 1);
    await Promise.resolve();
    expect(injectedScripts()).toHaveLength(1);

    vi.advanceTimersByTime(1);

    await expect(outcome).resolves.toBe('The YouTube player API did not load in time.');
    expect(injectedScripts()).toHaveLength(0);
    expect(loadYouTubeIframeApi()).not.toBe(waiting);
    expect(injectedScripts()).toHaveLength(1);
  });

  it('ignores a late ready call after a timeout', async () => {
    vi.useFakeTimers();
    const { loadYouTubeIframeApi, LOAD_TIMEOUT_MS } = await freshLoader();

    const waiting = loadYouTubeIframeApi();
    const settled = waiting.catch((error: unknown) => error);
    vi.advanceTimersByTime(LOAD_TIMEOUT_MS);

    expect(() => announceReady()).not.toThrow();
    expect(await settled).toBeInstanceOf(Error);
  });

  it('rejects when YouTube reports ready without defining YT', async () => {
    const { loadYouTubeIframeApi } = await freshLoader();

    const loading = loadYouTubeIframeApi();
    window.onYouTubeIframeAPIReady?.();

    await expect(loading).rejects.toThrow('reported ready without defining YT');
  });
});
