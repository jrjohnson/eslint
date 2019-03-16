"use strict";

/**
 * The class for loaded parsers or plugins.
 *
 * This class provides `toJSON` method for debuggable.
 */
class LoadedEntity {

    /**
     * Initialize this instance.
     * @param {Object} data The entity data.
     * @param {Object} [data.definition] The loaded object.
     * @param {Error} [data.error] The error object if the loading was failed.
     * @param {string} [data.filePath] The path to the actual loaded file.
     * @param {string} data.id The ID of this entity.
     * @param {string} data.importerPath The path to the config file which loaded this entity.
     */
    constructor({
        definition = null,
        error = null,
        filePath = null,
        id,
        importerPath
    }) {

        /**
         * The loaded object.
         * @type {Object|null}
         */
        this.definition = definition;

        /**
         * The error object if the loading was failed.
         * @type {Error|null}
         */
        this.error = error;

        /**
         * The path to the actual loaded file.
         * This is `null` if the file was not found.
         * @type {string|null}
         */
        this.filePath = filePath;

        /**
         * The ID of this entity.
         * @type {string}
         */
        this.id = id;

        /**
         * The path to the config file which loaded this entity.
         * @type {string}
         */
        this.importerPath = importerPath;
    }

    /**
     * @returns {Object} a JSON compatible object.
     */
    toJSON() {
        const obj = {
            id: this.id,
            importerPath: this.importerPath
        };

        if (this.filePath) {
            obj.filePath = this.filePath;
        }
        if (this.error) {
            obj.error = this.error.stack;
        }

        return obj;
    }

    [Symbol.for("nodejs.util.inspect.custom")]() {
        return this.toJSON();
    }
}

module.exports = { LoadedEntity };
