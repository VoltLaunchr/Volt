import { describe, it, expect, beforeEach } from 'vitest';
import { useToastStore } from '../Toast';

describe('useToastStore', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
  });

  it('addToast adds a toast', () => {
    useToastStore.getState().addToast('Hello', 'info');
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].message).toBe('Hello');
    expect(toasts[0].type).toBe('info');
  });

  it('limits to 3 toasts max', () => {
    useToastStore.getState().addToast('One', 'info');
    useToastStore.getState().addToast('Two', 'info');
    useToastStore.getState().addToast('Three', 'info');
    useToastStore.getState().addToast('Four', 'info');
    expect(useToastStore.getState().toasts).toHaveLength(3);
    expect(useToastStore.getState().toasts[0].message).toBe('Two');
  });

  it('removeToast removes by id', () => {
    useToastStore.getState().addToast('Hello', 'info');
    const id = useToastStore.getState().toasts[0].id;
    useToastStore.getState().removeToast(id);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('default type is info', () => {
    useToastStore.getState().addToast('Test');
    expect(useToastStore.getState().toasts[0].type).toBe('info');
  });

  it('default duration is 5000', () => {
    useToastStore.getState().addToast('Test');
    expect(useToastStore.getState().toasts[0].duration).toBe(5000);
  });
});
