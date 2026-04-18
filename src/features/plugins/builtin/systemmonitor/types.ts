export interface CpuCoreInfo {
  name: string;
  usagePercent: number;
  frequencyMhz: number;
}

export interface DiskInfo {
  mountPoint: string;
  totalGb: number;
  usedGb: number;
  availableGb: number;
  fileSystem: string;
  kind: 'SSD' | 'HDD' | 'Unknown';
}

export interface NetworkInterfaceInfo {
  name: string;
  receivedBytesPerSec: number;
  transmittedBytesPerSec: number;
  totalReceivedBytes: number;
  totalTransmittedBytes: number;
}

export interface NetworkInfo {
  receivedBytesPerSec: number;
  transmittedBytesPerSec: number;
  interfaces: NetworkInterfaceInfo[];
}

export interface ProcessInfo {
  pid: number;
  name: string;
  cpuUsagePercent: number;
  memoryBytes: number;
}

export interface ComponentInfo {
  label: string;
  temperatureC: number | null;
  maxC: number | null;
  criticalC: number | null;
}

export interface SystemMetricsV2 {
  cpuUsage: number;
  memoryUsage: number;
  diskUsage: number;
  memoryTotalGb: number;
  memoryUsedGb: number;
  diskTotalGb: number;
  diskUsedGb: number;
  perCoreCpu: CpuCoreInfo[];
  perDisk: DiskInfo[];
  network: NetworkInfo;
  topCpuProcesses: ProcessInfo[];
  topMemoryProcesses: ProcessInfo[];
  uptimeSeconds: number;
  components: ComponentInfo[];
}
