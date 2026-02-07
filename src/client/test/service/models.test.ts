import { describe, it, expect, afterEach } from 'vitest';
import sinon from 'sinon';
import ModelService from '@/client/service/models';
import ListResult from '@/client/service/list-result';
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
    it('should return a ListResult wrapping a flat array', async () => {
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
      expect(result).toBeInstanceOf(ListResult);
      expect(result.items).toEqual(mockResponse.data);
      expect(result.items.length).toBe(2);
      expect(result.currentPage).toBe(1);
      expect(result.totalPages).toBe(1);
    });

    it('should return a paginated ListResult when dataKey is provided', async () => {
      // Arrange
      const mockResponse = {
        data: {
          events: [
            { id: 'event1', title: 'Event 1' },
            { id: 'event2', title: 'Event 2' },
          ],
          pagination: {
            currentPage: 1,
            totalPages: 3,
            totalCount: 25,
            limit: 10,
          },
        },
      };

      sandbox.stub(axios, 'get').resolves(mockResponse);

      // Act
      const result = await ModelService.listModels('/api/events', { dataKey: 'events' });

      // Assert
      expect(result).toBeInstanceOf(ListResult);
      expect(result.items).toEqual(mockResponse.data.events);
      expect(result.items.length).toBe(2);
      expect(result.currentPage).toBe(1);
      expect(result.totalPages).toBe(3);
      expect(result.totalCount).toBe(25);
      expect(result.hasNextPage).toBe(true);
    });

    it('should default to empty array when dataKey is missing from response', async () => {
      // Arrange
      const mockResponse = {
        data: {
          pagination: {
            currentPage: 1,
            totalPages: 1,
            totalCount: 0,
            limit: 10,
          },
        },
      };

      sandbox.stub(axios, 'get').resolves(mockResponse);

      // Act
      const result = await ModelService.listModels('/api/events', { dataKey: 'events' });

      // Assert
      expect(result.items).toEqual([]);
      expect(result.totalCount).toBe(0);
    });

    it('should wire fetchFn so that next page calls listModels with updated page param', async () => {
      // Arrange
      const page1Response = {
        data: {
          items: [{ id: '1' }],
          pagination: {
            currentPage: 1,
            totalPages: 2,
            totalCount: 15,
            limit: 10,
          },
        },
      };
      const page2Response = {
        data: {
          items: [{ id: '11' }],
          pagination: {
            currentPage: 2,
            totalPages: 2,
            totalCount: 15,
            limit: 10,
          },
        },
      };

      const getStub = sandbox.stub(axios, 'get');
      getStub.onFirstCall().resolves(page1Response);
      getStub.onSecondCall().resolves(page2Response);

      // Act
      const result = await ModelService.listModels('/api/things', { dataKey: 'items' });
      const nextPage = await result.fetchNextPage();

      // Assert
      expect(getStub.calledTwice).toBe(true);
      // The second call should have page=2 in the URL
      const secondCallUrl = getStub.secondCall.args[0];
      expect(secondCallUrl).toContain('page=2');

      expect(nextPage).toBeInstanceOf(ListResult);
      expect(nextPage!.items).toEqual([{ id: '11' }]);
      expect(nextPage!.currentPage).toBe(2);
      expect(nextPage!.hasNextPage).toBe(false);
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
