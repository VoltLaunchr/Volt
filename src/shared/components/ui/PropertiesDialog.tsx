import { AppInfo, FileInfo, SearchResult, SearchResultType } from '../../types/common.types';
import { Modal } from './Modal';
import './PropertiesDialog.css';

export interface PropertiesDialogProps {
  isOpen: boolean;
  onClose: () => void;
  result: SearchResult | null;
}

export function PropertiesDialog({ isOpen, onClose, result }: PropertiesDialogProps) {
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
          <PropertyRow label="Name" value={app.name} />
          <PropertyRow label="Path" value={app.path} copyable />
          <PropertyRow label="ID" value={app.id} />
          {app.description && <PropertyRow label="Description" value={app.description} />}
          {app.category && <PropertyRow label="Category" value={app.category} />}
          {app.keywords && app.keywords.length > 0 && (
            <PropertyRow label="Keywords" value={app.keywords.join(', ')} />
          )}
          <PropertyRow label="Usage Count" value={app.usageCount.toString()} />
          {app.lastUsed && <PropertyRow label="Last Used" value={formatDate(app.lastUsed)} />}
        </>
      );
    } else if (result.type === SearchResultType.File) {
      const file = result.data as FileInfo;
      return (
        <>
          <PropertyRow label="Name" value={file.name} />
          <PropertyRow label="Path" value={file.path} copyable />
          <PropertyRow label="Extension" value={file.extension} />
          <PropertyRow label="Size" value={formatBytes(file.size)} />
          <PropertyRow label="Modified" value={formatDate(file.modified)} />
          <PropertyRow label="ID" value={file.id} />
        </>
      );
    } else {
      return (
        <>
          <PropertyRow label="Title" value={result.title} />
          {result.subtitle && <PropertyRow label="Subtitle" value={result.subtitle} />}
          <PropertyRow label="Type" value={result.type} />
          <PropertyRow label="Score" value={result.score.toString()} />
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
}

function PropertyRow({ label, value, copyable }: PropertyRowProps) {
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
            aria-label="Copy to clipboard"
            title="Copy to clipboard"
          >
            📋
          </button>
        )}
      </td>
    </tr>
  );
}
