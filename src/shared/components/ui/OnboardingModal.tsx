import { useState } from 'react';
import { Keyboard, FolderSearch, Puzzle } from 'lucide-react';
import { Modal } from './Modal';
import './OnboardingModal.css';

interface OnboardingModalProps {
  isOpen: boolean;
  onComplete: () => void;
}

const steps = [
  {
    icon: Keyboard,
    title: 'Global Hotkey',
    description:
      'Press Ctrl+Space anywhere to summon Volt instantly. You can change this shortcut in Settings > Hotkeys.',
  },
  {
    icon: FolderSearch,
    title: 'File Indexing',
    description:
      'Volt indexes your files for instant search. Configure which folders to index in Settings > Indexing.',
  },
  {
    icon: Puzzle,
    title: 'Built-in Plugins',
    description:
      'Calculator, emoji picker, web search, timer, system monitor and more — just start typing to use them.',
  },
];

export function OnboardingModal({ isOpen, onComplete }: OnboardingModalProps) {
  const [currentStep, setCurrentStep] = useState(0);

  const isLastStep = currentStep === steps.length - 1;
  const step = steps[currentStep];
  const StepIcon = step.icon;

  const handleNext = () => {
    if (isLastStep) {
      onComplete();
    } else {
      setCurrentStep((prev) => prev + 1);
    }
  };

  const handleSkip = () => {
    onComplete();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleSkip} size="small">
      <div className="onboarding">
        <div className="onboarding-icon">
          <StepIcon size={40} strokeWidth={1.5} />
        </div>

        <h3 className="onboarding-title">{step.title}</h3>
        <p className="onboarding-description">{step.description}</p>

        <div className="onboarding-dots">
          {steps.map((_, i) => (
            <span
              key={i}
              className={`onboarding-dot ${i === currentStep ? 'active' : ''}`}
              aria-label={`Step ${i + 1} of ${steps.length}`}
            />
          ))}
        </div>

        <div className="onboarding-actions">
          <button className="onboarding-skip" onClick={handleSkip} type="button">
            Skip
          </button>
          <button className="onboarding-next" onClick={handleNext} type="button">
            {isLastStep ? 'Get Started' : 'Next'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
