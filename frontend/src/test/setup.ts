import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { tokenStore } from '../lib/api';
import { resetMockState, server } from './api-mock';

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
  resetMockState();
  tokenStore.clear();
});
afterAll(() => server.close());
