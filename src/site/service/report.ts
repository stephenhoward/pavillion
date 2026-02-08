import axios from 'axios';
import { DuplicateReportError, RateLimitError, ReportValidationError } from '@/common/exceptions/report';
import { UnknownError } from '@/common/exceptions/base';

/**
 * Service for submitting event reports from the public site.
 * Encapsulates the API call and maps HTTP error responses
 * to domain-specific exceptions.
 */
export default class ReportService {

  /**
   * Submits a report for a specific event.
   *
   * @param eventId - The ID of the event being reported
   * @param category - The report category (e.g. spam, inappropriate)
   * @param description - The report description text
   * @param email - The reporter's email address
   * @throws {DuplicateReportError} When a report already exists (409)
   * @throws {RateLimitError} When too many reports have been submitted (429)
   * @throws {ReportValidationError} When the server rejects the input (400)
   * @throws {UnknownError} For all other server or network errors
   */
  async submitReport(
    eventId: string,
    category: string,
    description: string,
    email: string,
  ): Promise<void> {
    try {
      await axios.post(`/api/public/v1/events/${eventId}/reports`, {
        category,
        description,
        email,
      });
    }
    catch (error: unknown) {
      if (axios.isAxiosError(error) && error.response) {
        const status = error.response.status;
        if (status === 409) {
          throw new DuplicateReportError();
        }
        else if (status === 429) {
          throw new RateLimitError();
        }
        else if (status === 400) {
          const message = error.response.data?.error;
          throw new ReportValidationError(message || undefined);
        }
      }
      throw new UnknownError();
    }
  }
}
