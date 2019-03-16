/**
 * @fileoverview The factory of `ConfigArray` objects.
 *
 * This class provides methods to create `ConfigArray` instance.
 *
 * - `ConfigArrayFactory#create()`
 *     Create an instance from a config data. This is to handle CLIOptions.
 * - `ConfigArrayFactory#loadFile()`
 *     Create an instance from a config file. This is to handle `--config`
 *     option.
 * - `ConfigArrayFactory#loadOnDirectory()`
 *     Create an instance from a config file which is on a given directory. This
 *     tries to load `.eslintrc.*` or `package.json`. If not found, returns
 *     `null`.
 *
 * `ConfigArrayFactory` class has the responsibility that loads configuration
 * files, including loading `extends`, `parser`, and `plugins`. The created
 * `ConfigArray` instance has the loaded `extends`, `parser`, and `plugins`.
 *
 * But this class doesn't handle cascading. `FileEnumerator` class handles
 * cascading and hierarchy.
 */
"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const fs = require("fs");
const path = require("path");
const importFresh = require("import-fresh");
const stripComments = require("strip-json-comments");
const { validateConfigSchema } = require("../config/config-validator");
const { ConfigArrayElement } = require("./config-array-element");
const { ConfigArray } = require("./config-array");
const { LoadedEntity } = require("./loaded-entity");
const { ModuleResolver } = require("./module-resolver");
const { OverrideTester } = require("./override-tester");
const naming = require("./naming");
const debug = require("debug")("eslint:config-array-factory");

// debug.enabled = true;

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

const eslintRecommendedPath = path.resolve(__dirname, "../../conf/eslint-recommended.js");
const eslintAllPath = path.resolve(__dirname, "../../conf/eslint-all.js");
const configFilenames = [
    ".eslintrc.js",
    ".eslintrc.yaml",
    ".eslintrc.yml",
    ".eslintrc.json",
    ".eslintrc",
    "package.json"
];

/**
 * @typedef {Object} ConfigData
 * @property {Object} [env] The environment settings.
 * @property {string} [extends] The path to other config files or the package name of shareable configs.
 * @property {Object} [globals] The global variable settings.
 * @property {ConfigOverrideData[]} [overrides] The override settings per kind of files.
 * @property {string} [parser] The path to a parser or the package name of a parser.
 * @property {Object} [parserOptions] The parser options.
 * @property {string[]} [plugins] The plugin specifiers.
 * @property {boolean} [root] The root flag.
 * @property {Object} [rules] The rule settings.
 * @property {Object} [settings] The shared settings.
 */

/**
 * @typedef {Object} ConfigOverrideData
 * @property {Object} [env] The environment settings.
 * @property {string|string[]} [excludedFiles] The glob pattarns for excluded files.
 * @property {string|string[]} files The glob pattarns for target files.
 * @property {Object} [globals] The global variable settings.
 * @property {string} [parser] The path to a parser or the package name of a parser.
 * @property {Object} [parserOptions] The parser options.
 * @property {string[]} [plugins] The plugin specifiers.
 * @property {Object} [rules] The rule settings.
 * @property {Object} [settings] The shared settings.
 */

/**
 * Check if a given string is a file path.
 * @param {string} nameOrPath A module name or file path.
 * @returns {boolean} `true` if the `nameOrPath` is a file path.
 */
function isFilePath(nameOrPath) {
    return (
        /^\.{1,2}[/\\]/u.test(nameOrPath) ||
        path.isAbsolute(nameOrPath)
    );
}

/**
 * Normalize a given path.
 * @param {string} filePathOrName A path to a file to normalize.
 * @param {string} cwd The path to the current working directory.
 * @returns {string} Normalized path.
 * @private
 */
function normalizePath(filePathOrName, cwd) {
    const packageNameToTry =
        naming.normalizePackageName(filePathOrName, "eslint-config");

    try {
        return ModuleResolver.resolve(packageNameToTry, cwd);
    } catch (error) {
        if (!error || error.code !== "MODULE_NOT_FOUND") {
            throw error;
        }
    }

    return path.resolve(cwd, filePathOrName);
}

/**
 * Convenience wrapper for synchronously reading file contents.
 * @param {string} filePath The filename to read.
 * @returns {string} The file contents, with the BOM removed.
 * @private
 */
function readFile(filePath) {
    return fs.readFileSync(filePath, "utf8").replace(/^\ufeff/u, "");
}

/**
 * Loads a YAML configuration from a file.
 * @param {string} filePath The filename to load.
 * @returns {ConfigData} The configuration object from the file.
 * @throws {Error} If the file cannot be read.
 * @private
 */
function loadYAMLConfigFile(filePath) {
    debug(`Loading YAML config file: ${filePath}`);

    // lazy load YAML to improve performance when not used
    const yaml = require("js-yaml");

    try {

        // empty YAML file can be null, so always use
        return yaml.safeLoad(readFile(filePath)) || {};
    } catch (e) {
        debug(`Error reading YAML file: ${filePath}`);
        e.message = `Cannot read config file: ${filePath}\nError: ${e.message}`;
        throw e;
    }
}

/**
 * Loads a JSON configuration from a file.
 * @param {string} filePath The filename to load.
 * @returns {ConfigData} The configuration object from the file.
 * @throws {Error} If the file cannot be read.
 * @private
 */
function loadJSONConfigFile(filePath) {
    debug(`Loading JSON config file: ${filePath}`);

    try {
        return JSON.parse(stripComments(readFile(filePath)));
    } catch (e) {
        debug(`Error reading JSON file: ${filePath}`);
        e.message = `Cannot read config file: ${filePath}\nError: ${e.message}`;
        e.messageTemplate = "failed-to-read-json";
        e.messageData = {
            path: filePath,
            message: e.message
        };
        throw e;
    }
}

/**
 * Loads a legacy (.eslintrc) configuration from a file.
 * @param {string} filePath The filename to load.
 * @returns {ConfigData} The configuration object from the file.
 * @throws {Error} If the file cannot be read.
 * @private
 */
function loadLegacyConfigFile(filePath) {
    debug(`Loading legacy config file: ${filePath}`);

    // lazy load YAML to improve performance when not used
    const yaml = require("js-yaml");

    try {
        return yaml.safeLoad(stripComments(readFile(filePath))) || /* istanbul ignore next */ {};
    } catch (e) {
        debug("Error reading YAML file: %s\n%o", filePath, e);
        e.message = `Cannot read config file: ${filePath}\nError: ${e.message}`;
        throw e;
    }
}

/**
 * Loads a JavaScript configuration from a file.
 * @param {string} filePath The filename to load.
 * @returns {ConfigData} The configuration object from the file.
 * @throws {Error} If the file cannot be read.
 * @private
 */
function loadJSConfigFile(filePath) {
    debug(`Loading JS config file: ${filePath}`);
    try {
        return importFresh(filePath);
    } catch (e) {
        debug(`Error reading JavaScript file: ${filePath}`);
        e.message = `Cannot read config file: ${filePath}\nError: ${e.message}`;
        throw e;
    }
}

/**
 * Loads a configuration from a package.json file.
 * @param {string} filePath The filename to load.
 * @returns {ConfigData} The configuration object from the file.
 * @throws {Error} If the file cannot be read.
 * @private
 */
function loadPackageJSONConfigFile(filePath) {
    debug(`Loading package.json config file: ${filePath}`);
    try {
        return loadJSONConfigFile(filePath).eslintConfig || null;
    } catch (e) {
        debug(`Error reading package.json file: ${filePath}`);
        e.message = `Cannot read config file: ${filePath}\nError: ${e.message}`;
        throw e;
    }
}

/**
 * Creates an error to notify about a missing config to extend from.
 * @param {string} configName The name of the missing config.
 * @returns {Error} The error object to throw
 * @private
 */
function configMissingError(configName) {
    const error = new Error(`Failed to load config "${configName}" to extend from.`);

    error.messageTemplate = "extend-config-missing";
    error.messageData = {
        configName
    };
    return error;
}

/**
 * Loads a configuration file regardless of the source. Inspects the file path
 * to determine the correctly way to load the config file.
 * @param {string} filePath The path to the configuration.
 * @returns {ConfigData|null} The configuration information.
 * @private
 */
function loadConfigFile(filePath) {
    let config;

    switch (path.extname(filePath)) {
        case ".js":
            config = loadJSConfigFile(filePath);
            break;

        case ".json":
            if (path.basename(filePath) === "package.json") {
                config = loadPackageJSONConfigFile(filePath);
            } else {
                config = loadJSONConfigFile(filePath);
            }
            break;

        case ".yaml":
        case ".yml":
            config = loadYAMLConfigFile(filePath);
            break;

        default:
            config = loadLegacyConfigFile(filePath);
    }

    if (config) {
        validateConfigSchema(config, filePath);
    }

    return config;
}

/**
 * Concatenate two config data.
 * @param {IterableIterator<ConfigArrayElement>|null} elements The config elements.
 * @param {ConfigArray|null} parentConfigArray The parent config array.
 * @returns {ConfigArray} The concatenated config array.
 */
function createConfigArray(elements, parentConfigArray) {
    if (!elements) {
        return parentConfigArray || new ConfigArray();
    }
    const configArray = new ConfigArray(...elements);

    if (parentConfigArray && !configArray.isRoot()) {
        configArray.unshift(...parentConfigArray);
    }
    return configArray;
}

//------------------------------------------------------------------------------
// Public Interface
//------------------------------------------------------------------------------

/**
 * The factory of `ConfigArray` objects.
 *
 * This class provides methods to create `ConfigArray` instance.
 *
 * - `ConfigArrayFactory#create()`
 *     Create an instance from a config data. This is to handle CLIOptions.
 * - `ConfigArrayFactory#loadFile()`
 *     Create an instance from a config file. This is to handle `--config`
 *     option.
 * - `ConfigArrayFactory#loadOnDirectory()`
 *     Create an instance from a config file which is on a given directory. This
 *     tries to load `.eslintrc.*` or `package.json`. If not found, returns
 *     `null`.
 *
 * `ConfigArrayFactory` class has the responsibility that loads configuration
 * files, including loading `extends`, `parser`, and `plugins`. The created
 * `ConfigArray` instance has the loaded `extends`, `parser`, and `plugins`.
 *
 * But this class doesn't handle cascading. `FileEnumerator` class handles
 * cascading and hierarchy.
 */
class ConfigArrayFactory {

    /**
     * Initialize this instance.
     * @param {Object} [options] The map for additional plugins.
     * @param {Map<string,Parser>} [options.additionalParserPool] The map for additional parsers.
     * @param {Map<string,Plugin>} [options.additionalPluginPool] The map for additional plugins.
     * @param {string} [options.cwd] The path to the current working directory.
     */
    constructor({
        additionalParserPool = new Map(),
        additionalPluginPool = new Map(),
        cwd = process.cwd()
    } = {}) {

        /**
         * The map for additional parsers.
         * @type {Map<string,Parser>}
         * @private
         */
        this._additionalParserPool = additionalParserPool;

        /**
         * The map for additional plugins.
         * @type {Map<string,Plugin>}
         * @private
         */
        this._additionalPluginPool = additionalPluginPool;

        /**
         * The path to the current working directory.
         * @type {string}
         * @private
         */
        this._cwd = cwd;
    }

    /**
     * Create `ConfigArray` instance from a config data.
     * @param {ConfigData|null} configData The path to a directory.
     * @param {Object} [options] The options.
     * @param {string} [options.filePath] The path to this config data.
     * @param {string} [options.name] The config name.
     * @param {ConfigArray} [options.parent] The parent config array.
     * @returns {ConfigArray} Loaded config.
     */
    create(configData, { filePath, name, parent } = {}) {
        return createConfigArray(
            configData
                ? this._normalizeConfigData(configData, { filePath, name })
                : null,
            parent
        );
    }

    /**
     * Load a config file.
     * @param {string} filePath The path to a config file. This can be a name of shareable configs for backward compatibility.
     * @param {Object} [options] The options.
     * @param {string} [options.name] The config name.
     * @param {ConfigArray} [options.parent] The parent config array.
     * @returns {ConfigArray|null} Loaded config.
     */
    loadFile(filePath, { name, parent } = {}) {
        return createConfigArray(
            this._loadConfigData(normalizePath(filePath, this._cwd), { name }),
            parent
        );
    }

    /**
     * Load the config file on a given directory if exists.
     * @param {string} directoryPath The path to a directory.
     * @param {Object} [options] The options.
     * @param {string} [options.name] The config name.
     * @param {ConfigArray} [options.parent] The parent config array.
     * @returns {ConfigArray|null} Loaded config. `null` if any config doesn't exist.
     */
    loadOnDirectory(directoryPath, { name, parent } = {}) {
        return createConfigArray(
            this._loadConfigDataOnDirectory(directoryPath, { name }),
            parent
        );
    }

    /**
     * Load a given config file.
     * @param {string} filePath The path to a config file.
     * @param {Object} [options] The options.
     * @param {string} [options.name] The config name.
     * @returns {IterableIterator<ConfigArrayElement>} Loaded config.
     * @private
     */
    _loadConfigData(filePath, { name } = {}) {
        const configData = loadConfigFile(filePath);

        if (!configData) {
            throw configMissingError(name || filePath);
        }

        return this._normalizeConfigData(configData, { filePath, name });
    }

    /**
     * Load the config file on a given directory if exists.
     * @param {string} directoryPath The path to a directory.
     * @param {Object} [options] The options.
     * @param {string} [options.name] The config name.
     * @returns {IterableIterator<ConfigArrayElement> | null} Loaded config. `null` if any config doesn't exist.
     * @private
     */
    _loadConfigDataOnDirectory(directoryPath, { name } = {}) {
        for (const filename of configFilenames) {
            const filePath = path.join(directoryPath, filename);

            try {
                const originalEnabled = debug.enabled;
                let configData;

                // Make silent temporary because of too verbose.
                debug.enabled = false;
                try {
                    configData = loadConfigFile(filePath);
                } finally {
                    debug.enabled = originalEnabled;
                }

                if (configData) {
                    debug(`Config file found: ${filePath}`);
                    return this._normalizeConfigData(
                        configData,
                        { filePath, name }
                    );
                }
            } catch (error) {
                if (error.code !== "ENOENT" && error.code !== "MODULE_NOT_FOUND") {
                    throw error;
                }
            }
        }

        debug(`Config file not found on ${directoryPath}`);
        return null;
    }

    /**
     * Normalize a given config to an array.
     * @param {ConfigData|ConfigData[]} configData The config data to normalize.
     * @param {Object} [options] The file path.
     * @param {string} [options.filePath] The file path of this config.
     * @param {string} [options.name] The name of this config.
     * @returns {IterableIterator<ConfigArrayElement>} The normalized config.
     * @private
     */
    _normalizeConfigData(configData, options) {

        // TODO: support arrays in the future.

        return this._normalizeObjectConfigData(configData, options);
    }

    /**
     * Normalize a given config to an array.
     * @param {ConfigData} configData The config data to normalize.
     * @param {Object} [options] The file path.
     * @param {string} [options.filePath] The file path of this config.
     * @param {string} [options.name] The name of this config.
     * @returns {IterableIterator<ConfigArrayElement>} The normalized config.
     * @private
     */
    *_normalizeObjectConfigData(
        configData,
        {
            filePath = path.join(this._cwd, ".eslintrc"),
            name = filePath && path.relative(this._cwd, filePath)
        } = {}
    ) {
        const { files, excludedFiles, ...configBody } = configData;
        const basePath = path.dirname(filePath);
        const criteria = OverrideTester.create(files, excludedFiles, basePath);
        const elements =
            this._normalizeObjectConfigDataBody(configBody, filePath, name);

        // Apply the criteria to every element.
        for (const element of elements) {
            element.criteria = OverrideTester.and(criteria, element.criteria);

            // Adopt the base path of the entry file (the outermost base path).
            if (element.criteria) {
                element.criteria.basePath = basePath;
                element.root = void 0; // overrides cannot have `root`.
            }

            yield element;
        }
    }

    /**
     * Normalize a given config to an array.
     * @param {ConfigData} configData The config data to normalize.
     * @param {string} filePath The file path of this config.
     * @param {string} name The name of this config.
     * @returns {IterableIterator<ConfigArrayElement>} The normalized config.
     * @private
     */
    *_normalizeObjectConfigDataBody(configData, filePath, name) {
        const {
            extends: extend,
            overrides: overrideList = [],
            parser,
            plugins: pluginList,
            ...configBody
        } = configData;
        const extendList = Array.isArray(extend)
            ? extend
            : [extend].filter(Boolean);

        // Flatten `extends`.
        for (const extendName of extendList) {
            yield* this._loadExtends(extendName, { filePath, name });
        }

        // Load parser & plugins.
        if (parser) {
            configBody.parser = this._loadParser(parser, filePath);
        }
        if (pluginList) {
            configBody.plugins = this._loadPlugins(pluginList, filePath);
            yield* this._takeFileExtensionProcessors(
                configBody.plugins,
                { name, filePath }
            );
        }

        // Yield the body except `extends` and `overrides`.
        yield new ConfigArrayElement(configBody, { name, filePath });

        // Flatten `overries`.
        for (let i = 0; i < overrideList.length; ++i) {
            yield* this._normalizeConfigData(
                overrideList[i],
                { filePath, name: `${name}#overrides[${i}]` }
            );
        }
    }

    /**
     * Load configs of an element in `extends`.
     * @param {string} extendName The name of a base config.
     * @param {Object} [options] The file path.
     * @param {string} [options.filePath] The file path which has the `extends` property.
     * @param {string} [options.name] The name of the config which has the `extends` property.
     * @returns {IterableIterator<ConfigArrayElement>} The normalized config.
     * @private
     */
    *_loadExtends(extendName, { filePath, name: parentName }) {
        debug("Loading {extends:%j} relative to %s", extendName, filePath);
        try {

            // Debug name.
            const name = `${parentName} » ${extendName}`;

            // Core config
            if (extendName.startsWith("eslint:")) {
                if (extendName === "eslint:recommended") {
                    yield* this._loadConfigData(eslintRecommendedPath, { name });
                } else if (extendName === "eslint:all") {
                    yield* this._loadConfigData(eslintAllPath, { name });
                } else {
                    throw configMissingError(extendName);
                }

            // Plugin's config
            } else if (extendName.startsWith("plugin:")) {
                const slashIndex = extendName.lastIndexOf("/");
                const pluginName = extendName.slice(7, slashIndex);
                const configName = extendName.slice(slashIndex + 1);

                if (isFilePath(pluginName)) {
                    throw new Error("'extends' cannot use a file path for plugins.");
                }

                const plugin = this._loadPlugin(pluginName, filePath);
                const pluginConfigData =
                    plugin.definition &&
                    plugin.definition.configs &&
                    plugin.definition.configs[configName];

                if (pluginConfigData) {
                    validateConfigSchema(pluginConfigData, name);
                    yield* this._normalizeConfigData(
                        pluginConfigData,
                        { filePath: plugin.filePath, name }
                    );
                } else if (plugin.error) {
                    throw plugin.error;
                } else {
                    throw configMissingError(extendName);
                }

            // Shareable config
            } else {
                let request;

                if (isFilePath(extendName)) {
                    request = extendName;
                } else if (extendName.startsWith(".")) {
                    request = `./${extendName}`; // For backward compatibility. A ton of tests depended on this behavior.
                } else {
                    request = naming.normalizePackageName(
                        extendName,
                        "eslint-config"
                    );
                }

                const configFilePath = ModuleResolver.resolve(request, filePath);

                yield* this._loadConfigData(configFilePath, { name });
            }
        } catch (error) {
            error.message += `\nReferenced from: ${filePath}`;
            throw error;
        }
    }

    /**
     * Load given plugins.
     * @param {string[]} names The plugin names to load.
     * @param {string} importerPath The path to a config file that imports it. This is just a debug info.
     * @returns {Record<string,LoadedEntity>} The loaded parser.
     * @private
     */
    _loadPlugins(names, importerPath) {
        return names.reduce((map, name) => {
            if (isFilePath(name)) {
                throw new Error("Plugins array cannot includes file paths.");
            }
            const plugin = this._loadPlugin(name, importerPath);

            map[plugin.id] = plugin;

            return map;
        }, {});
    }

    /**
     * Load a given parser.
     * @param {string} nameOrPath The package name or the path to a parser file.
     * @param {string} importerPath The path to a config file that imports it.
     * @returns {LoadedEntity} The loaded parser.
     */
    _loadParser(nameOrPath, importerPath) {
        debug("Loading parser %j from %s", nameOrPath, importerPath);

        // Check for additional pool.
        const parser = this._additionalPluginPool.get(nameOrPath);

        if (parser) {
            return new LoadedEntity({
                definition: parser,
                filePath: importerPath,
                id: nameOrPath,
                importerPath
            });
        }

        try {
            const filePath = ModuleResolver.resolve(nameOrPath, importerPath);

            // This step is costly, so skip if debug is disabled
            if (debug.enabled) {
                let version = null;

                try {
                    version = require(`${nameOrPath}/package.json`).version;
                } catch (e) {

                    // Do nothing
                }

                const loadedParserAndVersion = version
                    ? `${nameOrPath}@${version}`
                    : `${nameOrPath}, version unknown`;

                debug("Loaded  parser %j (%s) (%s)", nameOrPath, loadedParserAndVersion, filePath);
            }

            return new LoadedEntity({
                definition: require(filePath),
                filePath,
                id: nameOrPath,
                importerPath
            });
        } catch (error) {
            return new LoadedEntity({
                error: error instanceof Error ? error : new Error(error),
                id: nameOrPath,
                importerPath
            });
        }
    }

    /**
     * Load a given plugin.
     * @param {string} nameOrPath The plugin name to load.
     * @param {string} importerPath The path to a config file that imports it. This is just a debug info.
     * @returns {LoadedEntity} The loaded plugin.
     * @private
     */
    _loadPlugin(nameOrPath, importerPath) {
        debug("Loading plugin %j from %s", nameOrPath, importerPath);

        let request, id;

        if (isFilePath(nameOrPath)) {
            request = id = nameOrPath;
        } else {
            request = naming.normalizePackageName(nameOrPath, "eslint-plugin");
            id = naming.getShorthandName(request, "eslint-plugin");

            if (nameOrPath.match(/\s+/u)) {
                const error = new Error(`Whitespace found in plugin name '${nameOrPath}'`);

                error.messageTemplate = "whitespace-found";
                error.messageData = { pluginName: request };

                return { error, id, importerPath };
            }

            // Check for additional pool.
            const plugin =
                this._additionalPluginPool.get(request) ||
                this._additionalPluginPool.get(id);

            if (plugin) {
                return new LoadedEntity({
                    definition: plugin,
                    filePath: importerPath,
                    id,
                    importerPath
                });
            }
        }

        try {

            // Resolve the plugin file relative to the project root.
            const filePath = ModuleResolver.resolve(request, path.join(this._cwd, "a.js"));

            // This step is costly, so skip if debug is disabled
            if (debug.enabled) {
                let version = null;

                try {
                    version = require(`${request}/package.json`).version;
                } catch (e) {

                    // Do nothing
                }

                const loadedPluginAndVersion = version
                    ? `${request}@${version}`
                    : `${request}, version unknown`;

                debug("Loaded  plugin %j (%s) (%s)", nameOrPath, loadedPluginAndVersion, filePath);
            }

            return new LoadedEntity({
                definition: require(filePath),
                filePath,
                id,
                importerPath
            });
        } catch (error) {
            if (error && error.code === "MODULE_NOT_FOUND") {
                debug(`Failed to load plugin ${request}.`);
                error.message = `Failed to load plugin ${request}: ${error.message} (relative to ${this._cwd})`;
                error.messageTemplate = "plugin-missing";
                error.messageData = {
                    pluginName: request,
                    projectRoot: this._cwd
                };
            }

            return new LoadedEntity({
                error: error instanceof Error ? error : new Error(error),
                id,
                importerPath
            });
        }
    }

    /**
     * Take file expression processors as config array elements.
     * @param {Object} plugins The plugin definitions.
     * @param {Object} [options] The file path.
     * @param {string} [options.filePath] The file path of this config.
     * @param {string} [options.name] The name of this config.
     * @returns {IterableIterator<ConfigArrayElement>} The config array elements of file expression processors.
     * @private
     */
    *_takeFileExtensionProcessors(plugins, { filePath, name }) {
        for (const pluginId of Object.keys(plugins)) {
            const processors =
                plugins[pluginId] &&
                plugins[pluginId].definition &&
                plugins[pluginId].definition.processors;

            if (!processors) {
                continue;
            }

            for (const processorId of Object.keys(processors)) {
                if (processorId.startsWith(".")) {
                    yield* this._normalizeConfigData(
                        {
                            files: [`*${processorId}`],
                            processor: `${pluginId}/${processorId}`
                        },
                        {
                            filePath,
                            name: `${name}#processors[${processorId}]`
                        }
                    );
                }
            }
        }
    }
}

module.exports = { ConfigArrayFactory };
