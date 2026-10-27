import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApplicationIcon } from './ApplicationIcon';

const load = vi.hoisted(() => vi.fn());
vi.mock('../../services/appIconService', () => ({ loadAppIcon: load }));

describe('visible application icons', () => {
  it('ignores a slow old result after the row changes application', async () => {
    let resolveOld!: (value: string) => void;
    load
      .mockReturnValueOnce(
        new Promise<string>((resolve) => {
          resolveOld = resolve;
        })
      )
      .mockResolvedValueOnce('data:image/png;base64,new');
    const { rerender } = render(<ApplicationIcon path="old.exe" />);
    rerender(<ApplicationIcon path="new.exe" />);
    await waitFor(() =>
      expect(screen.getByRole('presentation')).toHaveAttribute('src', 'data:image/png;base64,new')
    );
    act(() => {
      resolveOld('data:image/png;base64,old');
    });
    expect(screen.getByRole('presentation')).toHaveAttribute('src', 'data:image/png;base64,new');
  });
});
