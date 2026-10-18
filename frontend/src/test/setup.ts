/**
 * Vitest setup: jest-dom matchers, jsdom polyfills, the MSW server lifecycle and per-test resets.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll } from 'vitest';

import { clearCsrfToken } from '@/api/client';

import { fakeApi } from './fakeApi';
import { MockIntersectionObserver } from './observers';
import { installPolyfills } from './polyfills';
import { server } from './server';

installPolyfills();

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  cleanup();
  server.resetHandlers();
  fakeApi.reset();
  clearCsrfToken();
  MockIntersectionObserver.instances.clear();
});

afterAll(() => {
  server.close();
});
