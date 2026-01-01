import path from 'path';
import { Disk } from 'flydrive';

/**
 * Configuration for storage drivers
 */
export interface StorageConfig {
  driver: 'local' | 's3' | 'gcs' | 'memory';

  // S3 driver configuration
  bucket?: string;
  region?: string;
  endpoint?: string;
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
  };

  // Local driver configuration
  basePath?: string;
}

/**
 * Resolves the storage path, handling both absolute and relative paths.
 *
 * @param storagePath - The path from configuration
 * @returns Absolute path for storage location
 */
function resolveStoragePath(storagePath: string): string {
  // If path is absolute (starts with /), use it directly
  if (path.isAbsolute(storagePath)) {
    return storagePath;
  }
  // Otherwise, resolve relative to current working directory
  return path.join(process.cwd(), storagePath);
}

/**
 * Creates a Flydrive Disk instance based on configuration
 * All storage uses private visibility for security
 */
export async function createStorageDisk(config: StorageConfig, basePath?: string): Promise<Disk> {
  switch (config.driver) {
    case 'local': {
      const { FSDriver } = await import('flydrive/drivers/fs');
      const storagePath = resolveStoragePath(basePath || config.basePath || '/storage/media');
      return new Disk(new FSDriver({
        location: new URL(`file://${storagePath}`),
        visibility: 'private',
      }));
    }

    case 's3': {
      if (!config.bucket || !config.region || !config.credentials) {
        throw new Error('S3 driver requires bucket, region, and credentials configuration');
      }

      const { S3Driver } = await import('flydrive/drivers/s3');

      // Build S3 driver options
      const s3Options: {
        credentials: { accessKeyId: string; secretAccessKey: string };
        bucket: string;
        region: string;
        visibility: 'private';
        endpoint?: string;
      } = {
        credentials: config.credentials,
        bucket: config.bucket,
        region: config.region,
        visibility: 'private',
      };

      // Add custom endpoint if configured (for S3-compatible services)
      if (config.endpoint) {
        s3Options.endpoint = config.endpoint;
      }

      return new Disk(new S3Driver(s3Options));
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
