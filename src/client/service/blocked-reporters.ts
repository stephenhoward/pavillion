import axios from 'axios';

import { BlockedReporter } from '@/common/model/blocked_reporter';
import { handleApiError } from '@/client/service/utils';

/**
 * Error name mapping for blocked reporters API errors.
 */
const errorMap: Record<string, new (...args: any[]) => Error> = {
  ValidationError: class ValidationError extends Error {
    constructor() { super('Invalid input'); this.name = 'ValidationError'; }
  },
};

/**
 * Client service for admin blocked reporters endpoints.
 *
 * Provides methods for listing, blocking, and unblocking reporter
 * email addresses in the moderation system.
 */
export default class BlockedReportersService {

  /**
   * Fetches list of all blocked reporters.
   *
   * @returns Array of blocked reporter domain models
   */
  async listBlockedReporters(): Promise<BlockedReporter[]> {
    try {
      const response = await axios.get('/api/v1/admin/moderation/blocked-reporters');
      return response.data.map((data: Record<string, any>) => BlockedReporter.fromObject(data));
    }
    catch (error: unknown) {
      console.error('Error fetching blocked reporters:', error);
      handleApiError(error, errorMap);
    }
  }

  /**
   * Blocks a reporter email address.
   *
   * @param email - The email address to block
   * @param reason - Reason for blocking the reporter
   * @returns The newly created BlockedReporter
   */
  async blockReporter(email: string, reason: string): Promise<BlockedReporter> {
    try {
      const response = await axios.post('/api/v1/admin/moderation/blocked-reporters', {
        email,
        reason,
      });
      return BlockedReporter.fromObject(response.data);
    }
    catch (error: unknown) {
      console.error('Error blocking reporter:', error);
      handleApiError(error, errorMap);
    }
  }

  /**
   * Unblocks a reporter email address.
   *
   * @param emailHash - The email hash to unblock
   */
  async unblockReporter(emailHash: string): Promise<void> {
    try {
      await axios.delete(`/api/v1/admin/moderation/blocked-reporters/${encodeURIComponent(emailHash)}`);
    }
    catch (error: unknown) {
      console.error('Error unblocking reporter:', error);
      handleApiError(error, errorMap);
    }
  }
}
