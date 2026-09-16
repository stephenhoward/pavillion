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

  /**
   * Whether this row carries something that speaks for its language — the
   * fields a consumer reads off a row it *selected* by language.
   *
   * This is deliberately not `isEmpty()` inverted. `isEmpty()` answers a
   * different question: does this row hold anything at all. That is the right
   * question for a save path deciding whether a row is worth persisting, and
   * the wrong one for a consumer choosing which language's row to render,
   * because every content field added to a model widens `isEmpty()` and so
   * silently widens any gate computed from it. `imageAlt` is the field that
   * made that concrete: it describes an image rather than translating the
   * page, the render boundary resolves it per field (`localizedField`) and
   * never reads it off a selected row, so a row carrying only alt text would
   * be selected as a locale's content and serve a blank name and description
   * where the visitor previously fell back to English.
   *
   * The same reasoning produced `mappedContentLanguages` at the ActivityPub
   * boundary (see DEC-014); this is its render-boundary twin. Implementations
   * enumerate the fields a row consumer renders rather than delegating to
   * `isEmpty()`, so adding a content field is a decision taken here instead of
   * an automatic widening: a field resolved per field at the render boundary
   * must not be listed, a field read off the selected row must.
   *
   * @returns {boolean} True when a field a row consumer renders is populated
   */
  hasDisplayContent(): boolean;
}

/**
 * Base class for models that support content in multiple languages.
 *
 * @template T - The type of translated content this model contains
 */
abstract class TranslatedModel<T extends TranslatedContentModel> extends PrimaryModel {
  /**
   * Content rows keyed by language code.
   *
   * The map has a **null prototype** and every read below tests for an *own*
   * property. Language codes reach this map from request bodies —
   * `express.json()` parses with `JSON.parse`, which makes `__proto__` an own
   * enumerable key that survives `Object.entries`, so a caller iterating a
   * client-supplied content map can hand any string in here. On a plain object
   * `_content['__proto__']` resolves through the prototype chain to
   * `Object.prototype`, which a truthiness guard reads as "already present":
   * the row is handed to the caller and whatever the caller writes onto it
   * lands on `Object.prototype` process-wide. A null prototype makes those
   * keys ordinary data — `__proto__` assigns an own property rather than
   * re-parenting the map — and the own-property tests keep the lookups honest
   * for a map that some other code path replaced with a plain object.
   *
   * Subclasses must not redeclare this field: a class-field initializer in a
   * subclass runs after `super()` and would replace this map with a plain
   * object. The type is already narrowed by the `T` they pass in.
   */
  _content: Record<string, T> = Object.create(null);

  /**
   * Reads the stored content row for a language without creating one, by own
   * property only, so inherited keys (`__proto__`, `constructor`, `toString`,
   * …) resolve to `undefined` rather than to something off the prototype
   * chain.
   *
   * @param {string} language - The language code
   * @returns {T | undefined} The stored content row, or undefined if there is none
   * @private
   */
  private ownContent(language: string): T | undefined {
    return Object.hasOwn(this._content, language) ? this._content[language] : undefined;
  }

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
    if ( ! this.ownContent(language) ) {
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
   * Determines if the model has content for the specified language that
   * speaks for that language — a stored row carrying something a consumer
   * reading the whole row will render.
   *
   * This is the row-selection predicate: every consumer that picks one
   * language's row for display goes through it (`localizedContent` in the site
   * and widget, `resolveContentLocale` behind the meta tags), which is why it
   * asks {@link TranslatedContentModel.hasDisplayContent} rather than negating
   * `isEmpty()`. A caller that wants the different question "is a row stored
   * for this language at all" — a save path, or a test proving absence —
   * asks `getLanguages().includes(language)`.
   *
   * @param {string} language - The language code to check
   * @returns {boolean} True if a row exists and carries renderable content
   */
  hasContent(language: string): boolean {
    const content = this.ownContent(language);
    return content !== undefined && content.hasDisplayContent();
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
