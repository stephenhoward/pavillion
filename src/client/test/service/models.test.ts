import { describe, it, expect, afterEach } from 'vitest';
import sinon from 'sinon';
import ModelService from '@/client/service/models';
import axios from 'axios';
import { PrimaryModel } from '@/common/model/model';

// Create a mock model class that extends PrimaryModel
class TestModel extends PrimaryModel {
  title: string;

  constructor(id?: string, title?: string) {
    super();
    this.id = id;
    this.title = title || '';
  }

  toObject(): Record<string, any> {
    return {
      id: this.id,
      title: this.title,
    };
  }
}

describe('ModelService', () => {
  const sandbox = sinon.createSandbox();

  afterEach(() => {
    sandbox.restore();
  });

  describe('createModel', () => {
    it('should create a model and update its ID', async () => {
      // Arrange
      const model = new TestModel(undefined, 'Test Model');
      const mockResponse = {
        data: { id: 'model123', title: 'Test Model' },
      };

      const postStub = sandbox.stub(axios, 'post').resolves(mockResponse);
      // method alters the passed in model, so we need to copy it:
      const modelCopy = model.toObject();

      // Act
      const result = await ModelService.createModel(model, '/api/models');

      // Assert
      expect(postStub.calledWith('/api/models', modelCopy)).toBe(true);
      expect(model.id).toBe('model123');
      expect(result).toEqual(mockResponse.data);
    });

    it('should throw an error when API call fails', async () => {
      // Arrange
      const model = new TestModel(undefined, 'Test Model');
      sandbox.stub(axios, 'post').rejects(new Error('API Error'));

      // Act & Assert
      await expect(ModelService.createModel(model, '/api/models'))
        .rejects.toThrow('API Error');
    });
  });

  describe('updateModel', () => {
    it('should update an existing model', async () => {
      // Arrange
      const model = new TestModel('model123', 'Updated Model');
      const mockResponse = {
        data: { id: 'model123', title: 'Updated Model' },
      };

      const putStub = sandbox.stub(axios, 'put').resolves(mockResponse);

      // Act
      const result = await ModelService.updateModel(model, '/api/models');

      // Assert
      expect(putStub.calledWith('/api/models/model123', model.toObject())).toBe(true);
      expect(result).toEqual(mockResponse.data);
    });

    it('should throw an error when API call fails', async () => {
      // Arrange
      const model = new TestModel('model123', 'Updated Model');

      sandbox.stub(axios, 'put').rejects(new Error('API Error'));

      // Act & Assert
      await expect(ModelService.updateModel(model, '/api/models'))
        .rejects.toThrow('API Error');
    });
  });

  describe('listModels', () => {
    it('should fetch a list of models', async () => {
      // Arrange
      const mockResponse = {
        data: [
          { id: 'model1', title: 'Model 1' },
          { id: 'model2', title: 'Model 2' },
        ],
      };

      sandbox.stub(axios, 'get').resolves(mockResponse);

      // Act
      const result = await ModelService.listModels('/api/models');

      // Assert
      sinon.assert.calledWith(axios.get as sinon.SinonStub, '/api/models');
      expect(result).toEqual(mockResponse.data);
      expect(result.length).toBe(2);
    });

    it('should throw an error when API call fails', async () => {
      // Arrange
      const mockError = new Error('API Error');

      sandbox.stub(axios, 'get').rejects(mockError);

      // Act & Assert
      await expect(ModelService.listModels('/api/models'))
        .rejects.toThrow('API Error');
    });
  });

  describe('deleteModel', () => {
    it('should delete a model', async () => {
      // Arrange
      const model = new TestModel('model123', 'Delete Me');
      const mockResponse = {
        data: { success: true },
      };
      const deleteStub = sandbox.stub(axios, 'delete').resolves(mockResponse);

      // Act
      const result = await ModelService.deleteModel(model, '/api/models');

      // Assert
      expect(deleteStub.calledWith('/api/models/model123')).toBe(true);
      expect(result).toEqual(mockResponse.data);
    });

    it('should throw an error when API call fails', async () => {
      // Arrange
      const model = new TestModel('model123', 'Delete Me');
      sandbox.stub(axios, 'delete').rejects(new Error('API Error'));

      // Act & Assert
      await expect(ModelService.deleteModel(model, '/api/models'))
        .rejects.toThrow('API Error');
    });
  });
});
