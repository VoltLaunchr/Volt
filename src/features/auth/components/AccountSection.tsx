/**
 * AccountSection — Settings panel component for auth state.
 * Shows sign-in prompt or user account info.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LogIn, LogOut, User, Loader2, Crown, Shield, Code, AlertCircle } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import type { UserTier } from '../types';

const tierConfig: Record<UserTier, { label: string; icon: typeof Crown; color: string; bg: string }> = {
  free: { label: 'Free', icon: User, color: 'var(--color-text-secondary)', bg: 'rgba(255, 255, 255, 0.08)' },
  premium: { label: 'Premium', icon: Crown, color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.15)' },
  developer: { label: 'Developer', icon: Code, color: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.15)' },
  admin: { label: 'Admin', icon: Shield, color: '#ef4444', bg: 'rgba(239, 68, 68, 0.15)' },
};

const cardStyle: React.CSSProperties = {
  borderRadius: 10,
  background: 'rgba(255, 255, 255, 0.03)',
  border: '1px solid rgba(255, 255, 255, 0.08)',
  overflow: 'hidden',
};

const btnBase: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  padding: '7px 14px',
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  border: 'none',
  transition: 'all 0.15s ease',
};

export function AccountSection() {
  const { t } = useTranslation('settings');
  const { session, profile, isAuthenticated, isLoading, error, login, logout } = useAuth();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const handleLogin = async () => {
    await login();
  };

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await logout();
    } finally {
      setIsLoggingOut(false);
    }
  };

  if (isLoading) {
    return (
      <div style={cardStyle}>
        <div style={{ padding: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <Loader2 size={16} className="animate-spin" style={{ color: 'var(--color-text-tertiary)' }} />
          <span style={{ fontSize: 13, color: 'var(--color-text-tertiary)' }}>
            {t('account.loading', 'Loading account...')}
          </span>
        </div>
      </div>
    );
  }

  if (!isAuthenticated || !session) {
    return (
      <div style={cardStyle}>
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <User size={20} style={{ color: 'var(--color-text-secondary)' }} />
            <div>
              <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--color-text-primary)' }}>
                {t('account.title', 'Account')}
              </div>
              <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 2 }}>
                {t('account.signInDescription', 'Sign in to sync settings and unlock premium features.')}
              </div>
            </div>
          </div>

          {error && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8,
              background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)',
            }}>
              <AlertCircle size={14} style={{ color: '#ef4444', flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: '#ef4444' }}>{error}</span>
            </div>
          )}

          <button
            onClick={handleLogin}
            style={{
              ...btnBase,
              width: '100%',
              background: 'var(--color-accent)',
              color: '#fff',
            }}
          >
            <LogIn size={14} />
            {t('account.signIn', 'Sign in')}
          </button>
        </div>
      </div>
    );
  }

  // Authenticated state
  const tier = profile?.tier ?? 'free';
  const tc = tierConfig[tier];
  const TierIcon = tc.icon;

  return (
    <div style={cardStyle}>
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* User info */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {profile?.avatarUrl ? (
            <img
              src={profile.avatarUrl}
              alt=""
              style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover' }}
            />
          ) : (
            <div style={{
              width: 36, height: 36, borderRadius: '50%',
              background: 'rgba(255, 255, 255, 0.08)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <User size={18} style={{ color: 'var(--color-text-tertiary)' }} />
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            {profile?.username && (
              <div style={{
                fontWeight: 600, fontSize: 14, color: 'var(--color-text-primary)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {profile.username}
              </div>
            )}
            <div style={{
              fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 1,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {profile?.email ?? session.userId}
            </div>
          </div>

          {/* Tier badge */}
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            fontSize: 11, fontWeight: 500, padding: '3px 10px', borderRadius: 20,
            background: tc.bg, color: tc.color,
          }}>
            <TierIcon size={12} />
            {tc.label}
          </span>
        </div>

        {error && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8,
            background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)',
          }}>
            <AlertCircle size={14} style={{ color: '#ef4444', flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: '#ef4444' }}>{error}</span>
          </div>
        )}

        {/* Sign out */}
        <button
          onClick={handleLogout}
          disabled={isLoggingOut}
          style={{
            ...btnBase,
            width: '100%',
            background: 'rgba(239, 68, 68, 0.1)',
            color: '#ef4444',
            border: '1px solid rgba(239, 68, 68, 0.2)',
            opacity: isLoggingOut ? 0.5 : 1,
            cursor: isLoggingOut ? 'not-allowed' : 'pointer',
          }}
        >
          {isLoggingOut ? <Loader2 size={14} className="animate-spin" /> : <LogOut size={14} />}
          {t('account.signOut', 'Sign out')}
        </button>
      </div>
    </div>
  );
}
