import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CalculatorPlugin } from '../index';
import { copyToClipboard } from '../../../utils/helpers';
import { addToHistory, clearHistory, getHistory, CalculationHistoryItem } from '../utils/history';
import './CalculatorView.css';

interface CalculatorViewProps {
  onClose: () => void;
  initialExpression?: string;
}

export const CalculatorView: React.FC<CalculatorViewProps> = ({
  onClose,
  initialExpression = '',
}) => {
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
    <div className="calculator-view">
      {/* Header */}
      <div className="calculator-header">
        <button className="back-button" onClick={onClose} aria-label="Back">
          ←
        </button>
        <span className="calculator-title">Calculator</span>
      </div>

      {/* Content */}
      <div className="calculator-content">
        {/* Input Section */}
        <div className="calculator-input-section">
          <div className="calculator-input-wrapper">
            <input
              ref={inputRef}
              type="text"
              className="calculator-input"
              value={expression}
              onChange={(e) => {
                setExpression(e.target.value);
                setSelectedHistoryIndex(-1);
              }}
              onKeyDown={handleKeyDown}
              placeholder="Type a calculation..."
              spellCheck={false}
              autoFocus
            />
          </div>

          {/* Result Display */}
          <div className="calculator-result">
            {error && (
              <div className="calculator-error">
                <span className="calculator-error-icon">⚠</span>
                {error}
              </div>
            )}
            {result && !error && (
              <div className="calculator-result-container">
                <div className="result-content">
                  <div className="result-label">Result</div>
                  <div className="result-value">{result}</div>
                </div>
                <button
                  className="copy-button"
                  onClick={handleCopyResult}
                  title="Copy result (Enter)"
                >
                  <span className="copy-button-icon">📋</span>
                  Copy
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="calculator-quick-actions">
          <button className="quick-action" onClick={() => setExpression('sqrt(')}>
            <span className="quick-action-icon">√</span>
            <span className="quick-action-label">Square Root</span>
          </button>
          <button className="quick-action" onClick={() => setExpression(expression + '^2')}>
            <span className="quick-action-icon">x²</span>
            <span className="quick-action-label">Square</span>
          </button>
          <button className="quick-action" onClick={() => setExpression(expression + ' to ')}>
            <span className="quick-action-icon">⟷</span>
            <span className="quick-action-label">Convert</span>
          </button>
          <button className="quick-action" onClick={() => setExpression('time in ')}>
            <span className="quick-action-icon">🌍</span>
            <span className="quick-action-label">Timezone</span>
          </button>
        </div>

        {/* History Section */}
        <div className="calculator-history">
          {history.length > 0 ? (
            <>
              <div className="history-header">
                <span className="history-title">History</span>
                <button className="clear-history-button" onClick={handleClearHistory}>
                  Clear
                </button>
              </div>
              <div className="history-list">
                {history.map((item, index) => (
                  <div
                    key={item.id}
                    className={`history-item ${selectedHistoryIndex === index ? 'selected' : ''}`}
                    onClick={() => handleSelectHistory(item)}
                  >
                    <div className="history-item-content">
                      <span className="history-query">{item.query}</span>
                      <span className="history-result">= {item.result}</span>
                    </div>
                    <span className="history-type">{item.type}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="history-empty">
              <div className="history-empty-icon">
                <img src="/icons/history-stroke-rounded.svg" alt="History" width="48" height="48" />
              </div>
              <div className="history-empty-text">No history yet</div>
              <div className="history-empty-hint">Try: 2+2, 10km to miles, time in Tokyo</div>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="calculator-footer">
        <div className="footer-hint">
          <kbd>Enter</kbd> Copy
        </div>
        <div className="footer-hint">
          <kbd>↑</kbd>
          <kbd>↓</kbd> History
        </div>
        <div className="footer-hint">
          <kbd>Esc</kbd> Close
        </div>
      </div>
    </div>
  );
};
