import axios from 'axios';
import { PrimaryModel } from '../../common/model/model';

export default class ModelService {

    static async createModel(model: PrimaryModel,url: string): Promise<Record<string,any>> {

        try {
            let response = await axios.post( url, model.toObject() );
            model.id = response.data.id;
            const constructor = model.constructor as typeof PrimaryModel;
            return response.data;
        }
        catch(error) {
            throw( error );
        }
    }

    static async updateModel(model: PrimaryModel,url: string): Promise<Record<string,any>> {

        try {
            let response = await axios.post( url + '/' + model.id, model.toObject() );
            return response.data;
        }
        catch(error) {
            throw( error );
        }
    }

    static async listModels(url: string): Promise<Record<string,any>[]> {
            
        try {
            let response = await axios.get( url );
            return response.data;
        }
        catch(error) {
            throw( error );
        }
    }
}