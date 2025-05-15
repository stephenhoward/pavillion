import { Calendar } from '@/common/model/calendar';
import ModelService from '@/client/service/models';
import { UrlNameAlreadyExistsError, InvalidUrlNameError } from '@/common/exceptions/calendar';
import { UnauthenticatedError, UnknownError, EmptyValueError } from '@/common/exceptions';

const errorMap = {
  UrlNameAlreadyExistsError,
  InvalidUrlNameError,
  UnauthenticatedError,
  UnknownError,
};

export default class CalendarService {

  static async loadCalendars(): Promise<Array<Calendar>> {
    let calendars = await ModelService.listModels('/api/v1/calendars');
    return calendars.map(calendar => Calendar.fromObject(calendar));
  }

  // Create a new calendar with the name from the input field
  // TODO: run this function when the user hits enter
  static async createCalendar(urlName: string): Promise<Calendar> {

    console.log(urlName);
    if (!urlName || urlName.trim() === '') {
      console.log("it was empty");
      throw new EmptyValueError('urlName is empty');
    }

    try {
      const createdCalendar = await ModelService.createModel(new Calendar(undefined, urlName.trim()), '/api/v1/calendars');
      return Calendar.fromObject(createdCalendar);
    }
    catch (error: unknown) {
      console.error('Error creating calendar:', error);

      // Type guard to ensure error is the expected shape
      if (error && typeof error === 'object' && 'response' in error &&
          error.response && typeof error.response === 'object' && 'data' in error.response) {

        const errorName = error.response.data.errorName;

        if (errorName && errorName in errorMap) {
          const ErrorClass = errorMap[errorName as keyof typeof errorMap];
          throw new ErrorClass();
        }
      }

      throw new UnknownError();
    }
  }
}
