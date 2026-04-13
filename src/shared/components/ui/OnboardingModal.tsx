import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Keyboard, FolderSearch, Puzzle } from 'lucide-react';
import { Modal } from './Modal';
import './OnboardingModal.css';

interface OnboardingModalProps {
  isOpen: boolean;
  onComplete: () => void;
}

const stepIcons = [Keyboard, FolderSearch, Puzzle];
const stepKeys = ['hotkey', 'indexing', 'plugins'] as const;

export function OnboardingModal({ isOpen, onComplete }: OnboardingModalProps) {
  const { t } = useTranslation('onboarding');
  const [currentStep, setCurrentStep] = useState(0);

  const isLastStep = currentStep === stepKeys.length - 1;
  const stepKey = stepKeys[currentStep];
  const StepIcon = stepIcons[currentStep];

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

        <h3 className="onboarding-title">{t(`steps.${stepKey}.title`)}</h3>
        <p className="onboarding-description">{t(`steps.${stepKey}.description`)}</p>

        <div className="onboarding-dots">
          {stepKeys.map((_, i) => (
            <span
              key={i}
              className={`onboarding-dot ${i === currentStep ? 'active' : ''}`}
              aria-label={`Step ${i + 1} of ${stepKeys.length}`}
            />
          ))}
        </div>

        <div className="onboarding-actions">
          <button className="onboarding-skip" onClick={handleSkip} type="button">
            {t('skip')}
          </button>
          <button className="onboarding-next" onClick={handleNext} type="button">
            {isLastStep ? t('getStarted') : t('next')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
