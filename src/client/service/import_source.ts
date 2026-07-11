import axios from 'axios';

import { ImportSource, ImportSourceVerificationType } from '@/common/model/import_source';
import {
  ImportSourceNotFoundError,
  ImportSourceFetchError,
  ImportSourceSsrfBlockedError,
  ImportSourceParseError,
  ImportSourceDnsVerificationError,
  ImportSourceRelMeVerificationError,
  ImportSourceVerifyRateLimitError,
  ImportSourceFileEmptyError,
  ImportSourceFileTooLargeError,
  ImportSourceFileBadFormatError,
  ImportSourceFileTooManyEventsError,
  ImportSourceCapExceededError,
} from '@/common/exceptions/import';
import { CalendarNotFoundError } from '@/common/exceptions/calendar';
import { CalendarEditorPermissionError } from '@/common/exceptions/editor';
import {
  UnauthenticatedError,
  UnknownError,
  ValidationError,
} from '@/common/exceptions/base';
import { validateAndEncodeId, handleApiError } from '@/client/service/utils';

/**
 * Summary payload returned from a manual sync run (`POST /import-sources/:id/sync`).
 *
 * Mirrors the subset of `ImportRunEntity` columns that the server exposes to
 * admin clients. The full wiring lands in pv-1qcp.2.4; this type is defined
 * here so the service contract is stable for downstream components.
 */
export type ImportRunSummary = {
  id: string;
  importSourceId: string;
  startedAt: string;
  finishedAt: string | null;
  outcome:
    | 'success'
    | 'no_changes'
    | 'fetch_error'
    | 'parse_error'
    | 'ssrf_blocked'
    | 'dns_error';
  eventsCreated: number;
  eventsUpdated: number;
  eventsSkippedLocallyEdited: number;
  eventsDisappeared: number;
  errorMessage: string | null;
};

/**
 * Map of backend error names to their domain exception constructors. The
 * `handleApiError` helper reads the `errorName` field from an API error
 * response and rethrows the matching typed exception so components can
 * switch on exception type rather than inspecting response codes.
 *
 * @see backend-error-serialization — the contract that populates `errorName`
 */
const errorMap = {
  CalendarNotFoundError,
  CalendarEditorPermissionError,
  ImportSourceNotFoundError,
  ImportSourceFetchError,
  ImportSourceSsrfBlockedError,
  ImportSourceParseError,
  ImportSourceDnsVerificationError,
  ImportSourceRelMeVerificationError,
  ImportSourceVerifyRateLimitError,
  ImportSourceFileEmptyError,
  ImportSourceFileTooLargeError,
  ImportSourceFileBadFormatError,
  ImportSourceFileTooManyEventsError,
  ImportSourceCapExceededError,
  UnauthenticatedError,
  ValidationError,
  UnknownError,
};

/**
 * Success envelope for the file-upload create path
 * (`POST /import-sources/file`, HTTP 201). Bundles the newly persisted source
 * with a summary of the synchronous import run the upload triggered.
 */
export type ImportSourceFileResult = {
  source: ImportSource;
  run: ImportRunSummary;
};

/**
 * Typed client service for the per-calendar ICS import-source API. Backs the
 * admin UI for Milestone C of the ICS import epic (pv-1qcp).
 *
 * Responses deserialize into the shared `ImportSource` common model. Errors
 * are re-thrown as domain-specific typed exceptions using the
 * `backend-error-serialization` contract so callers can discriminate on
 * exception type.
 *
 * @see bead pv-1qcp.3.1
 */
export default class ImportSourceService {

  /**
   * List all import sources for a calendar.
   *
   * @param calendarId - UUID of the owning calendar
   * @returns List of import sources (may be empty)
   */
  async listSources(calendarId: string): Promise<ImportSource[]> {
    const encodedCalendarId = validateAndEncodeId(calendarId, 'Calendar ID');

    try {
      const response = await axios.get(
        `/api/v1/calendars/${encodedCalendarId}/import-sources`,
      );
      return (response.data as Record<string, unknown>[]).map(item =>
        ImportSource.fromObject(item),
      );
    }
    catch (error: unknown) {
      handleApiError(error, errorMap);
    }
  }

  /**
   * Create a new import source for a calendar.
   *
   * The verification token is NOT included in the response; it is surfaced
   * only by the verify-issue flow.
   *
   * @param calendarId - UUID of the owning calendar
   * @param url - The ICS feed URL
   * @returns The newly persisted import source
   */
  async createSource(calendarId: string, url: string): Promise<ImportSource> {
    const encodedCalendarId = validateAndEncodeId(calendarId, 'Calendar ID');

    try {
      const response = await axios.post(
        `/api/v1/calendars/${encodedCalendarId}/import-sources`,
        { url },
      );
      return ImportSource.fromObject(response.data);
    }
    catch (error: unknown) {
      handleApiError(error, errorMap);
    }
  }

  /**
   * Create a new import source from an uploaded .ics file.
   *
   * Wraps the file in a multipart `FormData` under the `file` field (the
   * multer field name the endpoint reads) and POSTs it. The multipart
   * `Content-Type` and boundary are intentionally left to the browser — a
   * manually-set header would omit the boundary and break parsing on the
   * server.
   *
   * Returns the persisted source together with a summary of the synchronous
   * import run the upload kicked off.
   *
   * @param calendarId - UUID of the owning calendar
   * @param file - The `.ics` file selected by the user
   * @returns The newly persisted source and its import-run summary
   */
  async createSourceFromFile(
    calendarId: string,
    file: File,
  ): Promise<ImportSourceFileResult> {
    const encodedCalendarId = validateAndEncodeId(calendarId, 'Calendar ID');

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await axios.post(
        `/api/v1/calendars/${encodedCalendarId}/import-sources/file`,
        formData,
      );
      const data = response.data as {
        source: Record<string, unknown>;
        run: ImportRunSummary;
      };
      return {
        source: ImportSource.fromObject(data.source),
        run: data.run,
      };
    }
    catch (error: unknown) {
      handleApiError(error, errorMap);
    }
  }

  /**
   * Fetch a single import source by id.
   *
   * @param calendarId - UUID of the owning calendar
   * @param id - UUID of the import source
   * @returns The import source
   */
  async getSource(calendarId: string, id: string): Promise<ImportSource> {
    const encodedCalendarId = validateAndEncodeId(calendarId, 'Calendar ID');
    const encodedId = validateAndEncodeId(id, 'Import Source ID');

    try {
      const response = await axios.get(
        `/api/v1/calendars/${encodedCalendarId}/import-sources/${encodedId}`,
      );
      return ImportSource.fromObject(response.data);
    }
    catch (error: unknown) {
      handleApiError(error, errorMap);
    }
  }

  /**
   * Delete an import source.
   *
   * @param calendarId - UUID of the owning calendar
   * @param id - UUID of the import source to delete
   */
  async deleteSource(calendarId: string, id: string): Promise<void> {
    const encodedCalendarId = validateAndEncodeId(calendarId, 'Calendar ID');
    const encodedId = validateAndEncodeId(id, 'Import Source ID');

    try {
      await axios.delete(
        `/api/v1/calendars/${encodedCalendarId}/import-sources/${encodedId}`,
      );
    }
    catch (error: unknown) {
      handleApiError(error, errorMap);
    }
  }

  /**
   * Fetch the verification challenge token for an import source. The
   * token is owner-only data used to render the `pavillion-verify=v1:...`
   * artifact the owner must publish (a TXT record for `dns-txt`, an
   * `<a rel="me">` backlink for `rel-me`). Repeated calls return the same
   * deterministic token.
   *
   * @param calendarId - UUID of the owning calendar
   * @param id - UUID of the import source to issue a challenge for
   * @param verificationType - Optional verifier discriminator; defaults to
   *   the source's existing `verificationType` on the server when omitted.
   * @returns The per-source HMAC challenge token
   */
  async issueChallenge(
    calendarId: string,
    id: string,
    verificationType?: ImportSourceVerificationType,
  ): Promise<string> {
    const encodedCalendarId = validateAndEncodeId(calendarId, 'Calendar ID');
    const encodedId = validateAndEncodeId(id, 'Import Source ID');

    const body: Record<string, unknown> = {};
    if (verificationType !== undefined) {
      body.verification_type = verificationType;
    }

    try {
      const response = await axios.post(
        `/api/v1/calendars/${encodedCalendarId}/import-sources/${encodedId}/verify-issue`,
        body,
      );
      const data = response.data as { challengeToken?: string };
      return data.challengeToken ?? '';
    }
    catch (error: unknown) {
      handleApiError(error, errorMap);
    }
  }

  /**
   * Trigger a verification attempt for an import source. Returns the
   * updated source reflecting the new verification state.
   *
   * @param calendarId - UUID of the owning calendar
   * @param id - UUID of the import source to verify
   * @param verificationPageUrl - Optional URL of the page hosting the
   *   `rel="me"` backlink. Required by the server only for `rel-me`
   *   verification; ignored by the `dns-txt` flow.
   * @returns The updated import source
   */
  async verifySource(
    calendarId: string,
    id: string,
    verificationPageUrl?: string,
  ): Promise<ImportSource> {
    const encodedCalendarId = validateAndEncodeId(calendarId, 'Calendar ID');
    const encodedId = validateAndEncodeId(id, 'Import Source ID');

    const body: Record<string, unknown> = {};
    if (verificationPageUrl !== undefined) {
      body.verification_page_url = verificationPageUrl;
    }

    try {
      const response = await axios.post(
        `/api/v1/calendars/${encodedCalendarId}/import-sources/${encodedId}/verify`,
        body,
      );
      return ImportSource.fromObject(response.data);
    }
    catch (error: unknown) {
      handleApiError(error, errorMap);
    }
  }

  /**
   * Trigger a manual sync run for an import source. Returns a summary of
   * the run outcome and counts of events affected.
   *
   * @param calendarId - UUID of the owning calendar
   * @param id - UUID of the import source to sync
   * @returns Summary of the sync run
   */
  async syncSource(calendarId: string, id: string): Promise<ImportRunSummary> {
    const encodedCalendarId = validateAndEncodeId(calendarId, 'Calendar ID');
    const encodedId = validateAndEncodeId(id, 'Import Source ID');

    try {
      const response = await axios.post(
        `/api/v1/calendars/${encodedCalendarId}/import-sources/${encodedId}/sync`,
      );
      return response.data as ImportRunSummary;
    }
    catch (error: unknown) {
      handleApiError(error, errorMap);
    }
  }
}
