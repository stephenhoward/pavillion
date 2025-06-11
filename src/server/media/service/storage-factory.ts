import { Disk } from 'flydrive';

/**
 * Configuration for storage drivers
 * All storage operations use private visibility for security
 */
export interface StorageConfig {
  driver: 'local' | 's3' | 'gcs' | 'memory';

  // S3 driver configuration
  bucket?: string;
  region?: string;
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
  };

  // Local driver configuration
  basePath?: string;
}

/**
 * Creates a Flydrive Disk instance based on configuration
 * All storage uses private visibility for security
 */
export async function createStorageDisk(config: StorageConfig, basePath?: string): Promise<Disk> {
  switch (config.driver) {
    case 'local': {
      const { FSDriver } = await import('flydrive/drivers/fs');
      return new Disk(new FSDriver({
        location: new URL(`file://${basePath || config.basePath || process.cwd()}`),
        visibility: 'private',
      }));
    }

    case 's3': {
      if (!config.bucket || !config.region || !config.credentials) {
        throw new Error('S3 driver requires bucket, region, and credentials configuration');
      }

      const { S3Driver } = await import('flydrive/drivers/s3');
      return new Disk(new S3Driver({
        credentials: config.credentials,
        bucket: config.bucket,
        region: config.region,
        visibility: 'private',
      }));
    }

    case 'memory': {
      // For testing - create an in-memory storage using a temporary directory
      return createMemoryDisk();
    }

    case 'gcs': {
      throw new Error('GCS driver not yet implemented - use local storage for now');
    }

    default:
      throw new Error(`Unsupported storage driver: ${config.driver}`);
  }
}

/**
 * Creates an in-memory disk for testing using a temporary directory
 */
async function createMemoryDisk(): Promise<Disk> {
  const { FSDriver } = await import('flydrive/drivers/fs');
  // Use FSDriver with a temporary directory for memory simulation
  const tmpDir = new URL(`file:///tmp/pavillion-memory-storage-${Date.now()}/`);

  return new Disk(new FSDriver({
    location: tmpDir,
    visibility: 'private',
  }));
}
