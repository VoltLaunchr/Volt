import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import settingsCapability from '../../../../src-tauri/capabilities/settings.json';
import { GamesPage } from './GamesPage';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      options?.count === undefined ? key : `${key}:${options.count}`,
  }),
}));
vi.mock('../../../shared/utils/logger', () => ({ logger: { error: vi.fn() } }));

const ea = { id: 'ea', name: 'EA App', icon: 'EA', isInstalled: true, gameCount: 1 };
const pluginState = { enabled: true, onToggle: vi.fn() };

describe('game settings capability and library', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockImplementation((command) => {
      // Use the real window capability: a launcher-only grant must not make this test pass.
      const permission = `allow-${command.replaceAll('_', '-')}`;
      if (!settingsCapability.permissions.includes(permission)) {
        return Promise.reject(new Error(`${command} not allowed for window settings`));
      }
      if (command === 'get_game_platforms') return Promise.resolve([ea]);
      if (command === 'rescan_all_games') return Promise.resolve(1);
      return Promise.reject(new Error(`Unexpected command: ${command}`));
    });
  });

  it('grants library inspection and rescan without granting game launch', () => {
    expect(settingsCapability.windows).toEqual(['settings']);
    expect(settingsCapability.permissions).toContain('allow-get-game-platforms');
    expect(settingsCapability.permissions).toContain('allow-rescan-all-games');
    expect(settingsCapability.permissions).not.toContain('allow-launch-game');
  });

  it('shows EA App and its game count in the settings window', async () => {
    render(<GamesPage pluginState={pluginState} />);
    expect(await screen.findByText('EA App')).toBeInTheDocument();
    expect(screen.getByText('games.gameCount:1')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('rescans and refreshes the platform counts using the settings permissions', async () => {
    render(<GamesPage pluginState={pluginState} />);
    await screen.findByText('EA App');
    fireEvent.click(screen.getByRole('button', { name: 'games.rescanAction' }));
    expect(await screen.findByText('games.rescanned:1')).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith('rescan_all_games');
    expect(
      vi.mocked(invoke).mock.calls.filter(([command]) => command === 'get_game_platforms')
    ).toHaveLength(2);
  });

  it('recovers a failed platform read when retry succeeds', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('Temporary failure'));
    render(<GamesPage pluginState={pluginState} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('games.loadFailed');
    fireEvent.click(screen.getByRole('button', { name: 'navigation.retry' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(await screen.findByText('EA App')).toBeInTheDocument();
  });
});
