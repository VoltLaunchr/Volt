export interface AiPreset {
  id: string;
  label: string;
  icon: string;
  system: string;
}

export const AI_PRESETS: AiPreset[] = [
  {
    id: 'improve-writing',
    label: 'Improve Writing',
    icon: '✦',
    system:
      'Improve the writing of the text provided by the user. Keep the same language. Make it clear, concise, and well-structured. Return only the improved text.',
  },
  {
    id: 'fix-grammar',
    label: 'Fix Grammar',
    icon: '✓',
    system:
      'Fix all spelling and grammar errors in the text. Return only the corrected text, no explanations.',
  },
  {
    id: 'make-shorter',
    label: 'Make Shorter',
    icon: '↤',
    system:
      'Shorten the following text while preserving its key meaning. Return only the shortened text.',
  },
  {
    id: 'make-longer',
    label: 'Make Longer',
    icon: '↦',
    system:
      'Expand and elaborate on the following text with more detail and context. Return only the expanded text.',
  },
  {
    id: 'translate',
    label: 'Translate',
    icon: '🌐',
    system:
      'Translate the following text to English. Return only the translation, no explanations.',
  },
  {
    id: 'explain-code',
    label: 'Explain Code',
    icon: '</>',
    system:
      'Explain what the following code does in simple, clear terms. Cover what it does, how it works, and any notable patterns or potential issues.',
  },
  {
    id: 'summarize',
    label: 'Summarize',
    icon: '≡',
    system:
      'Summarize the following text in a few concise sentences, capturing the most important points.',
  },
  {
    id: 'rephrase',
    label: 'Rephrase',
    icon: '⟳',
    system:
      'Rephrase the following text using different words while keeping the same meaning and tone. Return only the rephrased text.',
  },
];
