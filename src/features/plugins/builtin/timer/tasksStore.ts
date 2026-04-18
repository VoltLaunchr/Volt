/**
 * Pomodoro task list store — localStorage-backed, subscribable.
 */

import { logger } from '../../../../shared/utils/logger';

const STORAGE_KEY = 'volt-pomodoro-tasks';

export interface PomodoroTask {
  id: string;
  label: string;
  done: boolean;
  createdAt: number;
}

type Listener = (tasks: PomodoroTask[]) => void;

class TasksStore {
  private tasks: PomodoroTask[] = [];
  private listeners = new Set<Listener>();

  constructor() {
    this.restore();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const l of this.listeners) l(this.tasks);
  }

  getTasks(): PomodoroTask[] {
    return this.tasks;
  }

  add(label: string): void {
    const trimmed = label.trim();
    if (!trimmed) return;
    this.tasks = [
      ...this.tasks,
      {
        id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        label: trimmed,
        done: false,
        createdAt: Date.now(),
      },
    ];
    this.persist();
    this.emit();
  }

  toggle(id: string): void {
    this.tasks = this.tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t));
    this.persist();
    this.emit();
  }

  remove(id: string): void {
    this.tasks = this.tasks.filter((t) => t.id !== id);
    this.persist();
    this.emit();
  }

  clearCompleted(): void {
    this.tasks = this.tasks.filter((t) => !t.done);
    this.persist();
    this.emit();
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.tasks));
    } catch {
      // ignore
    }
  }

  private restore(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) this.tasks = parsed;
    } catch (err) {
      logger.warn('Failed to restore pomodoro tasks', err);
    }
  }
}

export const tasksStore = new TasksStore();
