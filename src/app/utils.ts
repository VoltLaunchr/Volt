export const getDirectoryPath = (filePath: string): string => {
  const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  if (lastSlash === -1) return '.';
  const dirPath = filePath.substring(0, lastSlash);
  return dirPath || '/';
};
