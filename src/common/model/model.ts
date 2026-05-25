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
   * @param {Record<string,any>} obj - Plain object to convert into a model
   * @returns {Model} A new model instance
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  static fromObject(obj: Record<string,any>): Model { return new Model(); }
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
   * Optional display name for this content. Translated content that carries
   * a human-readable label (Calendar, CalendarEvent, EventLocationSpace, …)
   * exposes `name` here so {@link TranslatedModel.displayName} can resolve
   * snapshot labels at emit time across the notifications and moderation
   * domains. Content models without a name (e.g. EventLocationContent,
   * which only translates accessibility info) omit it; displayName() then
   * resolves through to the fallback.
   */
  name?: string;

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

  /**
   * Resolves a single display name from the model's translated content
   * using a deterministic language-selection convention: the first language
   * present on the model wins; when no languages are present, the lookup
   * falls back to `'en'`. The resolved content's `name` is returned, or
   * the supplied `fallback` (default `''`) when the name is empty or
   * absent.
   *
   * This is the snapshot-on-write helper used by the notifications and
   * moderation domains to produce a stable, recipient-independent label
   * for an inbox row or notification email. Per-recipient localization
   * is intentionally not done here — the first available language wins
   * so the snapshot is deterministic.
   *
   * Whitespace-only names are treated as empty so a blank-but-non-empty
   * label can never reach an inbox snapshot row; the resolution falls
   * through to `fallback` in that case.
   *
   * @param {string} [fallback] - Value to return when no populated name is found
   * @returns {string} The resolved display name, or the fallback
   */
  displayName(fallback: string = ''): string {
    const languages = this.getLanguages();
    const language = languages.length > 0 ? languages[0] : 'en';
    return this.content(language).name?.trim() || fallback;
  }
};

export { Model, PrimaryModel, TranslatedContentModel, TranslatedModel };
