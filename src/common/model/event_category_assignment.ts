import { Model } from './model.js';

/**
 * Represents an assignment between an event and a category.
 * This model handles the many-to-many relationship between events and categories.
 */
export class EventCategoryAssignmentModel extends Model {
  constructor(
    public id: string,
    public eventId: string,
    public categoryId: string,
    public createdAt: Date = new Date(),
  ) {
    super();
  }

  /**
   * Validates that the assignment has required information.
   */
  isValid(): boolean {
    return (
      this.eventId.length > 0 &&
      this.categoryId.length > 0
    );
  }

  /**
   * Convert to plain object for serialization.
   */
  toObject(): Record<string, any> {
    return {
      id: this.id,
      eventId: this.eventId,
      categoryId: this.categoryId,
      createdAt: this.createdAt,
    };
  }

  /**
   * Create from plain object.
   */
  static fromObject(obj: Record<string, any>): EventCategoryAssignmentModel {
    return new EventCategoryAssignmentModel(
      obj.id,
      obj.eventId,
      obj.categoryId,
      obj.createdAt ? new Date(obj.createdAt) : new Date(),
    );
  }
}
