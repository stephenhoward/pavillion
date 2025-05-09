/**
 * Base model class for all application models.
 * Defines serialization and deserialization methods.
 */
// I would like to make this abstract, but you can't declare static abstract methods in typescript
class Model {
  /**
   * Converts the model instance to a plain JavaScript object.
   *
   * @returns {Record<string, any>} A plain object representation of the model
   */
  toObject(): Record<string, any> { return {}; }

  /**
   * Creates a model instance from a plain JavaScript object.
   *
   * @param {Record<string,any>} object - Plain object to convert into a model
   * @returns {Model} A new model instance
   */
  static fromObject(object: Record<string,any>): Model { return new Model(); }
};

/**
 * Base model class for entities with a primary identifier.
 */
class PrimaryModel extends Model {
  id: string = '';

  /**
   * Constructor for PrimaryModel.
   *
   * @param {string} [id] - Optional identifier for the model
   */
  constructor(id?: string) {
    super();
    this.id = id ?? '';
  };
};

/**
 * Interface for translated content within models.
 * Defines methods and properties that all translated content must implement.
 */
interface TranslatedContentModel {
  /**
   * The language code for this content
   */
  language: string;

  /**
   * Determines if the content is empty.
   *
   * @returns {boolean} True if the content is empty
   */
  isEmpty(): boolean;
}

/**
 * Base class for models that support content in multiple languages.
 *
 * @template T - The type of translated content this model contains
 */
abstract class TranslatedModel<T extends TranslatedContentModel> extends PrimaryModel {
  _content: Record<string, T> = {};

  /**
   * Creates a new content instance for the specified language.
   * Must be implemented by subclasses.
   *
   * @param {string} language - The language code to create content for
   * @returns {T} A new translated content instance
   * @protected
   */
  protected abstract createContent(language: string): T;

  /**
   * Gets the content for the specified language.
   * Creates a new content instance if none exists.
   *
   * @param {string} language - The language code
   * @returns {T} The translated content for the specified language
   */
  content(language: string): T {
    if ( ! this._content[language] ) {
      this._content[language] = this.createContent(language);
    }
    return this._content[language];
  }

  /**
   * Adds new translated content to the model.
   *
   * @param {T} content - The translated content to add
   */
  addContent(content: T) {
    this._content[content.language] = content;
  }

  /**
   * Removes content for the specified language.
   *
   * @param {string} langauge - The language code to remove
   */
  dropContent(langauge: string) {
    delete this._content[langauge];
  }

  /**
   * Determines if the model has non-empty content for the specified language.
   *
   * @param {string} language - The language code to check
   * @returns {boolean} True if content exists and is not empty
   */
  hasContent(language: string): boolean {
    return this._content[language] !== undefined
            && ! this._content[language].isEmpty();
  }

  /**
   * Gets a list of all languages that have content in this model.
   *
   * @returns {string[]} Array of language codes
   */
  getLanguages(): string[] {
    return Object.keys(this._content);
  }
};

export { Model, PrimaryModel, TranslatedContentModel, TranslatedModel };
