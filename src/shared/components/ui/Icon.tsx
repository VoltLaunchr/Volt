import React from 'react';
import {
  File,
  Calculator,
  Search,
  Terminal,
  FolderOpen,
  Zap,
  Settings,
  X,
  ChevronRight,
  FileText,
  FileArchive,
  FileImage,
  FileVideo,
  FileAudio,
  FileCode,
  Gamepad2,
  type LucideIcon,
} from 'lucide-react';

// Map icon names to Lucide components
const iconMap: Record<string, LucideIcon> = {
  file: File,
  calculator: Calculator,
  search: Search,
  terminal: Terminal,
  folder: FolderOpen,
  zap: Zap,
  settings: Settings,
  close: X,
  chevronRight: ChevronRight,
  fileText: FileText,
  fileArchive: FileArchive,
  fileImage: FileImage,
  fileVideo: FileVideo,
  fileAudio: FileAudio,
  fileCode: FileCode,
  gamepad: Gamepad2,
};

interface IconProps {
  name: string;
  size?: number;
  className?: string;
  strokeWidth?: number;
}

export const Icon: React.FC<IconProps> = ({ name, size = 24, className = '', strokeWidth = 2 }) => {
  const IconComponent = iconMap[name] || File;

  return <IconComponent size={size} strokeWidth={strokeWidth} className={className} />;
};

// Export individual icons for direct use
export {
  File,
  Calculator,
  Search,
  Terminal,
  FolderOpen,
  Zap,
  Settings,
  X,
  ChevronRight,
  FileText,
  FileArchive,
  FileImage,
  FileVideo,
  FileAudio,
  FileCode,
  Gamepad2,
};
