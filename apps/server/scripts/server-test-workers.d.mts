export declare function serverTestWorkers(options?: {
  env?: Record<string, string | undefined>;
  detect?: () => {
    effectiveCpus: number;
    availableBytes: number;
    cgroupHeadroomBytes?: number;
  };
}): number;
