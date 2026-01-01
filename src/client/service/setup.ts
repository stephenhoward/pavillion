import axios from 'axios';

/**
 * Setup status response interface
 */
export interface SetupStatusResponse {
  setupRequired: boolean;
}

/**
 * Setup request data interface
 */
export interface SetupRequestData {
  email: string;
  password: string;
  siteTitle: string;
  registrationMode: string;
  defaultLanguage: string;
}

/**
 * Service for handling first-run setup operations.
 * Used during initial Docker deployment to configure the admin account.
 */
export default class SetupService {
  /**
   * Checks if setup is required (no admin account exists).
   *
   * @returns Promise resolving to setup status
   */
  async checkSetupStatus(): Promise<SetupStatusResponse> {
    try {
      const response = await axios.get('/api/v1/setup/status');
      return response.data;
    }
    catch (error) {
      // If the endpoint returns 404, setup is not required
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return { setupRequired: false };
      }
      throw error;
    }
  }

  /**
   * Completes the initial setup by creating the admin account and configuring settings.
   *
   * @param data - Setup request data including email, password, site title, and registration mode
   * @throws Error if setup fails or has already been completed
   */
  async completeSetup(data: SetupRequestData): Promise<void> {
    try {
      await axios.post('/api/v1/setup', data);
    }
    catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 404) {
          throw new Error('setup_already_completed');
        }
        if (error.response?.data?.error) {
          throw new Error(error.response.data.error);
        }
      }
      throw error;
    }
  }
}
