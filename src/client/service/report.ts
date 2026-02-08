import axios from 'axios';
import { DuplicateReportError, ReportValidationError } from '@/common/exceptions/report';
import { EventNotFoundError } from '@/common/exceptions/calendar';
import { UnknownError } from '@/common/exceptions/base';

const errorMap: Record<string, new (...args: any[]) => Error> = {
  DuplicateReportError,
  EventNotFoundError,
  ValidationError: ReportValidationError,
};

/**
 * Service for submitting event reports from the authenticated client app.
 * Encapsulates the API call and maps backend errorName responses
 * to domain-specific exceptions.
 *
 * Unlike the site report service, no email parameter is needed
 * because the server identifies the reporter via JWT authentication.
 */
export default class ReportService {

  /**
   * Submits a report for a specific event as an authenticated user.
   *
   * @param eventId - The ID of the event being reported
   * @param category - The report category (e.g. spam, inappropriate)
   * @param description - The report description text
   * @throws {DuplicateReportError} When a report already exists for this user+event
   * @throws {EventNotFoundError} When the event does not exist
   * @throws {ReportValidationError} When the server rejects the input
   * @throws {UnknownError} For all other server or network errors
   */
  async submitReport(
    eventId: string,
    category: string,
    description: string,
  ): Promise<void> {
    try {
      await axios.post('/api/v1/reports', {
        eventId,
        category,
        description,
      });
    }
    catch (error: unknown) {
      if (error && typeof error === 'object' && 'response' in error &&
          error.response && typeof error.response === 'object' && 'data' in error.response) {

        const responseData = error.response.data as Record<string, unknown>;
        const errorName = responseData.errorName as string;

        if (errorName && errorName in errorMap) {
          const ErrorClass = errorMap[errorName];
          throw new ErrorClass();
        }
      }
      throw new UnknownError();
    }
  }
}
