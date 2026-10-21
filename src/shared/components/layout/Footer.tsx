import React from 'react';
import { CornerDownLeft, ListChecks } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import petitLogo from '../../../assets/icons/petit-logo.svg';
import { Keycap } from '../ui/Keycap';

interface FooterProps {
  isIndexing?: boolean;
}

export function Footer({ isIndexing = false }: FooterProps): React.JSX.Element {
  const { t } = useTranslation('common');
  return (
    <footer className="flex items-center justify-between h-8 px-3 border-t border-hairline bg-canvas/70 shrink-0">
      <div className="flex min-w-0 items-center gap-2">
        <img src={petitLogo} alt="Logo" className="h-3.5 w-auto opacity-60" />
        {isIndexing && (
          <div
            className="flex items-center gap-1.5 text-xs text-mute"
            aria-label={t('footer.indexing')}
            title={`${t('footer.indexing')}...`}
          >
            <span
              className="w-1.5 h-1.5 rounded-full bg-accent-green animate-pulse"
              aria-hidden="true"
            />
            <span className="text-xs text-mute">{t('footer.indexing')}</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <div
          className="flex items-center gap-1.5 text-xs text-ash"
          title={t('footer.openCommand')}
          aria-label={t('footer.openCommand')}
        >
          <CornerDownLeft size={13} strokeWidth={2} aria-hidden="true" />
          <Keycap>↵</Keycap>
        </div>

        <div className="w-px h-3 bg-hairline" aria-hidden="true" />

        <div
          className="flex items-center gap-1.5 text-xs text-ash"
          title={t('footer.actions')}
          aria-label={t('footer.actions')}
        >
          <ListChecks size={13} strokeWidth={2} aria-hidden="true" />
          <Keycap>Ctrl</Keycap>
          <Keycap>K</Keycap>
        </div>
      </div>
    </footer>
  );
}
