import { describe, it, expect, afterEach } from 'vitest';
import sinon from 'sinon';
import ListResult from '@/client/service/list-result';

describe('ListResult', () => {
  const sandbox = sinon.createSandbox();

  afterEach(() => {
    sandbox.restore();
  });

  describe('constructing from a flat array', () => {
    it('should store items from a flat array', () => {
      const items = [
        { id: '1', title: 'Item 1' },
        { id: '2', title: 'Item 2' },
      ];

      const result = ListResult.fromArray(items);

      expect(result.items).toEqual(items);
      expect(result.items.length).toBe(2);
    });

    it('should set pagination defaults for unpaginated response', () => {
      const items = [
        { id: '1', title: 'Item 1' },
        { id: '2', title: 'Item 2' },
        { id: '3', title: 'Item 3' },
      ];

      const result = ListResult.fromArray(items);

      expect(result.currentPage).toBe(1);
      expect(result.totalPages).toBe(1);
      expect(result.totalCount).toBe(3);
      expect(result.limit).toBe(3);
    });

    it('should indicate no next or previous page for unpaginated response', () => {
      const items = [{ id: '1', title: 'Item 1' }];

      const result = ListResult.fromArray(items);

      expect(result.hasNextPage).toBe(false);
      expect(result.hasPreviousPage).toBe(false);
    });

    it('should handle an empty array', () => {
      const result = ListResult.fromArray([]);

      expect(result.items).toEqual([]);
      expect(result.items.length).toBe(0);
      expect(result.currentPage).toBe(1);
      expect(result.totalPages).toBe(1);
      expect(result.totalCount).toBe(0);
      expect(result.limit).toBe(0);
      expect(result.hasNextPage).toBe(false);
      expect(result.hasPreviousPage).toBe(false);
    });
  });

  describe('constructing from a paginated response', () => {
    it('should store items and pagination metadata', () => {
      const items = [
        { id: '1', title: 'Item 1' },
        { id: '2', title: 'Item 2' },
      ];
      const pagination = {
        currentPage: 2,
        totalPages: 5,
        totalCount: 50,
        limit: 10,
      };

      const result = ListResult.fromPaginated(items, pagination);

      expect(result.items).toEqual(items);
      expect(result.currentPage).toBe(2);
      expect(result.totalPages).toBe(5);
      expect(result.totalCount).toBe(50);
      expect(result.limit).toBe(10);
    });

    it('should indicate hasNextPage when not on last page', () => {
      const pagination = {
        currentPage: 2,
        totalPages: 5,
        totalCount: 50,
        limit: 10,
      };

      const result = ListResult.fromPaginated([], pagination);

      expect(result.hasNextPage).toBe(true);
    });

    it('should indicate no next page when on last page', () => {
      const pagination = {
        currentPage: 5,
        totalPages: 5,
        totalCount: 50,
        limit: 10,
      };

      const result = ListResult.fromPaginated([], pagination);

      expect(result.hasNextPage).toBe(false);
    });

    it('should indicate hasPreviousPage when not on first page', () => {
      const pagination = {
        currentPage: 3,
        totalPages: 5,
        totalCount: 50,
        limit: 10,
      };

      const result = ListResult.fromPaginated([], pagination);

      expect(result.hasPreviousPage).toBe(true);
    });

    it('should indicate no previous page when on first page', () => {
      const pagination = {
        currentPage: 1,
        totalPages: 5,
        totalCount: 50,
        limit: 10,
      };

      const result = ListResult.fromPaginated([], pagination);

      expect(result.hasPreviousPage).toBe(false);
    });
  });

  describe('single page pagination', () => {
    it('should have no next or previous page', () => {
      const pagination = {
        currentPage: 1,
        totalPages: 1,
        totalCount: 5,
        limit: 20,
      };

      const result = ListResult.fromPaginated(
        [{ id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }, { id: '5' }],
        pagination,
      );

      expect(result.hasNextPage).toBe(false);
      expect(result.hasPreviousPage).toBe(false);
      expect(result.currentPage).toBe(1);
      expect(result.totalPages).toBe(1);
    });
  });

  describe('fetchNextPage', () => {
    it('should call the fetch function with the next page number', async () => {
      const nextPageResult = ListResult.fromArray([{ id: 'next' }]);
      const fetchFn = sandbox.stub().resolves(nextPageResult);

      const pagination = {
        currentPage: 2,
        totalPages: 5,
        totalCount: 50,
        limit: 10,
      };

      const result = ListResult.fromPaginated([], pagination, fetchFn);
      const nextPage = await result.fetchNextPage();

      expect(fetchFn.calledOnce).toBe(true);
      expect(fetchFn.calledWith(3)).toBe(true);
      expect(nextPage).toBe(nextPageResult);
    });

    it('should return null when there is no next page', async () => {
      const fetchFn = sandbox.stub();

      const pagination = {
        currentPage: 5,
        totalPages: 5,
        totalCount: 50,
        limit: 10,
      };

      const result = ListResult.fromPaginated([], pagination, fetchFn);
      const nextPage = await result.fetchNextPage();

      expect(fetchFn.called).toBe(false);
      expect(nextPage).toBeNull();
    });

    it('should return null for unpaginated results', async () => {
      const result = ListResult.fromArray([{ id: '1' }]);
      const nextPage = await result.fetchNextPage();

      expect(nextPage).toBeNull();
    });
  });

  describe('fetchPreviousPage', () => {
    it('should call the fetch function with the previous page number', async () => {
      const prevPageResult = ListResult.fromArray([{ id: 'prev' }]);
      const fetchFn = sandbox.stub().resolves(prevPageResult);

      const pagination = {
        currentPage: 3,
        totalPages: 5,
        totalCount: 50,
        limit: 10,
      };

      const result = ListResult.fromPaginated([], pagination, fetchFn);
      const prevPage = await result.fetchPreviousPage();

      expect(fetchFn.calledOnce).toBe(true);
      expect(fetchFn.calledWith(2)).toBe(true);
      expect(prevPage).toBe(prevPageResult);
    });

    it('should return null when there is no previous page', async () => {
      const fetchFn = sandbox.stub();

      const pagination = {
        currentPage: 1,
        totalPages: 5,
        totalCount: 50,
        limit: 10,
      };

      const result = ListResult.fromPaginated([], pagination, fetchFn);
      const prevPage = await result.fetchPreviousPage();

      expect(fetchFn.called).toBe(false);
      expect(prevPage).toBeNull();
    });

    it('should return null for unpaginated results', async () => {
      const result = ListResult.fromArray([{ id: '1' }]);
      const prevPage = await result.fetchPreviousPage();

      expect(prevPage).toBeNull();
    });
  });

  describe('items accessor', () => {
    it('should return the correct array of items', () => {
      const items = [
        { id: '1', name: 'First' },
        { id: '2', name: 'Second' },
        { id: '3', name: 'Third' },
      ];

      const result = ListResult.fromArray(items);

      expect(result.items).toEqual(items);
      expect(result.items[0]).toEqual({ id: '1', name: 'First' });
      expect(result.items[2]).toEqual({ id: '3', name: 'Third' });
    });
  });

  describe('edge cases', () => {
    it('should handle paginated response on page 1 of 1 with empty items', () => {
      const pagination = {
        currentPage: 1,
        totalPages: 1,
        totalCount: 0,
        limit: 20,
      };

      const result = ListResult.fromPaginated([], pagination);

      expect(result.items).toEqual([]);
      expect(result.hasNextPage).toBe(false);
      expect(result.hasPreviousPage).toBe(false);
      expect(result.totalCount).toBe(0);
    });

    it('should handle last page with fewer items than limit', () => {
      const items = [
        { id: '41' },
        { id: '42' },
        { id: '43' },
        { id: '44' },
        { id: '45' },
      ];
      const pagination = {
        currentPage: 3,
        totalPages: 3,
        totalCount: 45,
        limit: 20,
      };

      const result = ListResult.fromPaginated(items, pagination);

      expect(result.items.length).toBe(5);
      expect(result.totalCount).toBe(45);
      expect(result.hasNextPage).toBe(false);
      expect(result.hasPreviousPage).toBe(true);
    });

    it('should handle fetchNextPage without a fetch function provided', async () => {
      const pagination = {
        currentPage: 1,
        totalPages: 3,
        totalCount: 30,
        limit: 10,
      };

      const result = ListResult.fromPaginated([], pagination);
      const nextPage = await result.fetchNextPage();

      expect(nextPage).toBeNull();
    });

    it('should handle fetchPreviousPage without a fetch function provided', async () => {
      const pagination = {
        currentPage: 2,
        totalPages: 3,
        totalCount: 30,
        limit: 10,
      };

      const result = ListResult.fromPaginated([], pagination);
      const prevPage = await result.fetchPreviousPage();

      expect(prevPage).toBeNull();
    });
  });
});
