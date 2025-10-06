import axios, { AxiosError } from 'axios';
import { PrimaryModel } from '@/common/model/model';
import { validateAndEncodeId } from '@/client/service/utils';

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
   * @param {string} url - The API endpoint URL to fetch models from
   * @returns {Promise<Record<string,any>[]>} A promise resolving to an array of model data
   * @throws Will throw an error if the request fails
   */
  static async listModels(url: string): Promise<Record<string,any>[]> {

    try {
      let response = await axios.get( url );
      return response.data;
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
