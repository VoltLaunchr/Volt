import { useTranslation } from 'react-i18next';
import { AppInfo, FileInfo, SearchResult, SearchResultType } from '../../types/common.types';
import { Modal } from './Modal';
import './PropertiesDialog.css';

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
      <div className="properties-dialog">
        <div className="properties-header">
          {result.icon && <div className="properties-icon">{result.icon}</div>}
          <h2 className="properties-title">{getTitle()}</h2>
        </div>
        <div className="properties-body">
          <table className="properties-table">{renderProperties()}</table>
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
    navigator.clipboard.writeText(value);
  };

  return (
    <tr className="property-row">
      <td className="property-label">{label}</td>
      <td className="property-value">
        <span className="property-value-text" title={value}>
          {value}
        </span>
        {copyable && (
          <button
            className="property-copy-btn"
            onClick={handleCopy}
            aria-label={copyLabel}
            title={copyLabel}
          >
            📋
          </button>
        )}
      </td>
    </tr>
  );
}
