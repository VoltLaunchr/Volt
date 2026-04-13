import React from 'react';
import petitLogo from '../../../assets/icons/petit-logo.svg';
import './Footer.css';

interface FooterProps {
  isIndexing?: boolean;
}

export const Footer: React.FC<FooterProps> = ({ isIndexing = false }) => {
  return (
    <footer className="app-footer">
      <div className="footer-left">
        <img src={petitLogo} alt="Logo" className="footer-logo" />
        {isIndexing && (
          <div className="footer-indexing" aria-label="Indexing files" title="Indexing files…">
            <span className="footer-indexing-dot" aria-hidden="true" />
            <span className="footer-indexing-label">Indexing</span>
          </div>
        )}
      </div>

      <div className="footer-right">
        <div className="footer-action">
          <span>Open Command</span>
          <div className="footer-key">↵</div>
        </div>

        <div className="footer-divider" />

        <div className="footer-action">
          <span>Actions</span>
          <div className="footer-key">Ctrl K</div>
        </div>
      </div>
    </footer>
  );
};
