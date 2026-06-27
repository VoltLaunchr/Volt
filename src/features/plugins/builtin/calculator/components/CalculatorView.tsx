import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalculatorPlugin } from '../index';
import { copyToClipboard } from '../../../utils/helpers';
import { addToHistory, clearHistory, getHistory, CalculationHistoryItem } from '../utils/history';
import { logger } from '../../../../../shared/utils/logger';
import { cn } from '@/lib/utils';
import { HighlightedExpression } from '../utils/highlight';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRightLeft,
  Calculator,
  Clipboard,
  Globe2,
  History,
  type LucideIcon,
} from 'lucide-react';

interface CalculatorViewProps {
  onClose: () => void;
  initialExpression?: string;
}

export function CalculatorView({
  onClose,
  initialExpression = '',
}: CalculatorViewProps): React.JSX.Element {
  const { t } = useTranslation('calculator');
  const [expression, setExpression] = useState(initialExpression);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<CalculationHistoryItem[]>([]);
  const [selectedHistoryIndex, setSelectedHistoryIndex] = useState(-1);
  const [calculationType, setCalculationType] = useState<
    'math' | 'unit' | 'date' | 'timezone' | null
  >(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const calculatorPlugin = useRef(new CalculatorPlugin());

  // Load history on mount
  useEffect(() => {
    setHistory(getHistory());
    inputRef.current?.focus();
  }, []);

  // Evaluate expression in real-time using the Calculator plugin
  useEffect(() => {
    const trimmed = expression.trim();
    if (!trimmed) {
      setResult(null);
      setError(null);
      setCalculationType(null);
      return;
    }

    try {
      // Use the plugin's match method to get results
      const results = calculatorPlugin.current.match({ query: trimmed });

      if (results && results.length > 0) {
        const firstResult = results[0];
        // Extract the formatted result from the plugin result
        const formatted = (firstResult.data?.formatted as string) || firstResult.title;
        setResult(formatted);
        setError(null);
        setCalculationType(
          (firstResult.data?.queryType as 'math' | 'unit' | 'date' | 'timezone') || null
        );
      } else {
        setResult(null);
        setError(null);
        setCalculationType(null);
      }
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : 'Calculation error');
      setCalculationType(null);
    }
  }, [expression]);

  // Copy result to clipboard and add to history
  const handleCopyResult = useCallback(async () => {
    if (!result || !expression.trim() || !calculationType) return;

    const success = await copyToClipboard(result);
    if (success) {
      logger.info(`✓ Copied to clipboard: ${result}`);

      addToHistory({
        query: expression.trim(),
        result,
        type: calculationType,
      });
      setHistory(getHistory());

      // Close view after successful copy
      onClose();
    }
  }, [result, expression, calculationType, onClose]);

  // Handle Enter key to copy result
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Enter' && result) {
        e.preventDefault();
        void handleCopyResult();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (selectedHistoryIndex < history.length - 1) {
          const newIndex = selectedHistoryIndex + 1;
          setSelectedHistoryIndex(newIndex);
          setExpression(history[newIndex].query);
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (selectedHistoryIndex > -1) {
          const newIndex = selectedHistoryIndex - 1;
          if (newIndex === -1) {
            setExpression('');
          } else {
            setExpression(history[newIndex].query);
          }
          setSelectedHistoryIndex(newIndex);
        }
      }
    },
    [result, history, selectedHistoryIndex, onClose, handleCopyResult]
  );

  // Load history item
  const handleSelectHistory = (item: CalculationHistoryItem) => {
    setExpression(item.query);
    inputRef.current?.focus();
  };

  // Clear history
  const handleClearHistory = () => {
    clearHistory();
    setHistory([]);
  };

  const quickActions: Array<{
    key: string;
    label: string;
    hint: string;
    glyph?: string;
    icon?: LucideIcon;
    action: () => void;
  }> = [
    {
      key: 'sqrt',
      label: t('view.quickActions.squareRoot'),
      hint: 'sqrt(',
      glyph: '√',
      action: () => setExpression('sqrt('),
    },
    {
      key: 'square',
      label: t('view.quickActions.square'),
      hint: '^2',
      glyph: 'x²',
      action: () => setExpression(expression + '^2'),
    },
    {
      key: 'convert',
      label: t('view.quickActions.convert'),
      hint: 'to',
      icon: ArrowRightLeft,
      action: () => setExpression(expression + ' to '),
    },
    {
      key: 'timezone',
      label: t('view.quickActions.timezone'),
      hint: 'time in',
      icon: Globe2,
      action: () => setExpression('time in '),
    },
  ];

  return (
    <div className="flex flex-col w-full h-full bg-canvas text-ink">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-hairline bg-surface shrink-0">
        <button
          type="button"
          className="inline-flex items-center justify-center w-[30px] h-[30px] rounded-md border border-hairline bg-surface-elevated text-mute hover:bg-surface hover:text-ink transition-colors shrink-0"
          onClick={onClose}
          aria-label="Back to search"
        >
          <ArrowLeft size={16} strokeWidth={2} />
        </button>
        <div className="flex-1 flex items-center gap-2 min-w-0">
          <span className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-accent-blue-soft text-accent-blue border border-hairline">
            <Calculator size={15} strokeWidth={2} aria-hidden="true" />
          </span>
          <span className="text-sm font-semibold tracking-[-0.2px] text-ink">
            {t('view.title')}
          </span>
        </div>
        {history.length > 0 && (
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-hairline bg-surface-elevated text-[11px] font-medium text-mute">
            <History size={12} strokeWidth={2} aria-hidden="true" />
            <span className="tabular-nums">{history.length}</span>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 grid min-h-0" style={{ gridTemplateRows: 'auto minmax(0, 1fr)' }}>
        {/* Calculator panel */}
        <section className="px-4 py-4 bg-surface border-b border-hairline">
          <div className="rounded-lg border border-hairline bg-canvas overflow-hidden shadow-[0_10px_30px_rgba(0,0,0,0.12)]">
            <div className="relative flex items-center min-h-[72px] px-4">
              <input
                ref={inputRef}
                type="text"
                className="w-full h-12 pr-3 text-[26px] leading-none font-mono font-medium tabular-nums bg-transparent border-0 text-ink outline-none transition-colors placeholder:text-stone placeholder:font-sans placeholder:text-base placeholder:font-normal"
                value={expression}
                onChange={(e) => {
                  setExpression(e.target.value);
                setSelectedHistoryIndex(-1);
              }}
              onKeyDown={handleKeyDown}
              placeholder={t('view.placeholder')}
                spellCheck={false}
                autoFocus
              />
            </div>

            <div className="border-t border-hairline bg-surface/80 min-h-[70px]">
              {error && (
                <div className="flex items-center gap-2 px-4 py-4 text-accent-red text-sm">
                  <AlertTriangle size={16} className="shrink-0" />
                  <span className="truncate">{error}</span>
                </div>
              )}
              {result && !error && (
                <div className="flex items-center justify-between gap-4 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] font-semibold text-stone uppercase tracking-[1.2px] mb-1">
                      {t('view.result')}
                    </div>
                    <div className="text-[28px] leading-tight font-mono font-semibold tabular-nums text-accent-blue break-all">
                      {result}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="inline-flex items-center justify-center w-9 h-9 bg-accent-blue text-white border-0 rounded-md shrink-0 hover:opacity-90 active:scale-95 transition-all disabled:opacity-50"
                    onClick={() => {
                      void handleCopyResult();
                    }}
                    title={t('view.copyResult')}
                    aria-label={t('view.copyResult')}
                  >
                    <Clipboard size={16} strokeWidth={2} />
                  </button>
                </div>
              )}
              {!result && !error && (
                <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm text-stone">
                  <span className="truncate">{t('view.historyHint')}</span>
                  <span className="hidden sm:inline text-[11px] px-2 py-1 rounded-md border border-hairline bg-canvas text-mute">
                    Enter
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Quick Actions */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
            {quickActions.map((action) => {
              const Icon = action.icon;
              return (
                <button
                  key={action.key}
                  type="button"
                  className="group flex items-center gap-2 min-w-0 h-11 px-3 border border-hairline rounded-md bg-canvas text-mute text-left hover:bg-surface-elevated hover:border-hairline-strong hover:text-ink transition-colors"
                  onClick={action.action}
                  title={action.label}
                  aria-label={action.label}
                >
                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-surface border border-hairline text-ink shrink-0 group-hover:text-accent-blue">
                    {Icon ? (
                      <Icon size={14} strokeWidth={2} aria-hidden="true" />
                    ) : (
                      <span className="text-[15px] font-mono font-semibold leading-none">
                        {action.glyph}
                      </span>
                    )}
                  </span>
                  <span className="min-w-0 flex flex-col leading-tight">
                    <span className="text-[12px] font-semibold truncate">{action.label}</span>
                    <span className="text-[10px] text-stone font-mono truncate">{action.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {/* History Section */}
        <section className="min-h-0 flex flex-col overflow-hidden">
          {history.length > 0 ? (
            <>
              <div className="flex items-center justify-between px-4 py-2.5 bg-canvas border-b border-hairline">
                <span className="inline-flex items-center gap-2 text-xs font-semibold text-stone uppercase tracking-wide">
                  <History size={14} strokeWidth={2} aria-hidden="true" />
                  {t('view.history')}
                </span>
                <button
                  type="button"
                  className="px-2.5 py-1 rounded-md text-stone text-xs font-medium hover:bg-surface-elevated hover:text-accent-red transition-colors"
                  onClick={handleClearHistory}
                >
                  {t('view.clear')}
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-2">
                {history.map((item, index) => (
                  <button
                    key={item.id}
                    type="button"
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2.5 rounded-md cursor-pointer transition-colors text-left border border-transparent',
                      selectedHistoryIndex === index
                        ? 'bg-accent-blue-soft border-hairline-strong'
                        : 'hover:bg-surface-elevated'
                    )}
                    onClick={() => handleSelectHistory(item)}
                  >
                    <div className="flex-1 min-w-0">
                      <HighlightedExpression
                        expression={item.query}
                        className="block text-sm font-mono truncate"
                      />
                      <span className="block text-[11px] font-medium text-stone uppercase mt-0.5">
                        {item.type}
                      </span>
                    </div>
                    <span className="text-base font-mono font-semibold text-accent-blue shrink-0 max-w-[45%] truncate">
                      = {item.result}
                    </span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center px-6 py-8">
              <div className="w-full max-w-[360px] flex items-center gap-3 px-4 py-3 rounded-lg border border-dashed border-hairline bg-surface/60 text-left">
                <span className="inline-flex items-center justify-center w-9 h-9 rounded-md bg-canvas border border-hairline text-stone shrink-0">
                  <History size={18} strokeWidth={1.8} aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-mute">{t('view.noHistory')}</div>
                  <div className="text-xs text-stone mt-1 truncate">{t('view.historyHint')}</div>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-center gap-6 px-4 py-2.5 border-t border-hairline bg-surface shrink-0">
        <div className="flex items-center gap-2 text-xs text-stone">
          <kbd className="px-1.5 py-0.5 bg-canvas border border-hairline rounded-xs font-mono text-xs font-medium">
            Enter
          </kbd>
          {t('view.footer.copy')}
        </div>
        <div className="flex items-center gap-2 text-xs text-stone">
          <kbd className="px-1.5 py-0.5 bg-canvas border border-hairline rounded-xs font-mono text-xs font-medium">
            ↑
          </kbd>
          <kbd className="px-1.5 py-0.5 bg-canvas border border-hairline rounded-xs font-mono text-xs font-medium">
            ↓
          </kbd>
          {t('view.footer.history')}
        </div>
        <div className="flex items-center gap-2 text-xs text-stone">
          <kbd className="px-1.5 py-0.5 bg-canvas border border-hairline rounded-xs font-mono text-xs font-medium">
            Esc
          </kbd>
          {t('view.footer.close')}
        </div>
      </div>
    </div>
  );
}
