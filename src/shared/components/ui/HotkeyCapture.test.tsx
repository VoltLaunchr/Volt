import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { HotkeyCapture } from './HotkeyCapture';

function startRecording() {
  fireEvent.click(screen.getByRole('button'));
}

describe('HotkeyCapture', () => {
  it('renders placeholder when no value', () => {
    render(<HotkeyCapture value="" onChange={() => {}} />);
    expect(screen.getByText('Record Hotkey')).toBeInTheDocument();
  });

  it('renders the current value as kbd', () => {
    render(<HotkeyCapture value="ctrl+shift+space" onChange={() => {}} />);
    expect(screen.getByText('ctrl+shift+space')).toBeInTheDocument();
  });

  it('is disabled when disabled prop is true', () => {
    render(<HotkeyCapture value="" onChange={() => {}} disabled />);
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
  });

  it('enters recording mode when clicked', () => {
    render(<HotkeyCapture value="" onChange={() => {}} />);
    startRecording();
    expect(screen.getByText('Press your key combination...')).toBeInTheDocument();
  });

  it('captures Ctrl+Shift+Space and normalizes to "ctrl+shift+Space"', () => {
    const onChange = vi.fn();
    render(<HotkeyCapture value="" onChange={onChange} />);
    startRecording();

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: ' ',
          ctrlKey: true,
          shiftKey: true,
        })
      );
      document.dispatchEvent(
        new KeyboardEvent('keyup', {
          key: ' ',
          ctrlKey: true,
          shiftKey: true,
        })
      );
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    const captured = onChange.mock.calls[0][0];
    expect(captured).toContain('ctrl');
    expect(captured).toContain('shift');
    expect(captured).toContain('Space');
  });

  it('normalizes arrow keys', () => {
    const onChange = vi.fn();
    render(<HotkeyCapture value="" onChange={onChange} />);
    startRecording();

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowUp', ctrlKey: true, altKey: true })
      );
      document.dispatchEvent(
        new KeyboardEvent('keyup', { key: 'ArrowUp', ctrlKey: true, altKey: true })
      );
    });

    const captured = onChange.mock.calls[0][0];
    expect(captured).toContain('Up');
  });

  it('normalizes Enter to Return', () => {
    const onChange = vi.fn();
    render(<HotkeyCapture value="" onChange={onChange} />);
    startRecording();

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true })
      );
      document.dispatchEvent(
        new KeyboardEvent('keyup', { key: 'Enter', ctrlKey: true })
      );
    });

    expect(onChange.mock.calls[0][0]).toContain('Return');
  });

  it('rejects a main key without any modifier', () => {
    const onChange = vi.fn();
    const onError = vi.fn();
    render(<HotkeyCapture value="" onChange={onChange} onError={onError} />);
    startRecording();

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
      document.dispatchEvent(new KeyboardEvent('keyup', { key: 'a' }));
    });

    expect(onChange).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalled();
  });

  it('cancel button exits recording mode', () => {
    render(<HotkeyCapture value="" onChange={() => {}} />);
    startRecording();
    const cancel = screen.getByLabelText('Cancel recording');
    fireEvent.click(cancel);
    expect(screen.getByText('Record Hotkey')).toBeInTheDocument();
  });

  it('uppercases single letter keys', () => {
    const onChange = vi.fn();
    render(<HotkeyCapture value="" onChange={onChange} />);
    startRecording();

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'k', ctrlKey: true })
      );
      document.dispatchEvent(
        new KeyboardEvent('keyup', { key: 'k', ctrlKey: true })
      );
    });

    expect(onChange.mock.calls[0][0]).toContain('K');
  });
});
