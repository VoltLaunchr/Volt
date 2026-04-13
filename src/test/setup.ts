import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async () => undefined),
}));

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn(async () => undefined),
}));

vi.mock('i18next', () => ({
  default: {
    addResourceBundle: vi.fn(),
    use: vi.fn().mockReturnThis(),
    init: vi.fn(),
    t: vi.fn((key: string) => key),
    changeLanguage: vi.fn(),
  },
}));
