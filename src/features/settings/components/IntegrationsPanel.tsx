/**
 * Integrations Panel
 * Manage API keys for external services (GitHub, Notion, etc.)
 */

import { useState, useEffect } from 'react';
import {
  Github,
  Database,
  AlertCircle,
  CheckCircle,
  Eye,
  EyeOff,
  Plus,
  Trash2,
  ExternalLink,
  Loader2,
  Key,
  Shield,
  type LucideIcon,
} from 'lucide-react';
import { logger } from '../../../shared/utils/logger';
import { credentialsService } from '../services/credentialsService';

interface IntegrationConfig {
  id: 'github' | 'notion';
  name: string;
  icon: LucideIcon;
  description: string;
  setupUrl: string;
  docUrl: string;
  color: string;
  placeholder: string;
}

const INTEGRATIONS: IntegrationConfig[] = [
  {
    id: 'github',
    name: 'GitHub',
    icon: Github,
    description: 'Search repositories, issues, PRs, and gists from Volt',
    setupUrl: 'https://github.com/settings/tokens/new?scopes=public_repo&description=Volt',
    docUrl: 'https://github.com/VoltLaunchr/volt-extensions/blob/main/plugins/github/README.md',
    color: 'from-gray-900 to-gray-700',
    placeholder: 'ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  },
  {
    id: 'notion',
    name: 'Notion',
    icon: Database,
    description: 'Access and search your Notion workspace from Volt',
    setupUrl: 'https://www.notion.so/my-integrations',
    docUrl: 'https://github.com/VoltLaunchr/volt-extensions/blob/main/plugins/notion/README.md',
    color: 'from-black to-gray-800',
    placeholder: 'secret_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  },
];

export function IntegrationsPanel() {
  const [credentials, setCredentials] = useState<Record<string, boolean>>({});
  const [showTokens, setShowTokens] = useState<Record<string, boolean>>({});
  const [tokenInputs, setTokenInputs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState<Record<string, boolean>>({});
  const [testingTokens, setTestingTokens] = useState<Record<string, boolean>>({});
  const [tokenStatus, setTokenStatus] = useState<Record<string, 'valid' | 'invalid' | 'unchecked'>>({});

  // Load existing credentials
  useEffect(() => {
    const loadCredentials = async () => {
      const status: Record<string, boolean> = {};
      for (const integration of INTEGRATIONS) {
        const hasToken = await credentialsService.hasToken(integration.id);
        status[integration.id] = hasToken;
      }
      setCredentials(status);
    };

    loadCredentials();
  }, []);

  const handleSaveToken = async (serviceId: 'github' | 'notion') => {
    const token = tokenInputs[serviceId];

    if (!token || token.trim().length === 0) {
      setErrors({ ...errors, [serviceId]: 'Token cannot be empty' });
      return;
    }

    setLoading({ ...loading, [serviceId]: true });
    setErrors({ ...errors, [serviceId]: '' });

    try {
      await credentialsService.saveToken(serviceId, token);
      setCredentials({ ...credentials, [serviceId]: true });
      setTokenInputs({ ...tokenInputs, [serviceId]: '' });
      setSuccess({ ...success, [serviceId]: true });
      setTokenStatus({ ...tokenStatus, [serviceId]: 'unchecked' });

      setTimeout(() => {
        setSuccess({ ...success, [serviceId]: false });
      }, 3000);

      logger.info(`${serviceId} token saved successfully`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to save token';
      setErrors({ ...errors, [serviceId]: errorMessage });
      logger.error(`Failed to save ${serviceId} token:`, error);
    } finally {
      setLoading({ ...loading, [serviceId]: false });
    }
  };

  const handleTestToken = async (serviceId: 'github' | 'notion') => {
    const token = tokenInputs[serviceId];

    if (!token || token.trim().length === 0) {
      setErrors({ ...errors, [serviceId]: 'Enter a token first' });
      return;
    }

    setTestingTokens({ ...testingTokens, [serviceId]: true });
    setErrors({ ...errors, [serviceId]: '' });

    try {
      const isValid = await credentialsService.testToken(serviceId, token);
      setTokenStatus({ ...tokenStatus, [serviceId]: isValid ? 'valid' : 'invalid' });

      if (!isValid) {
        setErrors({ ...errors, [serviceId]: `Invalid ${serviceId} token. Check the token and try again.` });
      }
    } catch (error) {
      setTokenStatus({ ...tokenStatus, [serviceId]: 'invalid' });
      setErrors({ ...errors, [serviceId]: 'Failed to test token' });
    } finally {
      setTestingTokens({ ...testingTokens, [serviceId]: false });
    }
  };

  const handleDeleteToken = async (serviceId: 'github' | 'notion') => {
    if (!confirm(`Are you sure you want to remove the ${serviceId} token?`)) {
      return;
    }

    try {
      await credentialsService.deleteToken(serviceId);
      setCredentials({ ...credentials, [serviceId]: false });
      setTokenInputs({ ...tokenInputs, [serviceId]: '' });
      setShowTokens({ ...showTokens, [serviceId]: false });
      setTokenStatus({ ...tokenStatus, [serviceId]: 'unchecked' });
      logger.info(`${serviceId} token removed`);
    } catch (error) {
      setErrors({ ...errors, [serviceId]: 'Failed to delete token' });
      logger.error(`Failed to delete ${serviceId} token:`, error);
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="border-b border-gray-200 dark:border-gray-700 pb-6">
        <div className="flex items-center gap-3 mb-2">
          <Shield className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Integrations
          </h2>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Connect your accounts to enable features from external extensions. Your tokens are encrypted
          and stored securely locally.
        </p>
      </div>

      {/* Integrations Grid */}
      <div className="space-y-4">
        {INTEGRATIONS.map((integration) => (
          <IntegrationCard
            key={integration.id}
            integration={integration}
            isConfigured={credentials[integration.id] || false}
            token={tokenInputs[integration.id] || ''}
            isShowingToken={showTokens[integration.id] || false}
            isLoading={loading[integration.id] || false}
            isTesting={testingTokens[integration.id] || false}
            error={errors[integration.id]}
            success={success[integration.id] || false}
            tokenStatus={tokenStatus[integration.id] || 'unchecked'}
            onTokenChange={(value) => setTokenInputs({ ...tokenInputs, [integration.id]: value })}
            onToggleVisibility={() =>
              setShowTokens({ ...showTokens, [integration.id]: !showTokens[integration.id] })
            }
            onSave={() => handleSaveToken(integration.id)}
            onTest={() => handleTestToken(integration.id)}
            onDelete={() => handleDeleteToken(integration.id)}
          />
        ))}
      </div>

      {/* Security Notice */}
      <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
        <div className="flex gap-3">
          <Shield className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-blue-800 dark:text-blue-300">
            <p className="font-medium mb-1">🔒 Your tokens are safe</p>
            <ul className="space-y-1 text-xs">
              <li>• Tokens are encrypted using platform-native secure storage</li>
              <li>• Never transmitted or logged</li>
              <li>• Stored locally on your machine</li>
              <li>• You can delete anytime</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

interface IntegrationCardProps {
  integration: IntegrationConfig;
  isConfigured: boolean;
  token: string;
  isShowingToken: boolean;
  isLoading: boolean;
  isTesting: boolean;
  error?: string;
  success?: boolean;
  tokenStatus: 'valid' | 'invalid' | 'unchecked';
  onTokenChange: (value: string) => void;
  onToggleVisibility: () => void;
  onSave: () => void;
  onTest: () => void;
  onDelete: () => void;
}

function IntegrationCard({
  integration,
  isConfigured,
  token,
  isShowingToken,
  isLoading,
  isTesting,
  error,
  success,
  tokenStatus,
  onTokenChange,
  onToggleVisibility,
  onSave,
  onTest,
  onDelete,
}: IntegrationCardProps) {
  const Icon = integration.icon;

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      {/* Header */}
      <div className={`bg-gradient-to-r ${integration.color} p-4 text-white flex items-center justify-between`}>
        <div className="flex items-center gap-3">
          <Icon className="w-6 h-6" />
          <div>
            <h3 className="font-semibold">{integration.name}</h3>
            <p className="text-sm opacity-90">{integration.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isConfigured && (
            <div className="flex items-center gap-1 bg-white/20 px-3 py-1 rounded-full text-sm">
              <CheckCircle className="w-4 h-4" />
              Configured
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="p-4 space-y-4 bg-white dark:bg-gray-900">
        {isConfigured && !token ? (
          <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded p-3 flex items-center gap-3">
            <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0" />
            <div className="text-sm text-green-800 dark:text-green-300">
              <p className="font-medium">Token saved securely</p>
              <p className="text-xs opacity-75">Your token is stored and ready to use</p>
            </div>
          </div>
        ) : null}

        {/* Error State */}
        {error && (
          <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded p-3 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0" />
            <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
          </div>
        )}

        {/* Success State */}
        {success && (
          <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded p-3 flex items-center gap-3">
            <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0" />
            <p className="text-sm text-green-800 dark:text-green-300">Token saved successfully!</p>
          </div>
        )}

        {/* Token Status */}
        {tokenStatus !== 'unchecked' && (
          <div className={`rounded p-3 flex items-center gap-3 ${
            tokenStatus === 'valid'
              ? 'bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800'
              : 'bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800'
          }`}>
            {tokenStatus === 'valid' ? (
              <>
                <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0" />
                <p className="text-sm text-green-800 dark:text-green-300">✓ Token is valid</p>
              </>
            ) : (
              <>
                <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0" />
                <p className="text-sm text-red-800 dark:text-red-300">✗ Token is invalid</p>
              </>
            )}
          </div>
        )}

        {/* Token Input */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
            <Key className="w-4 h-4" />
            API Token
          </label>
          <div className="relative">
            <input
              type={isShowingToken ? 'text' : 'password'}
              value={token}
              onChange={(e) => onTokenChange(e.target.value)}
              placeholder={integration.placeholder}
              disabled={isLoading}
              className="w-full px-3 py-2 pr-10 bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-sm placeholder-gray-400 dark:placeholder-gray-500 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            />
            <button
              type="button"
              onClick={onToggleVisibility}
              disabled={isLoading}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-50"
            >
              {isShowingToken ? (
                <EyeOff className="w-4 h-4" />
              ) : (
                <Eye className="w-4 h-4" />
              )}
            </button>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            <a href={integration.setupUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 inline-flex">
              Get a token
              <ExternalLink className="w-3 h-3" />
            </a>
            {' / '}
            <a href={integration.docUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 inline-flex">
              Learn more
              <ExternalLink className="w-3 h-3" />
            </a>
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2 pt-2">
          <button
            onClick={onTest}
            disabled={isLoading || isTesting || !token}
            className="px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2"
          >
            {isTesting && <Loader2 className="w-4 h-4 animate-spin" />}
            Test Token
          </button>

          <button
            onClick={onSave}
            disabled={isLoading || !token}
            className="px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-800 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2 flex-1"
          >
            {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
            {isConfigured ? 'Update Token' : 'Save Token'}
          </button>

          {isConfigured && (
            <button
              onClick={onDelete}
              disabled={isLoading}
              className="px-3 py-2 text-sm font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg hover:bg-red-100 dark:hover:bg-red-950/50 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
