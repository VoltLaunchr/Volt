import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Code, Crown, Loader2, LogIn, LogOut, Shield, User } from 'lucide-react';
import { Button } from '@/shared/components/ui/button';
import { Badge } from '@/shared/components/ui/badge';
import { SettingsStatus } from '../../settings/components/SettingsChrome';
import {
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from '../../settings/components/SettingsPrimitives';
import { useAuth } from '../hooks/useAuth';
const tierIcons = { free: User, premium: Crown, developer: Code, admin: Shield };
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

  if (isLoading)
    return (
      <SettingsSection sectionId="account.profile">
        <SettingsNote>
          <span role="status" className="flex items-center gap-2">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            {t('account.loading')}
          </span>
        </SettingsNote>
      </SettingsSection>
    );

  const signedIn = isAuthenticated && session;
  const tier = profile?.tier ?? 'free';
  const TierIcon = tierIcons[tier];
  return (
    <SettingsSection sectionId="account.profile">
      <SettingsRow
        rowId="account.profile.status"
        description={signedIn ? (profile?.email ?? session.userId) : t('account.signInDescription')}
      >
        {signedIn ? (
          <div className="flex items-center gap-3">
            {profile?.avatarUrl ? (
              <img src={profile.avatarUrl} alt="" className="size-8 rounded-full object-cover" />
            ) : (
              <div className="flex size-8 items-center justify-center rounded-full bg-muted">
                <User className="size-4 text-muted-foreground" aria-hidden="true" />
              </div>
            )}
            {profile?.username && (
              <span className="truncate text-[13px] font-medium">{profile.username}</span>
            )}
            <Badge variant="secondary">
              <TierIcon aria-hidden="true" />
              {t(`account.tiers.${tier}`)}
            </Badge>
          </div>
        ) : null}
      </SettingsRow>
      {error && (
        <div className="p-2.5">
          <SettingsStatus kind="error">{error}</SettingsStatus>
        </div>
      )}
      <SettingsRow rowId="account.profile.session">
        {signedIn ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleLogout()}
            disabled={isLoggingOut}
          >
            {isLoggingOut ? <Loader2 className="animate-spin" /> : <LogOut />}
            {t('account.signOut')}
          </Button>
        ) : (
          <Button size="sm" onClick={() => void handleLogin()}>
            <LogIn />
            {t('account.signIn')}
          </Button>
        )}
      </SettingsRow>
    </SettingsSection>
  );
}
