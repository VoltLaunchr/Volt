import { type Plugin, type PluginContext, type PluginResult, PluginResultType } from '../../types';
import { fuzzyScore } from '../../utils/helpers';
import { aiQuickActionsService, type AiQuickAction } from '../../../ai-quick-actions';
import { logger } from '../../../../shared/utils/logger';
import { AI_PRESETS } from './presets';

/** Minimum fuzzy score to surface a quick action in the launcher. */
const QUICK_ACTION_MIN_SCORE = 30;

/** Refresh cached quick actions every 30 s so user edits propagate without restart. */
const QUICK_ACTIONS_REFRESH_MS = 30_000;

export class AiChatPlugin implements Plugin {
  id = 'aichat';
  name = 'AI';
  description = 'Ask AI anything, compose text, explain code';
  enabled = true;

  /** In-memory cache of user-defined AI Quick Actions. Refreshed lazily. */
  private quickActions: AiQuickAction[] = [];
  private lastLoadedAt = 0;
  private loadingPromise: Promise<void> | null = null;

  /**
   * Kick off a background reload of the quick-actions cache.
   * Never throws — failures are logged and leave the previous cache intact.
   * Returns immediately; callers must not await for fast-path matching.
   */
  private ensureQuickActionsLoaded(): void {
    const now = Date.now();
    if (this.loadingPromise) return;
    if (this.lastLoadedAt !== 0 && now - this.lastLoadedAt < QUICK_ACTIONS_REFRESH_MS) return;

    this.loadingPromise = aiQuickActionsService
      .list()
      .then((actions) => {
        this.quickActions = actions;
        this.lastLoadedAt = Date.now();
      })
      .catch((err) => {
        logger.error('AiChatPlugin: failed to load AI quick actions', err);
        // Still bump lastLoadedAt to avoid hammering the backend on persistent failure.
        this.lastLoadedAt = Date.now();
      })
      .finally(() => {
        this.loadingPromise = null;
      });
  }

  canHandle(ctx: PluginContext): boolean {
    const q = ctx.query.trim().toLowerCase();
    if (!q) return false;
    if (
      q === 'ai' ||
      q.startsWith('ai ') ||
      q.startsWith('ai:') ||
      (q.startsWith('?') && q.length > 1 && q !== '?')
    ) {
      return true;
    }
    // Opportunistic: any query of ≥ 2 non-whitespace chars may match a Quick Action label.
    return q.length >= 2;
  }

  match(ctx: PluginContext): PluginResult[] | null {
    // Trigger a background refresh on every match() call; the check is cheap and
    // throttled internally so it's safe to call on every keystroke.
    this.ensureQuickActionsLoaded();

    const q = ctx.query.trim();
    const lq = q.toLowerCase();

    const isAiPrefix = lq === 'ai' || lq.startsWith('ai ') || lq.startsWith('ai:');
    const isQuestionPrefix = lq.startsWith('?') && q.length > 1;

    let userQuery = '';
    if (lq.startsWith('ai:')) userQuery = q.slice(3).trim();
    else if (lq.startsWith('ai ')) userQuery = q.slice(3).trim();
    else if (isQuestionPrefix) userQuery = q.slice(1).trim();

    // Bare "ai" / "ai:" / "?" with nothing after — open chat blank.
    if (isAiPrefix && !userQuery) {
      return [
        {
          id: 'aichat-open',
          type: PluginResultType.AiChat,
          title: 'Open AI Chat',
          subtitle: 'Ask anything, compose text, explain code',
          icon: '/icons/app/ai_icon.svg',
          score: 100,
          data: { query: '', systemPrompt: undefined },
        },
      ];
    }

    // If user typed an AI prefix with text, surface the "Ask AI" + presets + matching quick actions.
    if (isAiPrefix || isQuestionPrefix) {
      if (!userQuery) return null;

      const shortQuery = userQuery.length > 60 ? `${userQuery.slice(0, 60)}…` : userQuery;

      const results: PluginResult[] = [
        {
          id: 'aichat-ask',
          type: PluginResultType.AiChat,
          title: `Ask AI: ${userQuery}`,
          subtitle: 'One-shot answer · Press Enter',
          icon: '/icons/app/ai_icon.svg',
          score: 100,
          data: { query: userQuery, systemPrompt: undefined, mode: 'quick' },
        },
        {
          id: 'aichat-ask-chat',
          type: PluginResultType.AiChat,
          title: 'Open in AI Chat',
          subtitle: shortQuery,
          icon: '/icons/app/ai_icon.svg',
          score: 96,
          data: { query: userQuery, systemPrompt: undefined, mode: 'chat' },
        },
      ];

      for (const preset of AI_PRESETS) {
        results.push({
          id: `aichat-preset-${preset.id}`,
          type: PluginResultType.AiChat,
          title: preset.label,
          subtitle: shortQuery,
          icon: '/icons/app/ai_icon.svg',
          badge: 'AI',
          score: 85,
          section: 'AI Commands',
          data: { query: userQuery, systemPrompt: preset.system },
        });
      }

      // Also include matching user-defined Quick Actions, pre-loaded with the user's text.
      for (const qa of this.quickActions) {
        if (!qa.enabled) continue;
        const s = fuzzyScore(userQuery, qa.label);
        if (s < QUICK_ACTION_MIN_SCORE) continue;
        results.push(this.buildQuickActionResult(qa, userQuery, s));
      }

      return results;
    }

    // No AI prefix — opportunistic fuzzy match against Quick Action labels only.
    if (q.length < 2 || this.quickActions.length === 0) return null;

    const results: PluginResult[] = [];
    for (const qa of this.quickActions) {
      if (!qa.enabled) continue;
      const s = fuzzyScore(q, qa.label);
      if (s < QUICK_ACTION_MIN_SCORE) continue;
      // No user text yet — empty query so the chat view opens ready for input.
      results.push(this.buildQuickActionResult(qa, '', s));
    }

    return results.length > 0 ? results : null;
  }

  /** Build a `PluginResult` for a matched user-defined AI Quick Action. */
  private buildQuickActionResult(
    qa: AiQuickAction,
    query: string,
    score: number
  ): PluginResult {
    const prompt = qa.systemPrompt ?? '';
    const subtitle = prompt.length > 80 ? `${prompt.slice(0, 80)}…` : prompt;
    return {
      id: `aichat-quickaction-${qa.id}`,
      type: PluginResultType.AiChat,
      title: qa.label,
      subtitle,
      icon: '/icons/app/ai_icon.svg',
      badge: 'AI Command',
      score: 70 + score * 0.3,
      section: 'AI Commands',
      data: {
        query,
        systemPrompt: qa.systemPrompt,
        quickActionId: qa.id,
      },
    };
  }

  execute(result: PluginResult): void {
    const data = result.data as {
      query: string;
      systemPrompt?: string;
      mode?: 'quick' | 'chat';
    };
    // Quick AI mode requires a non-empty query (it's one-shot, can't open empty).
    // Default: Chat mode (handles empty query → opens blank chat ready for input).
    const useQuickAi = data.mode === 'quick' && !!data.query?.trim();
    const eventName = useQuickAi ? 'volt:open-quick-ai' : 'volt:open-ai-chat';
    window.dispatchEvent(
      new CustomEvent(eventName, {
        detail: { query: data.query ?? '', systemPrompt: data.systemPrompt },
      })
    );
  }
}

export { AiChatView } from './components/AiChatView';
export { QuickAiView } from './components/QuickAiView';
