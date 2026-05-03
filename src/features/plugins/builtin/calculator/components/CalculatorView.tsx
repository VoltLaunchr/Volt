import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalculatorPlugin } from '../index';
import { copyToClipboard } from '../../../utils/helpers';
import { addToHistory, clearHistory, getHistory, CalculationHistoryItem } from '../utils/history';
import { cn } from '@/lib/utils';

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
      console.log(`✓ Copied to clipboard: ${result}`);

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
        handleCopyResult();
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

  return (
    <div className="flex flex-col w-full h-full bg-canvas text-ink">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-hairline bg-surface">
        <button
          className="flex items-center justify-center w-8 h-8 rounded-md text-mute hover:bg-surface-elevated hover:text-ink transition-colors shrink-0"
          onClick={onClose}
          aria-label="Back"
        >
          ←
        </button>
        <span className="flex-1 text-base font-semibold text-ink">{t('view.title')}</span>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Input Section */}
        <div className="px-4 py-4 bg-surface">
          <div className="relative">
            <input
              ref={inputRef}
              type="text"
              className="w-full h-12 px-4 text-xl font-mono font-medium bg-canvas border border-hairline rounded-md text-ink outline-none transition-colors focus:border-hairline-strong focus:bg-surface placeholder:text-stone placeholder:font-sans placeholder:text-base placeholder:font-normal"
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

          {/* Result Display */}
          <div className="mt-3 min-h-14">
            {error && (
              <div className="flex items-center gap-2 px-4 py-3 bg-[rgba(239,68,68,0.1)] border border-[rgba(239,68,68,0.3)] rounded-md text-accent-red text-sm">
                <span className="text-base">⚠</span>
                {error}
              </div>
            )}
            {result && !error && (
              <div className="flex items-center justify-between px-4 py-3 bg-surface-elevated border border-hairline-strong rounded-md">
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-stone uppercase tracking-wide mb-1">
                    {t('view.result')}
                  </div>
                  <div className="text-xl font-mono font-bold text-accent-blue break-all">
                    {result}
                  </div>
                </div>
                <button
                  className="flex items-center gap-2 px-3 py-2 bg-accent-blue-soft border border-[rgba(87,193,255,0.3)] rounded-md text-accent-blue text-sm font-semibold shrink-0 hover:bg-[rgba(87,193,255,0.25)] transition-colors"
                  onClick={handleCopyResult}
                  title={t('view.copyResult')}
                >
                  <span className="text-base">📋</span>
                  {t('view.copy')}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-4 gap-2 px-4 py-3 border-b border-hairline bg-canvas">
          <button
            className="flex flex-col items-center gap-1 py-3 px-2 border border-hairline rounded-md text-mute text-xs hover:bg-surface-elevated hover:border-hairline-strong hover:text-ink transition-colors"
            onClick={() => setExpression('sqrt(')}
          >
            <span className="text-base">√</span>
            <span className="font-medium">{t('view.quickActions.squareRoot')}</span>
          </button>
          <button
            className="flex flex-col items-center gap-1 py-3 px-2 border border-hairline rounded-md text-mute text-xs hover:bg-surface-elevated hover:border-hairline-strong hover:text-ink transition-colors"
            onClick={() => setExpression(expression + '^2')}
          >
            <span className="text-base">x²</span>
            <span className="font-medium">{t('view.quickActions.square')}</span>
          </button>
          <button
            className="flex flex-col items-center gap-1 py-3 px-2 border border-hairline rounded-md text-mute text-xs hover:bg-surface-elevated hover:border-hairline-strong hover:text-ink transition-colors"
            onClick={() => setExpression(expression + ' to ')}
          >
            <span className="text-base">⟷</span>
            <span className="font-medium">{t('view.quickActions.convert')}</span>
          </button>
          <button
            className="flex flex-col items-center gap-1 py-3 px-2 border border-hairline rounded-md text-mute text-xs hover:bg-surface-elevated hover:border-hairline-strong hover:text-ink transition-colors"
            onClick={() => setExpression('time in ')}
          >
            <span className="text-base">🌍</span>
            <span className="font-medium">{t('view.quickActions.timezone')}</span>
          </button>
        </div>

        {/* History Section */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {history.length > 0 ? (
            <>
              <div className="flex items-center justify-between px-4 py-2 bg-surface border-b border-hairline">
                <span className="text-xs font-semibold text-stone uppercase tracking-wide">
                  {t('view.history')}
                </span>
                <button
                  className="px-2 py-1 rounded-sm text-stone text-xs font-medium hover:bg-surface-elevated hover:text-accent-red transition-colors"
                  onClick={handleClearHistory}
                >
                  {t('view.clear')}
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-2">
                {history.map((item, index) => (
                  <div
                    key={item.id}
                    className={cn(
                      'flex items-center gap-3 px-3 py-3 rounded-md cursor-pointer transition-colors',
                      selectedHistoryIndex === index
                        ? 'bg-accent-blue-soft'
                        : 'hover:bg-surface-elevated'
                    )}
                    onClick={() => handleSelectHistory(item)}
                  >
                    <div className="flex-1 min-w-0 flex items-center gap-3">
                      <span className="flex-1 text-sm font-mono text-ink truncate">
                        {item.query}
                      </span>
                      <span className="text-sm font-mono font-semibold text-accent-blue shrink-0">
                        = {item.result}
                      </span>
                    </div>
                    <span className="text-xs font-medium text-stone uppercase px-2 py-1 bg-surface rounded-sm shrink-0">
                      {item.type}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center px-8 py-8 text-stone">
              <div className="mb-3 opacity-50">
                <img src="/icons/history-stroke-rounded.svg" alt="History" width="48" height="48" />
              </div>
              <div className="text-sm font-medium text-center text-mute">{t('view.noHistory')}</div>
              <div className="text-xs text-stone mt-2">{t('view.historyHint')}</div>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-center gap-6 px-4 py-3 border-t border-hairline bg-surface">
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
