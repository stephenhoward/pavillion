import axios, { AxiosError } from 'axios';
import { PrimaryModel } from '@/common/model/model';
import { validateAndEncodeId } from '@/client/service/utils';
import ListResult from '@/client/service/list-result';

export default class ModelService {


  /**
   * Fetches a model from the server by its ID.
   *
   * @param {string} url - The API endpoint URL
   * @returns {Promise<Record<string,any>>} A promise resolving to the model data
   * @throws Will throw an error if the request fails
   */
  static async getModel(url: string): Promise<Record<string,any>|null> {
    try {
      let response = await axios.get( url );
      return response.data;
    }
    catch(error) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        if (axiosError.response?.status == 404) {
          return null;
        }
      }
      throw( error );
    }
  }

  /**
   * Sends model data to the server to create a new record.
   *
   * @param {PrimaryModel} model - The model instance to create
   * @param {string} url - The API endpoint URL
   * @returns {Promise<Record<string,any>>} A promise resolving to the created model data
   * @throws Will throw an error if the request fails
   */
  static async createModel(model: PrimaryModel,url: string): Promise<Record<string,any>> {

    try {
      let response = await axios.post( url, model.toObject() );
      model.id = response.data.id;
      return response.data;
    }
    catch(error) {
      throw( error );
    }
  }

  /**
   * Sends model data to the server to update and existing record.
   *
   * @param {PrimaryModel} model - The model instance to update
   * @param {string} url - The base API endpoint URL
   * @returns {Promise<Record<string,any>>} A promise resolving to the returned model data
   * @throws Will throw an error if the request fails
   */
  static async updateModel(model: PrimaryModel,url: string): Promise<Record<string,any>> {

    try {
      let response = await axios.put( url + '/' + model.id, model.toObject() );
      return response.data;
    }
    catch(error) {
      throw( error );
    }
  }

  /**
   * Fetches a list of models from the server.
   *
   * When dataKey is not provided, treats response.data as a flat array and
   * returns a ListResult with no pagination. When dataKey is provided,
   * extracts items from response.data[dataKey] and pagination metadata from
   * response.data.pagination, returning a paginated ListResult with a
   * fetch function for navigating pages.
   *
   * @param url - The API endpoint URL to fetch models from
   * @param options - Optional configuration
   * @param options.dataKey - Key to extract items from a paginated response envelope
   * @returns A promise resolving to a ListResult wrapping the response data
   * @throws Will throw an error if the request fails
   */
  static async listModels(url: string, options?: { dataKey?: string }): Promise<ListResult> {

    try {
      let response = await axios.get( url );

      if (options?.dataKey) {
        const items = response.data[options.dataKey] || [];
        const pagination = response.data.pagination;

        const fetchFn = (page: number): Promise<ListResult> => {
          const pageUrl = new URL(url, 'http://localhost');
          pageUrl.searchParams.set('page', String(page));
          const updatedUrl = pageUrl.pathname + pageUrl.search;
          return ModelService.listModels(updatedUrl, options);
        };

        return ListResult.fromPaginated(items, pagination, fetchFn);
      }

      return ListResult.fromArray(response.data);
    }
    catch(error) {
      throw( error );
    }
  }

  /**
     * Delete a model from the server
     * @param model - The model to delete
     * @param url - The base URL for the API endpoint
     * @returns Promise resolving to the server response data
     */
  static async deleteModel(model: PrimaryModel, url: string): Promise<Record<string,any>> {
    try {
      const encodedId = validateAndEncodeId(model.id, 'Model ID');
      let response = await axios.delete(`${url}/${encodedId}`);
      return response.data;
    }
    catch(error) {
      throw(error);
    }
  }

  /**
   * Delete a resource by URL
   * @param url - The complete URL for the resource to delete
   * @returns Promise resolving to the server response data
   */
  static async delete(url: string): Promise<Record<string,any>> {
    try {
      let response = await axios.delete(url);
      return response.data;
    }
    catch(error) {
      throw(error);
    }
  }
}
