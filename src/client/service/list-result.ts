/**
 * Pagination metadata from paginated API responses.
 */
interface PaginationInfo {
  currentPage: number;
  totalPages: number;
  totalCount: number;
  limit: number;
}

/**
 * A function that fetches a specific page and returns a new ListResult.
 */
type PageFetchFn = (page: number) => Promise<ListResult>;

/**
 * Wraps API list responses, providing a clean interface for both
 * flat arrays and paginated responses with navigation methods.
 */
export default class ListResult {

  private readonly _items: Record<string, any>[];
  private readonly _pagination: PaginationInfo;
  private readonly _fetchFn: PageFetchFn | null;

  /**
   * @param items - The array of items for this page
   * @param pagination - Pagination metadata
   * @param fetchFn - Optional function to fetch other pages
   */
  constructor(
    items: Record<string, any>[],
    pagination: PaginationInfo,
    fetchFn: PageFetchFn | null = null,
  ) {
    this._items = items;
    this._pagination = pagination;
    this._fetchFn = fetchFn;
  }

  /**
   * Creates a ListResult from a flat array (no pagination).
   * Pagination defaults to page 1 of 1 with totalCount equal to array length.
   *
   * @param items - The array of items
   * @returns A new ListResult wrapping the array
   */
  static fromArray(items: Record<string, any>[]): ListResult {
    return new ListResult(items, {
      currentPage: 1,
      totalPages: 1,
      totalCount: items.length,
      limit: items.length,
    });
  }

  /**
   * Creates a ListResult from a paginated API response.
   *
   * @param items - The array of items for this page
   * @param pagination - Pagination metadata from the server
   * @param fetchFn - Optional function to fetch a specific page by number
   * @returns A new ListResult with pagination support
   */
  static fromPaginated(
    items: Record<string, any>[],
    pagination: PaginationInfo,
    fetchFn?: PageFetchFn,
  ): ListResult {
    return new ListResult(items, pagination, fetchFn || null);
  }

  /** The array of items for the current page. */
  get items(): Record<string, any>[] {
    return this._items;
  }

  /** The current page number (1-based). */
  get currentPage(): number {
    return this._pagination.currentPage;
  }

  /** The total number of pages. */
  get totalPages(): number {
    return this._pagination.totalPages;
  }

  /** The total number of items across all pages. */
  get totalCount(): number {
    return this._pagination.totalCount;
  }

  /** The maximum number of items per page. */
  get limit(): number {
    return this._pagination.limit;
  }

  /** Whether there is a next page available. */
  get hasNextPage(): boolean {
    return this._pagination.currentPage < this._pagination.totalPages;
  }

  /** Whether there is a previous page available. */
  get hasPreviousPage(): boolean {
    return this._pagination.currentPage > 1;
  }

  /**
   * Fetches the next page of results.
   *
   * @returns A promise resolving to a new ListResult for the next page,
   *   or null if there is no next page or no fetch function was provided
   */
  async fetchNextPage(): Promise<ListResult | null> {
    if (!this.hasNextPage || !this._fetchFn) {
      return null;
    }
    return this._fetchFn(this._pagination.currentPage + 1);
  }

  /**
   * Fetches the previous page of results.
   *
   * @returns A promise resolving to a new ListResult for the previous page,
   *   or null if there is no previous page or no fetch function was provided
   */
  async fetchPreviousPage(): Promise<ListResult | null> {
    if (!this.hasPreviousPage || !this._fetchFn) {
      return null;
    }
    return this._fetchFn(this._pagination.currentPage - 1);
  }
}
