import axios from 'axios';
import { Account } from '@/common/model/account';
import { UnauthenticatedError, UnknownError } from '@/common/exceptions';

const errorMap = {
  UnauthenticatedError,
  UnknownError,
};

export default class AccountService {

  /**
   * Get the current user's profile
   * @returns Promise<Account> The current user's account
   */
  async getProfile(): Promise<Account> {
    try {
      const response = await axios.get('/api/v1/accounts/me');
      return Account.fromObject(response.data);
    }
    catch (error) {
      console.error('Error fetching profile:', error);
      this.handleError(error);
      throw new UnknownError();
    }
  }

  /**
   * Update the current user's profile
   * @param displayName The new display name for the user
   * @returns Promise<Account> The updated account
   */
  async updateProfile(displayName: string): Promise<Account> {
    try {
      const response = await axios.patch('/api/v1/accounts/me/profile', {
        displayName,
      });
      return Account.fromObject(response.data);
    }
    catch (error) {
      console.error('Error updating profile:', error);
      this.handleError(error);
      throw new UnknownError();
    }
  }

  /**
   * Handle errors by mapping backend error names to frontend exception classes
   * @param error The error from the API call
   */
  private handleError(error: unknown): void {
    // Type guard to ensure error is the expected shape
    if (error && typeof error === 'object' && 'response' in error &&
        error.response && typeof error.response === 'object' && 'data' in error.response) {

      const responseData = error.response.data as Record<string, unknown>;
      const errorName = responseData.errorName as string;

      if (errorName && errorName in errorMap) {
        const ErrorClass = errorMap[errorName as keyof typeof errorMap];
        throw new ErrorClass();
      }
    }
  }
}
