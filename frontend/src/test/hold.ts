/**
 * Holds an API response open, to test what the UI does while a request is in flight.
 *
 * ```ts
 * const held = holdRequest('post', '/api/auth/login', () => apiErrorResponse(429, ...));
 * // ...submit, assert the pending UI...
 * held.release();
 * ```
 */
import { http } from 'msw';

import { server } from './server';

export interface HeldRequest {
  /** How many requests reached the handler. */
  readonly calls: number;
  /** Lets every waiting request answer. */
  release(): void;
}

/**
 * Overrides a route so its requests wait until released.
 *
 * @param method - The HTTP method.
 * @param path - The request path (an MSW path pattern).
 * @param respond - Builds the response once released.
 * @returns A handle to count calls and release them.
 */
export function holdRequest(
  method: 'get' | 'post' | 'patch' | 'delete',
  path: string,
  respond: () => Response,
): HeldRequest {
  const waiting: (() => void)[] = [];
  let released = false;
  let calls = 0;
  server.use(
    http[method](path, async () => {
      calls += 1;
      if (!released) {
        await new Promise<void>((resolve) => {
          waiting.push(resolve);
        });
      }
      return respond();
    }),
  );
  return {
    get calls() {
      return calls;
    },
    release() {
      released = true;
      for (const resolve of waiting.splice(0)) {
        resolve();
      }
    },
  };
}
