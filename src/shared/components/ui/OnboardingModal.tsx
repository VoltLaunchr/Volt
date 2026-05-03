import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronLeft,
  Pencil,
  Puzzle,
  Zap,
} from 'lucide-react';
import { settingsService } from '../../../features/settings';
import { useAppStore } from '../../../stores/appStore';
import { logger } from '../../utils/logger';
import { cn } from '@/lib/utils';

/* ─── Keyframe animations (complex transforms — not expressible as Tailwind utilities) ─ */
const KEYFRAMES = `
@keyframes onboarding-fade-in {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0);   }
}
@keyframes onboarding-glow-pulse {
  0%,100% { opacity: 0.5;  transform: translate(-50%,-50%) scale(1);    }
  50%      { opacity: 0.75; transform: translate(-50%,-50%) scale(1.06); }
}
@keyframes onboarding-card-in {
  from { opacity: 0; transform: translateY(14px); }
  to   { opacity: 1; transform: translateY(0);    }
}
@keyframes onboarding-pill-pop {
  0%   { opacity: 0; transform: scale(0.85); }
  70%  {             transform: scale(1.05); }
  100% { opacity: 1; transform: scale(1);    }
}
@keyframes onboarding-logo-in {
  from { opacity: 0; transform: scale(0.85); filter: blur(6px); }
  to   { opacity: 1; transform: scale(1);    filter: blur(0);   }
}
@keyframes onboarding-slide-in-right {
  from { opacity: 0; transform: translateX(28px); }
  to   { opacity: 1; transform: translateX(0);    }
}
@keyframes onboarding-slide-in-left {
  from { opacity: 0; transform: translateX(-28px); }
  to   { opacity: 1; transform: translateX(0);     }
}
@keyframes onboarding-saved-flash {
  0%   { opacity: 0; transform: translateY(4px) scale(0.96); }
  20%  { opacity: 1; transform: translateY(0)   scale(1.02); }
  100% { opacity: 1; transform: translateY(0)   scale(1);    }
}
@media (prefers-reduced-motion: reduce) {
  .ob-slide, .ob-logo, .ob-fade, .ob-pill, .ob-card, .ob-saved {
    animation: none !important;
    transition: none !important;
    opacity: 1 !important;
    transform: none !important;
  }
}
`;

const ACCENT = '#8585e0';
const SLIDE_COUNT = 4;
const SAVED_FLASH_MS = 1600;

interface OnboardingModalProps {
  isOpen: boolean;
  onComplete: () => void;
}

interface Screen2Card {
  id: string;
  label: string;
  image: string;
  icon?: string; // path to app SVG icon
}

const SCREEN2_CARDS: Screen2Card[] = [
  { id: 'appLauncher', label: 'App Launcher',  image: '/onboarding/ecran-2/card-1.png' },
  { id: 'fileSearch',  label: 'Search File',   image: '/onboarding/ecran-2/card-2.png', icon: '/icons/app/file_search_icon.svg' },
  { id: 'calculator',  label: 'Calculator',    image: '/onboarding/ecran-2/card-3.png', icon: '/icons/app/calculator_icon.svg' },
  { id: 'emojis',      label: 'Search emojis', image: '/onboarding/ecran-2/card-4.png', icon: '/icons/app/emojis_icon.svg' },
  { id: 'clipboard',   label: 'File History',  image: '/onboarding/ecran-2/card-5.png', icon: '/icons/app/clipboard_history_icon.svg' },
  { id: 'games',       label: 'Launch Game',   image: '/onboarding/ecran-2/card-6.png', icon: '/icons/app/games_icon.svg' },
];

interface ExtensionItem {
  id: 'github' | 'notion' | 'pomodoro' | 'webSearch' | 'systemMonitor' | 'shell';
  color: string;
  icon: string;
  iconBg?: string;
}

// Real Volt features — extensions + built-in plugins, with the custom SVG icons we ship.
// GitHub & Notion SVGs use fill="white" so we give them a dark container; the others
// are full-color app icons rendered on a tinted gradient.
const EXTENSIONS: ExtensionItem[] = [
  { id: 'github',        color: '#e2e8f0', icon: '/extension-icons/github.svg',          iconBg: '#0d1117' },
  { id: 'notion',        color: '#e2e8f0', icon: '/extension-icons/notion.svg',          iconBg: '#1a1a1a' },
  { id: 'pomodoro',      color: '#ef4444', icon: '/icons/app/pomodoro_icon.svg' },
  { id: 'webSearch',     color: '#3b82f6', icon: '/icons/app/web_search_icon.svg' },
  { id: 'systemMonitor', color: '#06b6d4', icon: '/icons/app/system_monitor_icon.svg' },
  { id: 'shell',         color: '#10b981', icon: '/icons/app/shell_icon.svg' },
];

// ─── Modal shell ──────────────────────────────────────────
export function OnboardingModal({ isOpen, onComplete }: OnboardingModalProps) {
  const { t } = useTranslation('onboarding');
  const settings = useAppStore((s) => s.settings);
  const setSettings = useAppStore((s) => s.setSettings);

  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState<'forward' | 'back'>('forward');

  // Slide 4 state
  const initialHotkey = settings?.hotkeys.toggleWindow ?? 'Ctrl+Space';
  const [hotkey, setHotkey] = useState(initialHotkey);
  const [justSaved, setJustSaved] = useState(false);
  const [hotkeyError, setHotkeyError] = useState<string | null>(null);
  const [isCapturingHotkey, setIsCapturingHotkey] = useState(false);

  // Slide 3 demo toggle
  const [extensionsEnabled, setExtensionsEnabled] = useState(true);

  // For focus management — primary CTA on the active slide
  const primaryActionRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setHotkey(initialHotkey);
  }, [initialHotkey]);

  const go = useCallback((dir: number) => {
    setStep((current) => {
      const next = current + dir;
      if (next < 0 || next >= SLIDE_COUNT) return current;
      setDirection(dir > 0 ? 'forward' : 'back');
      return next;
    });
  }, []);

  // Move focus to the primary CTA whenever the slide changes
  useEffect(() => {
    if (!isOpen) return;
    const id = window.setTimeout(() => {
      primaryActionRef.current?.focus();
    }, 50);
    return () => window.clearTimeout(id);
  }, [isOpen, step]);

  // Global keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handler = (e: KeyboardEvent) => {
      // Defer to inputs / contenteditable / when capturing a hotkey
      if (isCapturingHotkey) return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) {
          return;
        }
      }

      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          onComplete();
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (step < SLIDE_COUNT - 1) go(1);
          else onComplete();
          break;
        case 'ArrowLeft':
        case 'Backspace':
          if (step > 0) {
            e.preventDefault();
            go(-1);
          }
          break;
        case 'Enter':
          // Let buttons handle Enter natively when focused
          if (target && target.tagName === 'BUTTON') return;
          e.preventDefault();
          if (step < SLIDE_COUNT - 1) go(1);
          else onComplete();
          break;
        default:
          break;
      }
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, step, go, onComplete, isCapturingHotkey]);

  const handleHotkeyChange = useCallback(
    async (newHotkey: string) => {
      setHotkeyError(null);
      setHotkey(newHotkey);
      if (!settings) return;
      try {
        const updated = await settingsService.updateHotkeySettings({
          ...settings.hotkeys,
          toggleWindow: newHotkey,
        });
        setSettings(updated);
        setJustSaved(true);
        window.setTimeout(() => setJustSaved(false), SAVED_FLASH_MS);
      } catch (error) {
        logger.error('Failed to update hotkey from onboarding:', error);
        setHotkeyError(String(error));
      }
    },
    [settings, setSettings]
  );

  const handleHotkeyError = useCallback(
    (msg: string) => {
      setHotkeyError(msg);
      logger.warn('Onboarding hotkey error:', msg);
    },
    []
  );

  if (!isOpen) return null;

  const isLast = step === SLIDE_COUNT - 1;
  const slideKey = `slide-${step}`;

  return (
    <>
      {/* Inject keyframes once */}
      <style>{KEYFRAMES}</style>

      <div
        className="fixed inset-0 z-[5000] overflow-hidden isolate"
        style={{ background: '#07070f', color: '#f8fafc', fontFamily: 'Inter, var(--font-sans)' }}
        role="dialog"
        aria-modal="true"
        aria-label={t('welcome.title')}
      >
        {/* Decorative background */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
          {/* Noise texture */}
          <img
            src="/onboarding/bg-noise.svg"
            className="absolute inset-0 w-full h-full object-cover"
            style={{ opacity: 0.55, mixBlendMode: 'overlay' }}
            aria-hidden="true"
          />
          {/* Step 0: ellipse beam top-left / Step 1: lueur top-right */}
          {step === 0 && (
            <img
              src="/onboarding/ellipse-beam.svg"
              className="absolute"
              style={{ top: -60, left: -120, width: 560, pointerEvents: 'none' }}
              aria-hidden="true"
            />
          )}
          {step === 1 && (
            <img
              src="/onboarding/ecran-2/lueur.svg"
              className="absolute"
              style={{
                top: -100,
                left: -200,
                width: 1400,
                height: 1000,
                pointerEvents: 'none',
                opacity: 0.9,
                transform: 'scaleY(-1)',
                transformOrigin: 'center',
              }}
              aria-hidden="true"
            />
          )}
          {step === 2 && (
            <>
              {/* Top-left soft glow */}
              <div
                className="absolute"
                style={{
                  top: -200,
                  left: -200,
                  width: 800,
                  height: 800,
                  background: 'radial-gradient(circle, rgba(139,92,246,0.18) 0%, transparent 60%)',
                  pointerEvents: 'none',
                }}
              />
              {/* Bottom-right purple haze */}
              <div
                className="absolute"
                style={{
                  bottom: -250,
                  right: -150,
                  width: 700,
                  height: 700,
                  background: 'radial-gradient(circle, rgba(133,133,224,0.14) 0%, transparent 65%)',
                  pointerEvents: 'none',
                }}
              />
            </>
          )}
          {step === 3 && (
            <>
              {/* Centered ambient halo */}
              <div
                className="absolute"
                style={{
                  top: '50%',
                  left: '50%',
                  width: 900,
                  height: 600,
                  transform: 'translate(-50%,-50%)',
                  background:
                    'radial-gradient(ellipse 50% 60% at 50% 50%, rgba(133,133,224,0.16) 0%, transparent 70%)',
                  pointerEvents: 'none',
                }}
              />
            </>
          )}
          {/* Vignette */}
          <div
            className="absolute inset-0"
            style={{
              background:
                'radial-gradient(ellipse 90% 80% at 50% 50%, transparent 40%, rgba(5,5,12,0.7) 100%)',
            }}
          />
        </div>

        {/* Slide area */}
        <div
          key={slideKey}
          className="ob-slide absolute flex flex-col"
          style={{
            inset: '0 0 80px 0',
            animation:
              direction === 'forward'
                ? 'onboarding-slide-in-right 0.32s cubic-bezier(0.4,0,0.2,1)'
                : 'onboarding-slide-in-left 0.32s cubic-bezier(0.4,0,0.2,1)',
          }}
        >
          {step === 0 && (
            <SlideWelcome onNext={() => go(1)} primaryRef={primaryActionRef} />
          )}
          {step === 1 && <SlideFeatures />}
          {step === 2 && (
            <SlideExtensions
              enabled={extensionsEnabled}
              onToggle={() => setExtensionsEnabled((v) => !v)}
            />
          )}
          {step === 3 && (
            <SlideHotkey
              hotkey={hotkey}
              justSaved={justSaved}
              error={hotkeyError}
              onHotkeyChange={handleHotkeyChange}
              onError={handleHotkeyError}
              onRecordingChange={setIsCapturingHotkey}
            />
          )}
        </div>

        {/* Floating footer */}
        <div className="absolute bottom-0 left-0 right-0 px-3 pb-3 z-[5]">
          <div
            className="w-full rounded-2xl flex items-center px-4 h-[54px] gap-3"
            style={{
              background: 'rgba(18,18,28,0.95)',
              border: '1px solid rgba(255,255,255,0.07)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.45)',
            }}
          >
            {/* Back button — hidden on step 0 */}
            <button
              type="button"
              className={cn(
                'inline-flex items-center justify-center w-7 h-7 rounded-md border border-transparent cursor-pointer transition-all shrink-0',
                'text-[rgba(255,255,255,0.5)] bg-transparent',
                'hover:text-[rgba(255,255,255,0.9)] hover:bg-[rgba(255,255,255,0.06)]',
                step === 0 && 'invisible pointer-events-none'
              )}
              onClick={() => go(-1)}
              aria-label={t('nav.back')}
              tabIndex={step === 0 ? -1 : 0}
            >
              <ChevronLeft size={15} />
            </button>

            <ProgressBar step={step} total={SLIDE_COUNT} />

            <div className="flex-1" />

            {/* Skip — hidden on step 0 */}
            {step > 0 && (
              <button
                type="button"
                className="border border-transparent bg-transparent text-[rgba(255,255,255,0.4)] text-xs font-medium px-[10px] py-1.5 rounded-md cursor-pointer transition-colors hover:text-[rgba(255,255,255,0.8)] hover:bg-[rgba(255,255,255,0.04)]"
                onClick={onComplete}
              >
                {t('nav.skip')}
              </button>
            )}

            {!isLast ? (
              <button
                ref={primaryActionRef}
                type="button"
                className="inline-flex items-center gap-[7px] px-[18px] py-[7px] rounded-lg text-[13px] font-semibold cursor-pointer transition-all border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.09)] text-[rgba(255,255,255,0.95)] hover:bg-[rgba(255,255,255,0.13)] hover:border-[rgba(255,255,255,0.15)] hover:-translate-y-px active:scale-[0.97]"
                onClick={() => go(1)}
              >
                {step === 0 ? t('welcome.cta') : t('nav.continue')}
              </button>
            ) : (
              <button
                ref={primaryActionRef}
                type="button"
                className="inline-flex items-center gap-[7px] px-[18px] py-[7px] rounded-lg text-[13px] font-semibold cursor-pointer transition-all border border-transparent text-white hover:-translate-y-px active:scale-[0.97]"
                style={{
                  background: ACCENT,
                  boxShadow: '0 4px 16px -4px rgba(133,133,224,0.4)',
                }}
                onClick={onComplete}
              >
                <Zap size={13} />
                {t('nav.launch')}
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Progress ─────────────────────────────────────────────
function ProgressBar({ step, total }: { step: number; total: number }) {
  return (
    <div
      className="flex gap-1 items-center"
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={total}
      aria-valuenow={step + 1}
    >
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className="rounded-full transition-all duration-[350ms]"
          style={{
            height: 5,
            width: i === step ? 32 : 14,
            background:
              i === step
                ? ACCENT
                : i < step
                  ? `${ACCENT}80`
                  : 'rgba(255,255,255,0.18)',
            boxShadow: i === step ? `0 0 8px ${ACCENT}80` : 'none',
          }}
        />
      ))}
    </div>
  );
}

// ─── Slide 1 — Welcome ───────────────────────────────────
function SlideWelcome({
  onNext: _onNext,
  primaryRef: _primaryRef,
}: {
  onNext: () => void;
  primaryRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const { t } = useTranslation('onboarding');
  const [platformName, setPlatformName] = useState('');

  useEffect(() => {
    import('@tauri-apps/plugin-os')
      .then(({ platform }) => platform())
      .then((p) => {
        if (p === 'windows') setPlatformName('For Windows');
        else if (p === 'macos') setPlatformName('For macOS');
        else if (p === 'linux') setPlatformName('For Linux');
      })
      .catch(() => {});
  }, []);

  return (
    <div className="relative flex flex-col items-center justify-center h-full p-10">
      {/* Logo — uses Figma asset */}
      <img
        src="/onboarding/logo-onboarding.svg"
        width={200}
        height={200}
        alt="Volt"
        className="ob-logo mb-8"
        style={{
          animation: 'onboarding-logo-in 0.6s cubic-bezier(0.34,1.56,0.64,1) both',
          filter: 'drop-shadow(0 24px 48px rgba(0,0,0,0.6)) drop-shadow(0 4px 12px rgba(0,0,0,0.4))',
        }}
      />

      <h1
        className="ob-fade font-extrabold text-center"
        style={{
          fontSize: 48,
          lineHeight: 1.12,
          letterSpacing: '-0.03em',
          color: 'rgba(255,255,255,0.97)',
          animation: 'onboarding-fade-in 0.5s cubic-bezier(0.4,0,0.2,1) both 0.18s',
        }}
      >
        {t('welcome.title')}
        {platformName && (
          <>
            <br />
            {platformName}
          </>
        )}
      </h1>
    </div>
  );
}



// ─── Slide 2 — Features ──────────────────────────────────
function SlideFeatures() {
  const { t } = useTranslation('onboarding');

  return (
    <div className="flex h-full relative z-[1]">
      {/* Left panel */}
      <div className="w-[420px] shrink-0 flex flex-col justify-center py-0 pl-12 pr-8 gap-5">
        {/* Eyebrow */}
        <div
          className="ob-pill inline-flex items-center gap-1.5 px-3 py-[5px] rounded-full w-fit"
          style={{
            background: 'rgba(133,133,224,0.15)',
            border: '1px solid rgba(133,133,224,0.3)',
            animation: 'onboarding-pill-pop 0.4s cubic-bezier(0.4,0,0.2,1) both 0.05s',
          }}
        >
          <CheckCircle2 size={12} strokeWidth={2.4} style={{ color: ACCENT }} />
          <span
            className="text-[11px] font-semibold tracking-[0.02em]"
            style={{ color: ACCENT }}
          >
            {t('features.eyebrow')}
          </span>
        </div>

        <h2
          className="ob-fade font-extrabold leading-[1.05] m-0"
          style={{
            fontSize: 64,
            letterSpacing: '-0.035em',
            color: 'rgba(255,255,255,0.97)',
            animation: 'onboarding-fade-in 0.5s cubic-bezier(0.4,0,0.2,1) both 0.15s',
          }}
        >
          {t('features.title')}
        </h2>

        <p
          className="ob-fade text-[14px] leading-[1.65] m-0"
          style={{
            color: 'rgba(255,255,255,0.6)',
            maxWidth: 340,
            animation: 'onboarding-fade-in 0.5s cubic-bezier(0.4,0,0.2,1) both 0.22s',
          }}
        >
          {t('features.subtitle')}
        </p>
      </div>

      {/* Feature grid — 2 cols × 3 rows with varied heights matching Figma */}
      <div
        className="flex-1 px-4 py-4 grid grid-cols-2 gap-2.5 min-h-0"
        style={{ gridTemplateRows: '199px 159px 199px', alignContent: 'center' }}
      >
        {SCREEN2_CARDS.map((card, i) => (
          <FeatureCard key={card.id} card={card} idx={i} />
        ))}
      </div>
    </div>
  );
}

function FeatureCard({ card, idx }: { card: Screen2Card; idx: number }) {
  return (
    <div
      className="ob-card relative rounded-xl overflow-hidden opacity-0 flex flex-col"
      style={{
        background: '#0c0c18',
        border: '1px solid rgba(255,255,255,0.09)',
        animation: 'onboarding-card-in 0.45s cubic-bezier(0.4,0,0.2,1) forwards',
        animationDelay: `${0.04 + idx * 0.055}s`,
      }}
    >
      {/* Screenshot fills the card */}
      <img
        src={card.image}
        alt=""
        className="absolute inset-0 w-full h-full object-cover object-top"
        style={{ opacity: 0.65 }}
        draggable={false}
      />

      {/* Radial dark vignette so icon/text stand out */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 70% 70% at 55% 45%, rgba(0,0,0,0.45) 0%, transparent 80%)',
        }}
      />

      {/* Content overlay */}
      <div className="relative z-10 flex flex-col items-center justify-center h-full gap-2 py-3 px-3">
        {card.icon ? (
          <>
            <img
              src={card.icon}
              alt=""
              width={58}
              height={58}
              draggable={false}
              style={{
                borderRadius: 14,
                filter: 'drop-shadow(0 6px 16px rgba(0,0,0,0.55))',
                flexShrink: 0,
              }}
            />
            <span
              className="text-[13px] font-semibold text-center leading-tight"
              style={{ color: 'rgba(255,255,255,0.92)', textShadow: '0 1px 6px rgba(0,0,0,0.7)' }}
            >
              {card.label}
            </span>
          </>
        ) : (
          /* App Launcher — no icon, label at top-left */
          <div className="absolute top-0 left-0 p-3">
            <span
              className="text-[13px] font-bold"
              style={{ color: 'rgba(255,255,255,0.95)', textShadow: '0 1px 6px rgba(0,0,0,0.7)' }}
            >
              {card.label}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Slide 3 — Extensions ────────────────────────────────
function SlideExtensions({
  enabled,
  onToggle,
}: {
  enabled: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation('onboarding');
  return (
    <div className="flex h-full relative z-[1]">
      {/* Left panel — mirrors step 2 hierarchy */}
      <div className="w-[420px] shrink-0 flex flex-col justify-center py-0 pl-12 pr-8 gap-5">
        {/* Eyebrow */}
        <div
          className="ob-pill inline-flex items-center gap-1.5 px-3 py-[5px] rounded-full w-fit"
          style={{
            background: 'rgba(139,92,246,0.15)',
            border: '1px solid rgba(139,92,246,0.3)',
            animation: 'onboarding-pill-pop 0.4s cubic-bezier(0.4,0,0.2,1) both 0.05s',
          }}
        >
          <Puzzle size={12} strokeWidth={2.4} style={{ color: '#a78bfa' }} />
          <span
            className="text-[11px] font-semibold tracking-[0.02em]"
            style={{ color: '#a78bfa' }}
          >
            {t('extensions.eyebrow')}
          </span>
        </div>

        <h2
          className="ob-fade font-extrabold leading-[1.05] m-0"
          style={{
            fontSize: 64,
            letterSpacing: '-0.035em',
            color: 'rgba(255,255,255,0.97)',
            animation: 'onboarding-fade-in 0.5s cubic-bezier(0.4,0,0.2,1) both 0.15s',
          }}
        >
          {t('extensions.title')}
        </h2>

        <p
          className="ob-fade text-[14px] leading-[1.65] m-0"
          style={{
            color: 'rgba(255,255,255,0.6)',
            maxWidth: 340,
            animation: 'onboarding-fade-in 0.5s cubic-bezier(0.4,0,0.2,1) both 0.22s',
          }}
        >
          {t('extensions.subtitle')}
        </p>

        {/* Toggle row */}
        <div
          className="ob-fade flex items-center gap-3 mt-1"
          style={{ animation: 'onboarding-fade-in 0.5s cubic-bezier(0.4,0,0.2,1) both 0.3s' }}
        >
          <button
            type="button"
            className="relative w-11 h-[24px] rounded-full border-none cursor-pointer p-0 shrink-0 transition-colors"
            style={{ background: enabled ? '#8b5cf6' : 'rgba(255,255,255,0.14)' }}
            role="switch"
            aria-checked={enabled}
            aria-label={t('extensions.enable')}
            onClick={onToggle}
          >
            <span
              className="absolute top-[3px] w-[18px] h-[18px] rounded-full bg-white transition-all"
              style={{ left: enabled ? 23 : 3, boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }}
            />
          </button>
          <span className="text-[13.5px] font-semibold" style={{ color: 'rgba(255,255,255,0.95)' }}>
            {t('extensions.enable')}
          </span>
        </div>
      </div>

      {/* Extensions grid — bigger, more polished cards */}
      <div
        className="flex-1 px-4 py-4 grid grid-cols-2 gap-3 min-h-0"
        style={{ alignContent: 'center' }}
      >
        {EXTENSIONS.map((ext, i) => (
          <ExtensionCard key={ext.id} ext={ext} idx={i} enabled={enabled} t={t} />
        ))}
      </div>
    </div>
  );
}

function ExtensionCard({
  ext,
  idx,
  enabled,
  t,
}: {
  ext: ExtensionItem;
  idx: number;
  enabled: boolean;
  t: (key: string) => string;
}) {
  return (
    <div
      className="ob-card relative flex items-center gap-3.5 rounded-xl px-4 py-4 cursor-default opacity-0 transition-all hover:-translate-y-0.5"
      style={{
        background: 'rgba(14,14,24,0.85)',
        border: '1px solid rgba(255,255,255,0.08)',
        backdropFilter: 'blur(8px)',
        animationDelay: `${0.1 + idx * 0.06}s`,
        animation: 'onboarding-card-in 0.45s cubic-bezier(0.4,0,0.2,1) forwards',
        boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
      }}
    >
      <div
        className="w-11 h-11 rounded-[10px] shrink-0 flex items-center justify-center overflow-hidden"
        style={{
          background: ext.iconBg ?? `linear-gradient(135deg, ${ext.color}33, ${ext.color}1a)`,
          border: `1px solid ${ext.iconBg ? 'rgba(255,255,255,0.12)' : `${ext.color}44`}`,
        }}
      >
        <img
          src={ext.icon}
          alt=""
          width={ext.iconBg ? 26 : 30}
          height={ext.iconBg ? 26 : 30}
          draggable={false}
          style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.15))' }}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div
          className="text-[13.5px] font-semibold mb-[2px]"
          style={{ color: 'rgba(255,255,255,0.96)' }}
        >
          {t(`extensions.items.${ext.id}.name`)}
        </div>
        <div
          className="text-[12px] leading-tight truncate"
          style={{ color: 'rgba(255,255,255,0.55)' }}
        >
          {t(`extensions.items.${ext.id}.desc`)}
        </div>
      </div>
      <div
        className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center transition-all"
        style={{
          background: enabled ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.05)',
          color: enabled ? '#10b981' : 'rgba(255,255,255,0.25)',
          border: enabled ? '1px solid rgba(16,185,129,0.3)' : '1px solid rgba(255,255,255,0.06)',
        }}
      >
        <Check size={13} strokeWidth={2.5} />
      </div>
    </div>
  );
}

// ─── Slide 4 — Hotkey ────────────────────────────────────
function SlideHotkey({
  hotkey,
  justSaved,
  error,
  onHotkeyChange,
  onError,
  onRecordingChange,
}: {
  hotkey: string;
  justSaved: boolean;
  error: string | null;
  onHotkeyChange: (hk: string) => void;
  onError: (msg: string) => void;
  onRecordingChange: (recording: boolean) => void;
}) {
  const { t } = useTranslation('onboarding');

  const { primary, secondary } = useMemo(() => splitHotkey(hotkey), [hotkey]);
  const pretty = prettyHotkey(hotkey);

  return (
    <div className="relative flex flex-col items-center h-full px-10 pt-20 pb-24 z-[1]">
      {/* Title at top — bigger, no icon */}
      <h2
        className="ob-fade font-extrabold text-center"
        style={{
          fontSize: 60,
          lineHeight: 1.05,
          letterSpacing: '-0.035em',
          color: justSaved ? '#f8fafc' : 'rgba(255,255,255,0.96)',
          animation: 'onboarding-fade-in 0.5s cubic-bezier(0.4,0,0.2,1) both 0.05s',
        }}
      >
        {justSaved ? t('hotkey.titleSaved') : t('hotkey.title')}
      </h2>

      {/* Vertical filler — keys sit roughly vertically centered */}
      <div className="flex-1" />

      {/* Big tactile keys */}
      <div
        className="ob-fade flex items-center gap-5 mb-6"
        style={{ animation: 'onboarding-fade-in 0.5s cubic-bezier(0.4,0,0.2,1) both 0.18s' }}
        aria-label={pretty}
      >
        {primary.map((k, i) => (
          <span
            key={`${k}-${i}`}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 20 }}
          >
            <KeyTile>{k}</KeyTile>
            {i < primary.length - 1 && <KeyPlus />}
          </span>
        ))}
        {primary.length > 0 && secondary && (
          <>
            <KeyPlus />
            <KeyTile wide>{secondary}</KeyTile>
          </>
        )}
      </div>

      {/* Compact action — pill button or saved badge */}
      <div
        className="ob-fade min-h-[36px] flex items-center justify-center"
        style={{ animation: 'onboarding-fade-in 0.5s cubic-bezier(0.4,0,0.2,1) both 0.24s' }}
        aria-live="polite"
      >
        {justSaved ? (
          <div
            className="ob-saved flex items-center gap-2 text-[#10b981] text-[13px] font-semibold rounded-full px-4 py-1.5"
            style={{
              background: 'rgba(16,185,129,0.12)',
              border: '1px solid rgba(16,185,129,0.3)',
              animation: 'onboarding-saved-flash 0.45s cubic-bezier(0.4,0,0.2,1)',
            }}
          >
            <Check size={14} />
            <span>{t('hotkey.saved')}</span>
          </div>
        ) : (
          <ChangeHotkeyButton
            value={hotkey}
            onChange={onHotkeyChange}
            onError={onError}
            onRecordingChange={onRecordingChange}
            label={t('hotkey.changeButton')}
          />
        )}
      </div>

      {error && (
        <div
          className="flex items-center gap-1.5 mt-3 text-xs rounded-md px-2.5 py-[5px]"
          style={{
            color: '#fca5a5',
            background: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.25)',
          }}
          role="alert"
        >
          <AlertCircle size={12} />
          <span>{t('hotkey.errorInvalid')}</span>
        </div>
      )}

      {/* Vertical filler keeps footer at bottom while keys remain centered */}
      <div className="flex-1" />

      {/* Footer with inline highlighted shortcut */}
      <p
        className="ob-fade text-[13px] text-center"
        style={{
          color: 'rgba(255,255,255,0.45)',
          animation: 'onboarding-fade-in 0.5s cubic-bezier(0.4,0,0.2,1) both 0.32s',
        }}
      >
        {t('hotkey.footerHit')}
        <span style={{ color: 'rgba(255,255,255,0.92)', fontWeight: 600 }}>{pretty}</span>
        {t('hotkey.footerToOpen')}
      </p>
    </div>
  );
}

// Big Raycast-style key — modifier (square-ish) or wide (main key)
function KeyTile({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <span
      className="flex items-center justify-center select-none"
      style={{
        minWidth: wide ? 380 : 140,
        height: 110,
        padding: '0 32px',
        borderRadius: 16,
        background: 'linear-gradient(180deg, rgba(26,26,38,0.95), rgba(14,14,22,0.98))',
        border: '1px solid rgba(255,255,255,0.09)',
        boxShadow:
          'inset 0 1px 0 rgba(255,255,255,0.07), 0 1px 0 rgba(0,0,0,0.4), 0 12px 32px rgba(0,0,0,0.45)',
        color: 'rgba(255,255,255,0.96)',
        fontSize: 26,
        fontWeight: 600,
        letterSpacing: '-0.01em',
      }}
    >
      {children}
    </span>
  );
}

function KeyPlus() {
  return (
    <span
      style={{
        fontSize: 24,
        fontWeight: 300,
        color: 'rgba(255,255,255,0.32)',
        userSelect: 'none',
      }}
    >
      +
    </span>
  );
}

// ─── Self-contained themed hotkey capture for onboarding ─────────────────
// Replicates HotkeyCapture's capture logic with a clean, themed CTA UI.
function ChangeHotkeyButton({
  onChange,
  onError,
  onRecordingChange,
  label,
}: {
  value: string;
  onChange: (hk: string) => void;
  onError: (msg: string) => void;
  onRecordingChange: (recording: boolean) => void;
  label: string;
}) {
  const [recording, setRecording] = useState(false);
  const [pressed, setPressed] = useState<Set<string>>(new Set());
  const pressedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    onRecordingChange(recording);
  }, [recording, onRecordingChange]);

  useEffect(() => {
    if (!recording) return;

    const normalize = (key: string): string => {
      const map: Record<string, string> = {
        ' ': 'Space',
        arrowup: 'Up',
        arrowdown: 'Down',
        arrowleft: 'Left',
        arrowright: 'Right',
        escape: 'Escape',
        enter: 'Return',
        backspace: 'Backspace',
        delete: 'Delete',
        tab: 'Tab',
      };
      return map[key.toLowerCase()] || key.toUpperCase();
    };

    const build = (keys: Set<string>): string => {
      const mods: string[] = [];
      let main = '';
      keys.forEach((k) => {
        if (['Ctrl', 'Alt', 'Shift', 'Super'].includes(k)) mods.push(k.toLowerCase());
        else main = k;
      });
      mods.sort();
      return [...mods, main].filter(Boolean).join('+');
    };

    const validate = (hk: string): boolean => {
      const hasMod = /(?:^|\+)(?:ctrl|alt|shift|super)(?:\+|$)/.test(hk);
      return hasMod && hk.split('+').length > 1;
    };

    const onDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const keys = new Set(pressedRef.current);
      if (e.ctrlKey) keys.add('Ctrl');
      if (e.altKey) keys.add('Alt');
      if (e.shiftKey) keys.add('Shift');
      if (e.metaKey) keys.add('Super');
      const k = e.key.toLowerCase();
      if (!['control', 'alt', 'shift', 'meta'].includes(k)) {
        keys.add(normalize(k));
      }
      pressedRef.current = keys;
      setPressed(new Set(keys));
    };

    const onUp = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const keys = pressedRef.current;
      if (keys.size === 0) return;
      const hk = build(keys);
      pressedRef.current = new Set();
      setPressed(new Set());
      if (validate(hk)) {
        onChange(hk);
        setRecording(false);
      } else {
        onError('Invalid hotkey combination. Please use at least one modifier key.');
      }
    };

    document.addEventListener('keydown', onDown);
    document.addEventListener('keyup', onUp);
    return () => {
      document.removeEventListener('keydown', onDown);
      document.removeEventListener('keyup', onUp);
    };
  }, [recording, onChange, onError]);

  if (recording) {
    return (
      <div
        className="px-5 py-2.5 rounded-xl flex items-center gap-2.5 animate-pulse"
        style={{
          background: 'rgba(133,133,224,0.18)',
          border: '1px solid rgba(133,133,224,0.5)',
          color: 'rgba(255,255,255,0.95)',
        }}
      >
        {pressed.size > 0 ? (
          <span className="font-mono text-[13px] font-bold">
            {Array.from(pressed).join(' + ')}
          </span>
        ) : (
          <span className="text-[12.5px] font-medium">Press a key combination…</span>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl cursor-pointer transition-all hover:-translate-y-px"
      style={{
        background: 'rgba(255,255,255,0.06)',
        border: '1px solid rgba(255,255,255,0.12)',
        color: 'rgba(255,255,255,0.95)',
        fontSize: 13,
        fontWeight: 600,
      }}
      onClick={() => {
        pressedRef.current = new Set();
        setPressed(new Set());
        setRecording(true);
      }}
      aria-label={label}
    >
      <Pencil size={13} strokeWidth={2.2} />
      <span>{label}</span>
    </button>
  );
}

// ─── helpers ─────────────────────────────────────────────
function splitHotkey(hotkey: string): { primary: string[]; secondary: string | null } {
  const parts = hotkey.split('+').filter(Boolean);
  if (parts.length === 0) return { primary: ['Alt'], secondary: 'Space' };
  if (parts.length === 1) return { primary: [], secondary: titleCase(parts[0]) };
  const last = parts[parts.length - 1];
  const mods = parts.slice(0, -1).map(titleCase);
  return { primary: mods, secondary: titleCase(last) };
}

function titleCase(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function prettyHotkey(hotkey: string): string {
  return hotkey
    .split('+')
    .map((p) => titleCase(p.trim()))
    .join(' + ');
}
