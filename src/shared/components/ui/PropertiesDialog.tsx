import { useTranslation } from 'react-i18next';
import { AppInfo, FileInfo, SearchResult, SearchResultType } from '../../types/common.types';
import { Modal } from './Modal';

export interface PropertiesDialogProps {
  isOpen: boolean;
  onClose: () => void;
  result: SearchResult | null;
}

export function PropertiesDialog({ isOpen, onClose, result }: PropertiesDialogProps) {
  const { t } = useTranslation('results');

  if (!result) return null;

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  const formatDate = (timestamp: number): string => {
    return new Date(timestamp).toLocaleString();
  };

  const renderProperties = () => {
    if (result.type === SearchResultType.Application) {
      const app = result.data as AppInfo;
      return (
        <>
          <PropertyRow label={t('properties.name')} value={app.name} copyLabel={t('properties.copyToClipboard')} />
          <PropertyRow label={t('properties.path')} value={app.path} copyable copyLabel={t('properties.copyToClipboard')} />
          <PropertyRow label={t('properties.id')} value={app.id} copyLabel={t('properties.copyToClipboard')} />
          {app.description && <PropertyRow label={t('properties.description')} value={app.description} copyLabel={t('properties.copyToClipboard')} />}
          {app.category && <PropertyRow label={t('properties.category')} value={app.category} copyLabel={t('properties.copyToClipboard')} />}
          {app.keywords && app.keywords.length > 0 && (
            <PropertyRow label={t('properties.keywords')} value={app.keywords.join(', ')} copyLabel={t('properties.copyToClipboard')} />
          )}
          <PropertyRow label={t('properties.usageCount')} value={app.usageCount.toString()} copyLabel={t('properties.copyToClipboard')} />
          {app.lastUsed && <PropertyRow label={t('properties.lastUsed')} value={formatDate(app.lastUsed)} copyLabel={t('properties.copyToClipboard')} />}
        </>
      );
    } else if (result.type === SearchResultType.File) {
      const file = result.data as FileInfo;
      return (
        <>
          <PropertyRow label={t('properties.name')} value={file.name} copyLabel={t('properties.copyToClipboard')} />
          <PropertyRow label={t('properties.path')} value={file.path} copyable copyLabel={t('properties.copyToClipboard')} />
          <PropertyRow label={t('properties.extension')} value={file.extension} copyLabel={t('properties.copyToClipboard')} />
          <PropertyRow label={t('properties.size')} value={formatBytes(file.size)} copyLabel={t('properties.copyToClipboard')} />
          <PropertyRow label={t('properties.modified')} value={formatDate(file.modified)} copyLabel={t('properties.copyToClipboard')} />
          <PropertyRow label={t('properties.id')} value={file.id} copyLabel={t('properties.copyToClipboard')} />
        </>
      );
    } else {
      return (
        <>
          <PropertyRow label={t('properties.name')} value={result.title} copyLabel={t('properties.copyToClipboard')} />
          {result.subtitle && <PropertyRow label={t('properties.subtitle')} value={result.subtitle} copyLabel={t('properties.copyToClipboard')} />}
          <PropertyRow label={t('properties.type')} value={result.type} copyLabel={t('properties.copyToClipboard')} />
          <PropertyRow label={t('properties.score')} value={result.score.toString()} copyLabel={t('properties.copyToClipboard')} />
        </>
      );
    }
  };

  const getTitle = () => {
    if (result.type === SearchResultType.Application) {
      return (result.data as AppInfo).name;
    } else if (result.type === SearchResultType.File) {
      return (result.data as FileInfo).name;
    }
    return result.title;
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="medium">
      <div className="flex flex-col gap-6 p-4">
        {/* Header */}
        <div className="flex items-center gap-4 pb-4 border-b border-hairline">
          {result.icon && (
            <div className="text-[2.5rem] min-w-[3rem] text-center">{result.icon}</div>
          )}
          <h2 className="text-xl font-semibold m-0 text-on-dark break-words">{getTitle()}</h2>
        </div>

        {/* Body */}
        <div className="overflow-y-auto max-h-[60vh]">
          <table className="w-full border-collapse">{renderProperties()}</table>
        </div>
      </div>
    </Modal>
  );
}

interface PropertyRowProps {
  label: string;
  value: string;
  copyable?: boolean;
  copyLabel: string;
}

function PropertyRow({ label, value, copyable, copyLabel }: PropertyRowProps) {
  const handleCopy = () => {
    void navigator.clipboard.writeText(value);
  };

  return (
    <tr className="border-b border-hairline last:border-0 group">
      <td className="py-3 px-2 font-semibold text-mute w-[30%] align-top text-left text-sm">
        {label}
      </td>
      <td className="py-3 px-2 text-on-dark break-all text-sm">
        <div className="flex items-center gap-2">
          <span className="flex-1" title={value}>
            {value}
          </span>
          {copyable && (
            <button
              className="bg-transparent border border-hairline rounded-xs px-2 py-1 cursor-pointer text-sm opacity-0 group-hover:opacity-100 transition-all text-mute shrink-0 min-w-[2rem] hover:bg-surface-elevated hover:border-hairline-strong hover:scale-105 active:scale-95"
              onClick={handleCopy}
              aria-label={copyLabel}
              title={copyLabel}
            >
              📋
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}
