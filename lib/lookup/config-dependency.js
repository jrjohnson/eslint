/**
 * @fileoverview `ConfigDependency` class.
 * @author Toru Nagashima <https://github.com/mysticatea>
 */
"use strict";

/**
 * The class is to store parsers or plugins.
 * This class hides the loaded object from `JSON.stringify()` and `console.log`.
 */
class ConfigDependency {

    /**
     * Initialize this instance.
     * @param {Object} data The dependency data.
     * @param {Object} [data.definition] The dependency if the loading succeeded.
     * @param {Error} [data.error] The error object if the loading failed.
     * @param {string} [data.filePath] The actual path to the dependency if the loading succeeded.
     * @param {string} data.id The ID of this dependency.
     * @param {string} data.importerName The name of the config file which loads this dependency.
     * @param {string} data.importerPath The path to the config file which loads this dependency.
     */
    constructor({
        definition = null,
        error = null,
        filePath = null,
        id,
        importerName,
        importerPath
    }) {

        /**
         * The loaded dependency if the loading succeeded.
         * @type {Object|null}
         */
        this.definition = definition;

        /**
         * The error object if the loading failed.
         * @type {Error|null}
         */
        this.error = error;

        /**
         * The loaded dependency if the loading succeeded.
         * @type {string|null}
         */
        this.filePath = filePath;

        /**
         * The ID of this dependency.
         * @type {string}
         */
        this.id = id;

        /**
         * The name of the config file which loads this dependency.
         * @type {string}
         */
        this.importerName = importerName;

        /**
         * The path to the config file which loads this dependency.
         * @type {string}
         */
        this.importerPath = importerPath;
    }

    /**
     * @returns {Object} a JSON compatible object.
     */
    toJSON() {
        const {
            definition: _ignore, // eslint-disable-line no-unused-vars
            ...obj
        } = this;

        return obj;
    }

    [Symbol.for("nodejs.util.inspect.custom")]() {
        return this.toJSON();
    }
}

module.exports = { ConfigDependency };
