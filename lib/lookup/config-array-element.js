"use strict";

//------------------------------------------------------------------------------
// Public Interface
//------------------------------------------------------------------------------

/**
 * The class for each element of config array.
 */
class ConfigArrayElement {
    constructor(

        // From config files.
        {
            env,
            globals,
            parser,
            parserOptions,
            plugins,
            processor,
            root,
            rules,
            settings
        },

        // Additional data
        {
            criteria = null,
            filePath = "",
            name = ""
        }
    ) {

        /**
         * The name of this config.
         * @type {string}
         */
        this.name = name;

        /**
         * The path to the file which defined this config.
         * @type {string}
         */
        this.filePath = filePath;

        /**
         * The predicate function to check if this config should apply to a given file.
         * This is made from `files` and `excludedFiles` properties.
         * @type {OverrideTester|undefined}
         */
        this.criteria = criteria;

        /**
         * Environments.
         * @type {Record<string, boolean>|undefined}
         */
        this.env = env;

        /**
         * Global variables.
         * @type {Record<string, boolean|"readonly"|"readable"|"writable"|"writeable"|"off">|undefined}
         */
        this.globals = globals;

        /**
         * Parser definition.
         * @type {LoadedEntity|undefined}
         */
        this.parser = parser;

        /**
         * Options for the parser.
         * @type {Object|undefined}
         */
        this.parserOptions = parserOptions;

        /**
         * Plugin definitions.
         * @type {Record<string, LoadedEntity>|undefined}
         */
        this.plugins = plugins;

        /**
         * Processor definition.
         * @type {string|undefined}
         */
        this.processor = processor;

        /**
         * The flag to ignore configs in the ancestor directories.
         * @type {boolean|undefined}
         */
        this.root = root;

        /**
         * Rule settings.
         * @type {Record<string, Array>|undefined}
         */
        this.rules = rules;

        /**
         * Shared settings.
         * @type {Object|undefined}
         */
        this.settings = settings;
    }
}

module.exports = { ConfigArrayElement };
