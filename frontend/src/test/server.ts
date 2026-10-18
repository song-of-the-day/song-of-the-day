/**
 * The MSW server used by every test: the fake API plus the fake iTunes search. Unhandled requests
 * fail the test (see `setup.ts`).
 */
import { setupServer } from 'msw/node';

import { fakeApiHandlers, recordApiRequest } from './fakeApi';
import { itunesHandlers } from './fakeItunes';

export const server = setupServer(...fakeApiHandlers, ...itunesHandlers);

server.events.on('request:start', ({ request }) => {
  recordApiRequest(request);
});
