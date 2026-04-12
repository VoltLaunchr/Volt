import React from 'react';
import petitLogo from '../../../assets/icons/petit-logo.svg';
import './Footer.css';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface FooterProps {
  // Add props here if we need dynamic content later
}

export const Footer: React.FC<FooterProps> = () => {
  return (
    <footer className="app-footer">
      <div className="footer-left">
        <img src={petitLogo} alt="Logo" className="footer-logo" />
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
