import axios from 'axios';

import { BlockedReporter } from '@/common/model/blocked_reporter';
import { UnknownError } from '@/common/exceptions/base';

/**
 * Error name mapping for blocked reporters API errors.
 */
const errorMap: Record<string, new (...args: any[]) => Error> = {
  ValidationError: class ValidationError extends Error {
    constructor() { super('Invalid input'); this.name = 'ValidationError'; }
  },
};

/**
 * Maps backend error responses to domain-specific exceptions.
 *
 * @param error - The error from the API call
 */
function handleBlockedReportersError(error: unknown): void {
  if (error && typeof error === 'object' && 'response' in error &&
      error.response && typeof error.response === 'object' && 'data' in error.response) {

    const responseData = error.response.data as Record<string, unknown>;
    const errorName = responseData.errorName as string;

    if (errorName && errorName in errorMap) {
      const ErrorClass = errorMap[errorName];
      throw new ErrorClass();
    }
  }
}

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
      handleBlockedReportersError(error);
      throw new UnknownError();
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
      handleBlockedReportersError(error);
      throw new UnknownError();
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
      handleBlockedReportersError(error);
      throw new UnknownError();
    }
  }
}
