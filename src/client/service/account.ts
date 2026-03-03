import axios from 'axios';
import { Account } from '@/common/model/account';
import { UnauthenticatedError, UnknownError } from '@/common/exceptions';
import { handleApiError } from '@/client/service/utils';

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
      handleApiError(error, errorMap);
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
      handleApiError(error, errorMap);
    }
  }

  /**
   * Update the current user's preferred language.
   *
   * Persists the language preference to the server so it is remembered across
   * sessions and devices.
   *
   * @param language - The language code to persist (e.g. 'es', 'en')
   * @returns Promise<void>
   */
  async updateLanguage(language: string): Promise<void> {
    try {
      await axios.patch('/api/v1/accounts/me/profile', {
        language,
      });
    }
    catch (error) {
      console.error('Error updating language preference:', error);
      handleApiError(error, errorMap);
    }
  }
}
