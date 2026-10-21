import {
  AlignLeft,
  CheckCheck,
  Code2,
  Languages,
  Maximize2,
  Minimize2,
  RefreshCw,
  Sparkles,
  WandSparkles,
  type LucideIcon,
} from 'lucide-react';

const ACTION_ICONS: Record<string, LucideIcon> = {
  'improve-writing': Sparkles,
  'fix-grammar': CheckCheck,
  'make-shorter': Minimize2,
  'make-longer': Maximize2,
  translate: Languages,
  'explain-code': Code2,
  summarize: AlignLeft,
  rephrase: RefreshCw,
};

interface AiActionIconProps {
  actionId: string;
  size?: number;
  className?: string;
}

export function AiActionIcon({ actionId, size = 16, className }: AiActionIconProps) {
  const Icon = ACTION_ICONS[actionId] ?? WandSparkles;
  return <Icon aria-hidden="true" className={className} size={size} strokeWidth={1.8} />;
}
