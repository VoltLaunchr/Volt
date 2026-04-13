import React from 'react';
import { useTranslation } from 'react-i18next';
import petitLogo from '../../../assets/icons/petit-logo.svg';
import './Footer.css';

interface FooterProps {
  isIndexing?: boolean;
}

export const Footer: React.FC<FooterProps> = ({ isIndexing = false }) => {
  const { t } = useTranslation('common');
  return (
    <footer className="app-footer">
      <div className="footer-left">
        <img src={petitLogo} alt="Logo" className="footer-logo" />
        {isIndexing && (
          <div className="footer-indexing" aria-label={t('footer.indexing')} title={`${t('footer.indexing')}...`}>
            <span className="footer-indexing-dot" aria-hidden="true" />
            <span className="footer-indexing-label">{t('footer.indexing')}</span>
          </div>
        )}
      </div>

      <div className="footer-right">
        <div className="footer-action">
          <span>{t('footer.openCommand')}</span>
          <div className="footer-key">↵</div>
        </div>

        <div className="footer-divider" />

        <div className="footer-action">
          <span>{t('footer.actions')}</span>
          <div className="footer-key">Ctrl K</div>
        </div>
      </div>
    </footer>
  );
};
