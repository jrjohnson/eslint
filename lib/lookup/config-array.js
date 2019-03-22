"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const { ExtractedConfig } = require("./extracted-config");

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

/**
 * @typedef {Object} ConfigArrayElement
 * @property {string} name The name of this config element.
 * @property {string} filePath The path to the source file of this config element.
 * @property {OverrideTester|null} criteria The tester for the `files` and `excludedFiles` of this config element.
 * @property {Record<string, boolean>|undefined} env The environment settings.
 * @property {Record<string, boolean|string>|undefined} globals The global variable settings.
 * @property {ConfigDependency|undefined} parser The parser loader.
 * @property {Object|undefined} parserOptions The parser options.
 * @property {Record<string, ConfigDependency>|undefined} plugins The plugin loaders.
 * @property {string|undefined} processor The processor name to refer plugin's processor.
 * @property {boolean|undefined} root The flag to express root.
 * @property {Record<string, Array>|undefined} rules The rule settings
 * @property {Object|undefined} settings The shared settings.
 */

/**
 * @typedef {Object} ConfigArrayInternalSlots
 * @property {Map<string, ExtractedConfig>} cache The cache to extract configs.
 * @property {Map<string, Object>|null} envMap The map from environment ID to environment definition.
 * @property {Map<string, Object>|null} processorMap The map from processor ID to environment definition.
 * @property {Map<string, Object>|null} ruleMap The map from rule ID to rule definition.
 */

/** @type {WeakMap<ConfigArray, ConfigArrayInternalSlots>} */
const internalSlotsMap = new class extends WeakMap {
    get(key) {
        let value = super.get(key);

        if (!value) {
            value = {
                cache: new Map(),
                envMap: null,
                processorMap: null,
                ruleMap: null
            };
            super.set(key, value);
        }

        return value;
    }
}();

/**
 * Get the indices which are matched to a given file.
 * @param {ConfigArrayElement[]} elements The elements.
 * @param {string} filePath The path to a target file.
 * @returns {number[]} The indices.
 */
function getMatchedIndices(elements, filePath) {
    const indices = [];

    for (let i = elements.length - 1; i >= 0; --i) {
        const element = elements[i];

        if (!element.criteria || element.criteria.test(filePath)) {
            indices.push(i);
        }
    }

    return indices;
}

/**
 * Check if a value is a non-null object.
 * @param {any} x The value to check.
 * @returns {boolean} `true` if the value is a non-null object.
 */
function isNonNullObject(x) {
    return typeof x === "object" && x !== null;
}

/**
 * Merge two objects.
 *
 * Assign every property values of `y` to `x` if `x` doesn't have the property.
 * If `x`'s property value is an object, it does recursive.
 * If either property value is an array, it concatenates those.
 *
 * @param {Object} target The destination to merge
 * @param {Object|undefined} source The source to merge.
 * @returns {void}
 */
function assignWithoutOverwrite(target, source) {
    if (!isNonNullObject(source)) {
        return;
    }

    for (const key of Object.keys(source)) {
        if (isNonNullObject(target[key])) {
            assignWithoutOverwrite(target[key], source[key]);
        } else if (target[key] === void 0) {
            if (isNonNullObject(source[key])) {
                target[key] = Array.isArray(source[key]) ? [] : {};
                assignWithoutOverwrite(target[key], source[key]);
            } else if (source[key] !== void 0) {
                target[key] = source[key];
            }
        }
    }
}

/**
 * Merge plugins.
 * `target`'s definition is prior to `source`'s.
 *
 * @param {Object} target The destination to merge
 * @param {Object|undefined} source The source to merge.
 * @returns {void}
 */
function mergePlugins(target, source) {
    if (!isNonNullObject(source)) {
        return;
    }

    for (const key of Object.keys(source)) {
        const targetValue = target[key];
        const sourceValue = source[key];

        // Adopt the plugin which was found at first.
        if (targetValue === void 0) {
            if (sourceValue.error) {
                throw sourceValue.error;
            }
            target[key] = sourceValue;
        }
    }
}

/**
 * Merge rules.
 * `target`'s definition is prior to `source`'s.
 *
 * @param {Object} target The destination to merge
 * @param {Object|undefined} source The source to merge.
 * @returns {void}
 */
function mergeRules(target, source) {
    if (!isNonNullObject(source)) {
        return;
    }

    for (const key of Object.keys(source)) {
        const targetDef = target[key];
        const sourceDef = source[key];

        if (targetDef === void 0) {
            if (Array.isArray(sourceDef)) {
                target[key] = [...sourceDef];
            } else {
                target[key] = [sourceDef]; // Severity only.
            }
        } else if (
            targetDef.length === 1 &&
            Array.isArray(sourceDef) &&
            sourceDef.length >= 2
        ) {
            targetDef.push(...sourceDef.slice(1)); // Options only.
        }
    }
}

/**
 * Create the extracted config.
 * @param {ConfigArray} instance The config elements.
 * @param {number[]} indices The indices to use.
 * @returns {ExtractedConfig} The extracted config.
 */
function createConfig(instance, indices) {
    const slots = internalSlotsMap.get(instance);
    const config = new ExtractedConfig();

    // Merge elements.
    for (const index of indices) {
        const element = instance[index];

        if (!config.parser && element.parser) {
            if (element.parser.error) {
                throw element.parser.error;
            }
            config.parser = element.parser;
        }
        if (!config.processor && element.processor) {
            config.processor = element.processor;
        }

        assignWithoutOverwrite(config.env, element.env);
        assignWithoutOverwrite(config.globals, element.globals);
        assignWithoutOverwrite(config.parserOptions, element.parserOptions);
        assignWithoutOverwrite(config.settings, element.settings);
        mergePlugins(config.plugins, element.plugins, slots);
        mergeRules(config.rules, element.rules);
    }

    return config;
}

/**
 * Collect definitions.
 * @param {string} pluginId The plugin ID for prefix.
 * @param {Object} defs The definitions to collect.
 * @param {Map<string, Object>} map The map to output.
 * @param {Function} [normalize] The normalize function for each value.
 * @returns {void}
 */
function collect(pluginId, defs, map, normalize) {
    if (defs) {
        const prefix = pluginId && `${pluginId}/`;

        for (const [key, value] of Object.entries(defs)) {
            map.set(
                `${prefix}${key}`,
                normalize ? normalize(value) : value
            );
        }
    }
}

/**
 * Normalize a rule definition.
 * @param {Object} rule The rule definition to normalize.
 * @returns {Object} The normalized rule definition.
 */
function normalizePluginRule(rule) {
    switch (typeof rule) {
        case "string":
            return normalizePluginRule(require(rule));
        case "function":
            return { create: rule };
        default:
            return rule;
    }
}

/**
 * Delete the mutation methods from a given map.
 * @param {Map<any, any>} map The map object to delete.
 * @returns {void}
 */
function deleteMutationMethods(map) {
    Object.defineProperties(map, {
        clear: { configurable: true, value: void 0 },
        delete: { configurable: true, value: void 0 },
        set: { configurable: true, value: void 0 }
    });
}

/**
 * Create `envMap`, `processorMap`, `ruleMap` with the plugins in the config array.
 * @param {ConfigArray} elements The config elements.
 * @returns {ConfigArrayInternalSlots} The extracted config.
 */
function initPluginMemberMaps(elements, { envMap, processorMap, ruleMap }) {
    const processed = new Set();

    for (const element of elements) {
        if (!element.plugins) {
            continue;
        }

        for (const [pluginId, value] of Object.entries(element.plugins)) {
            const plugin = value.definition;

            if (!plugin || processed.has(pluginId)) {
                continue;
            }
            processed.add(pluginId);

            collect(pluginId, plugin.environments, envMap);
            collect(pluginId, plugin.processors, processorMap);
            collect(pluginId, plugin.rules, ruleMap, normalizePluginRule);
        }
    }

    deleteMutationMethods(envMap);
    deleteMutationMethods(processorMap);
    deleteMutationMethods(ruleMap);
}

/**
 * Create `envMap`, `processorMap`, `ruleMap` with the plugins in the config array.
 * @param {ConfigArray} instance The config elements.
 * @returns {ConfigArrayInternalSlots} The extracted config.
 */
function ensurePluginMemberMaps(instance) {
    const slots = internalSlotsMap.get(instance);

    if (!slots.ruleMap) {
        slots.envMap = new Map();
        slots.processorMap = new Map();
        slots.ruleMap = new Map();
        initPluginMemberMaps(instance, slots);
    }

    return slots;
}

//------------------------------------------------------------------------------
// Public Interface
//------------------------------------------------------------------------------

/**
 * The Config Array.
 *
 * `ConfigArray` instance contains all settings, parsers, and plugins.
 * You need to call `ConfigArray#extractConfig(filePath)` method in order to
 * extract, merge and get only the config data which is related to an arbitrary
 * file.
 *
 * @extends {Array<ConfigArrayElement>}
 */
class ConfigArray extends Array {

    /**
     * Get the plugin environments.
     * The returned map cannot be mutated.
     * @type {ReadonlyMap<string, Object>} The plugin environments.
     */
    get pluginEnvironments() {
        return ensurePluginMemberMaps(this).envMap;
    }

    /**
     * Get the plugin processors.
     * The returned map cannot be mutated.
     * @type {ReadonlyMap<string, Object>} The plugin processors.
     */
    get pluginProcessors() {
        return ensurePluginMemberMaps(this).processorMap;
    }

    /**
     * Get the plugin rules.
     * The returned map cannot be mutated.
     * @returns {ReadonlyMap<string, Object>} The plugin rules.
     */
    get pluginRules() {
        return ensurePluginMemberMaps(this).ruleMap;
    }

    /**
     * Check if this config has `root` flag.
     * @type {boolean}
     */
    get root() {
        for (let i = this.length - 1; i >= 0; --i) {
            const root = this[i].root;

            if (typeof root === "boolean") {
                return root;
            }
        }
        return false;
    }

    /**
     * Extract the config data which is related to a given file.
     * @param {string} filePath The absolute path to the target file.
     * @returns {ExtractedConfig} The extracted config data.
     */
    extractConfig(filePath) {
        const { cache } = internalSlotsMap.get(this);
        const indices = getMatchedIndices(this, filePath);
        const cacheKey = indices.join(",");

        if (!cache.has(cacheKey)) {
            cache.set(cacheKey, createConfig(this, indices));
        }

        return cache.get(cacheKey);
    }
}

module.exports = {
    ConfigArray,

    /**
     * Get the used extracted configs.
     * CLIEngine will use this method to collect used deprecated rules.
     * @param {ConfigArray} instance The config array object to get.
     * @returns {ExtractedConfig[]} The used extracted configs.
     * @private
     */
    getUsedExtractedConfigs(instance) {
        const { cache } = internalSlotsMap.get(instance);

        return Array.from(cache.values());
    }
};
