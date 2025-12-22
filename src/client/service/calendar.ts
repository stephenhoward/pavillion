import axios from 'axios';
import { Calendar, DefaultDateRange } from '@/common/model/calendar';
import { CalendarEvent } from '@/common/model/events';
import { CalendarEditor } from '@/common/model/calendar_editor';
import { CalendarInfo } from '@/common/model/calendar_info';
import ModelService from '@/client/service/models';
import { UrlNameAlreadyExistsError, InvalidUrlNameError, CalendarNotFoundError } from '@/common/exceptions/calendar';
import { CalendarEditorPermissionError, EditorAlreadyExistsError, EditorNotFoundError } from '@/common/exceptions/editor';
import { UnauthenticatedError, UnknownError, EmptyValueError, AccountInviteAlreadyExistsError } from '@/common/exceptions';
import { useCalendarStore } from '@/client/stores/calendarStore';
import { validateAndEncodeId } from '@/client/service/utils';

import {
  BulkEventsNotFoundError,
  CategoriesNotFoundError,
  MixedCalendarEventsError,
  InsufficientCalendarPermissionsError,
} from '@/common/exceptions/calendar';

const errorMap = {
  UrlNameAlreadyExistsError,
  InvalidUrlNameError,
  CalendarNotFoundError,
  CalendarEditorPermissionError,
  EditorAlreadyExistsError,
  EditorNotFoundError,
  BulkEventsNotFoundError,
  CategoriesNotFoundError,
  MixedCalendarEventsError,
  InsufficientCalendarPermissionsError,
  UnauthenticatedError,
  UnknownError,
  AccountInviteAlreadyExistsError,
};

export default class CalendarService {
  store: ReturnType<typeof useCalendarStore>;

  constructor(store: ReturnType<typeof useCalendarStore> = useCalendarStore()) {
    this.store = store;
  }

  /**
   * Load calendars from the server if needed, updating the store
   * @returns Promise<Array<Calendar>> The list of calendars
   */
  async loadCalendars(forceLoad?: boolean): Promise<Array<Calendar>> {

    // If calendars are already loaded in the store, return them
    if (!forceLoad && this.store.loaded && this.store.calendars.length > 0) {
      return this.store.calendars;
    }

    // Otherwise, fetch from the server and update the store
    try {
      const calendarsData = await ModelService.listModels('/api/v1/calendars');
      const calendars = calendarsData.map(calendar => Calendar.fromObject(calendar));

      // Update the store with fetched calendars
      this.store.setCalendars(calendars);

      return calendars;
    }
    catch (error) {
      console.error('Error loading calendars:', error);
      throw error;
    }
  }

  /**
   * Load calendars with relationship information (owner vs editor)
   * @returns Promise<Array<CalendarInfo>> The list of calendars with relationship info
   */
  async loadCalendarsWithRelationship(): Promise<Array<CalendarInfo>> {
    try {
      const calendarsData = await ModelService.listModels('/api/v1/calendars');
      return calendarsData.map(calendarData => CalendarInfo.fromObject(calendarData));
    }
    catch (error) {
      console.error('Error loading calendars with relationship:', error);
      throw error;
    }
  }

  /**
   * Create a new calendar with the given name
   * @param urlName The URL name for the calendar
   * @returns Promise<Calendar> The newly created calendar
   */
  async createCalendar(urlName: string): Promise<Calendar> {
    if (!urlName || urlName.trim() === '') {
      throw new EmptyValueError('urlName is empty');
    }

    try {
      const createdCalendar = await ModelService.createModel(
        new Calendar(undefined, urlName.trim()),
        '/api/v1/calendars',
      );
      const newCalendar = Calendar.fromObject(createdCalendar);

      // Add the new calendar to the store
      this.store.addCalendar(newCalendar);

      return newCalendar;
    }
    catch (error: unknown) {
      console.error('Error creating calendar:', error);

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

      throw new UnknownError();
    }
  }

  /**
   * Get a calendar by its URL name
   * @param urlName The URL name of the calendar
   * @returns Promise<Calendar|null> The calendar or null if not found
   */
  async getCalendarByUrlName(urlName: string): Promise<Calendar | null> {

    // Ensure calendars are loaded
    await this.loadCalendars();

    return this.store.getCalendarByUrlName(urlName);
  }
  /**
   * Get a calendar by its ID
   * @param calendarId The ID of the calendar
   * @returns Promise<Calendar|null> The calendar or null if not found
   */
  async getCalendarById(calendarId: string): Promise<Calendar | null> {
    // Ensure calendars are loaded
    await this.loadCalendars();

    return this.store.getCalendarById(calendarId);
  }

  /**
   * Updates a calendar on the server and in the store
   * @param calendar The calendar to update
   * @returns Promise<Calendar> The updated calendar
   */
  async updateCalendar(calendar: Calendar): Promise<Calendar> {
    try {
      const updatedCalendarData = await ModelService.updateModel(
        calendar,
        '/api/v1/calendars',
      );
      const updatedCalendar = Calendar.fromObject(updatedCalendarData);

      // Update the store
      this.store.updateCalendar(updatedCalendar);

      return updatedCalendar;
    }
    catch (error) {
      console.error('Error updating calendar:', error);
      throw error;
    }
  }

  /**
   * Deletes a calendar from the server and removes it from the store
   * @param calendar The calendar to delete
   * @returns Promise<void>
   */
  async deleteCalendar(calendar: Calendar): Promise<void> {
    try {
      await ModelService.deleteModel(calendar, '/api/v1/calendars');

      // Remove from the store
      this.store.removeCalendar(calendar);
    }
    catch (error) {
      console.error('Error deleting calendar:', error);
      throw error;
    }
  }

  /**
   * List all editors and pending invitations for a calendar
   * @param calendarId The ID of the calendar
   * @returns Promise<{activeEditors: CalendarEditor[], pendingInvitations: any[]}> Enhanced editors data
   */
  async listCalendarEditors(calendarId: string): Promise<{activeEditors: CalendarEditor[], pendingInvitations: any[]}> {
    try {
      const encodedId = validateAndEncodeId(calendarId, 'Calendar ID');
      const response = await axios.get(`/api/v1/calendars/${encodedId}/editors`);
      return {
        activeEditors: response.data.activeEditors.map((editor: Record<string, any>) => CalendarEditor.fromObject(editor)),
        pendingInvitations: response.data.pendingInvitations || [],
      };
    }
    catch (error: unknown) {
      console.error('Error listing calendar editors:', error);
      this.handleEditorError(error);
      throw new UnknownError();
    }
  }

  /**
   * Grant edit access to a user for a calendar
   * @param calendarId The ID of the calendar
   * @param accountId The ID of the account to grant access
   * @returns Promise<CalendarEditor> The created editor relationship
   */
  async grantEditAccess(calendarId: string, email: string): Promise<CalendarEditor> {
    if (!email || email.trim() === '') {
      throw new EmptyValueError('accountId is empty');
    }

    try {
      const encodedId = validateAndEncodeId(calendarId, 'Calendar ID');
      const response = await axios.post(`/api/v1/calendars/${encodedId}/editors`, {
        email: email.trim(),
      });
      return CalendarEditor.fromObject(response.data);
    }
    catch (error: unknown) {
      console.error('Error granting edit access:', error);
      this.handleEditorError(error);
      throw new UnknownError();
    }
  }

  /**
   * Revoke edit access from a user for a calendar
   * @param calendarId The ID of the calendar
   * @param editorId The ID of the editor record to revoke access from
   * @returns Promise<void>
   */
  async revokeEditAccess(calendarId: string, editorId: string): Promise<void> {
    // Validate editorId first with the expected error message
    if (!editorId || !editorId.trim()) {
      throw new EmptyValueError('editorId is empty');
    }

    try {
      const encodedCalendarId = validateAndEncodeId(calendarId, 'Calendar ID');
      const encodedEditorId = validateAndEncodeId(editorId, 'Editor ID');
      await axios.delete(`/api/v1/calendars/${encodedCalendarId}/editors/${encodedEditorId}`);
    }
    catch (error: unknown) {
      console.error('Error revoking edit access:', error);
      this.handleEditorError(error);
      throw new UnknownError();
    }
  }

  /**
   * Cancel a pending invitation for a calendar
   * @param calendarId The ID of the calendar
   * @param invitationId The ID of the invitation to cancel
   * @returns Promise<void>
   */
  async cancelInvitation(calendarId: string, invitationId: string): Promise<void> {
    try {
      const encodedCalendarId = validateAndEncodeId(calendarId, 'Calendar ID');
      const encodedInvitationId = validateAndEncodeId(invitationId, 'Invitation ID');
      await axios.delete(`/api/v1/calendars/${encodedCalendarId}/invitations/${encodedInvitationId}`);
    }
    catch (error: unknown) {
      console.error('Error canceling invitation:', error);
      this.handleEditorError(error);
      throw new UnknownError();
    }
  }

  /**
   * Resend a pending invitation for a calendar
   * @param calendarId The ID of the calendar
   * @param invitationId The ID of the invitation to resend
   * @returns Promise<void>
   */
  async resendInvitation(calendarId: string, invitationId: string): Promise<void> {
    try {
      const encodedCalendarId = validateAndEncodeId(calendarId, 'Calendar ID');
      const encodedInvitationId = validateAndEncodeId(invitationId, 'Invitation ID');
      await axios.post(`/api/v1/calendars/${encodedCalendarId}/invitations/${encodedInvitationId}/resend`);
    }
    catch (error: unknown) {
      console.error('Error resending invitation:', error);
      this.handleEditorError(error);
      throw new UnknownError();
    }
  }


  /**
   * Assign categories to multiple events in bulk
   * @param eventIds Array of event IDs to assign categories to
   * @param categoryIds Array of category IDs to assign
   * @returns Promise<CalendarEvent[]> Array of updated events with their categories
   */
  async bulkAssignCategories(eventIds: string[], categoryIds: string[]): Promise<CalendarEvent[]> {
    if (!Array.isArray(eventIds) || eventIds.length === 0) {
      throw new EmptyValueError('eventIds must be a non-empty array');
    }

    if (!Array.isArray(categoryIds) || categoryIds.length === 0) {
      throw new EmptyValueError('categoryIds must be a non-empty array');
    }

    try {
      const response = await axios.post('/api/v1/events/bulk-assign-categories', {
        eventIds,
        categoryIds,
      });

      return response.data.map((eventData: Record<string, any>) => CalendarEvent.fromObject(eventData));
    }
    catch (error: unknown) {
      console.error('Error in bulk category assignment:', error);
      this.handleBulkOperationError(error);
      throw new UnknownError();
    }
  }

  /**
   * Update calendar settings
   * @param calendarId The ID of the calendar
   * @param settings The settings to update
   * @returns Promise<Calendar> The updated calendar
   */
  async updateCalendarSettings(
    calendarId: string,
    settings: { defaultDateRange?: DefaultDateRange },
  ): Promise<Calendar> {
    try {
      const encodedId = validateAndEncodeId(calendarId, 'Calendar ID');
      const response = await axios.patch(`/api/v1/calendars/${encodedId}/settings`, settings);
      const updatedCalendar = Calendar.fromObject(response.data);

      // Update the store
      this.store.updateCalendar(updatedCalendar);

      return updatedCalendar;
    }
    catch (error: unknown) {
      console.error('Error updating calendar settings:', error);
      this.handleEditorError(error);
      throw new UnknownError();
    }
  }

  /**
   * Handle bulk operation errors by mapping backend error names to frontend exception classes
   * @param error The error from the API call
   */
  private handleBulkOperationError(error: unknown): void {
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

  /**
   * Handle editor-related errors by mapping backend error names to frontend exception classes
   * @param error The error from the API call
   */
  private handleEditorError(error: unknown): void {
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
