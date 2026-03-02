import axios from 'axios';
import { DuplicateReportError, RateLimitError, ReportValidationError } from '@/common/exceptions/report';
import { handleApiError } from '@/site/service/utils';

const errorMap: Record<string, new (...args: any[]) => Error> = {
  DuplicateReportError,
  EmailRateLimitError: RateLimitError,
  ValidationError: ReportValidationError,
};

/**
 * Service for submitting event reports from the public site.
 * Encapsulates the API call and maps backend errorName responses
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
   * @throws {DuplicateReportError} When a report already exists
   * @throws {RateLimitError} When too many reports have been submitted
   * @throws {ReportValidationError} When the server rejects the input
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
      handleApiError(error, errorMap);
    }
  }
}
