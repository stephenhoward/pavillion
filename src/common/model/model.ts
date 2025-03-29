// I would like to make this abstract, but you can't declare static abstract methods in typescript
class Model {
    toObject(): Record<string, any> { return {}; }
    static fromObject(object: Record<string,any>): Model { return new Model(); }
};

class PrimaryModel extends Model {
    id: string = '';

    constructor(id?: string) {
        super();
        this.id = id ?? '';
    };
};

interface TranslatedContentModel {
    language: string;
    isEmpty(): boolean;
}

abstract class TranslatedModel<T extends TranslatedContentModel> extends PrimaryModel {
    _content: Record<string, T> = {};

    protected abstract createContent(language: string): T;

    content(language: string): T {
        if ( ! this._content[language] ) {
            this._content[language] = this.createContent(language);
        }
        return this._content[language];
    }

    addContent(content: T) {
        this._content[content.language] = content;
    }

    dropContent(langauge: string) {
        delete this._content[langauge];
    }

    hasContent(language: string): boolean {
        return this._content[language] !== undefined
            && ! this._content[language].isEmpty();
    }

    getLanguages(): string[] {
        return Object.keys(this._content);
    }
};

export { Model, PrimaryModel, TranslatedContentModel, TranslatedModel };