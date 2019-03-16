"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const path = require("path");
const { validateConfigArrayElement } = require("../config/config-validator");
const { ExtractedConfig } = require("./extracted-config");

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

/**
 * @typedef {Object} ConfigArrayInternalSlots
 * @property {Set<string>} processedPluginIds The set of the plugin IDs what it has collected rules and envs.
 * @property {Map<string, ExtractedConfig>} cache The cache to extract configs.
 * @property {Map<string, Object>} envMap The map from environment ID to environment definition. It includes only adopted elements'.
 * @property {Map<string, Object>} processorMap The map from processor ID to environment definition. It includes only adopted elements'.
 * @property {Map<string, Object>} ruleMap The map from rule ID to rule definition. It includes only adopted elements'.
 */

/** @type {WeakMap<ConfigArray, ConfigArrayInternalSlots>} */
const internalSlotsMap = new class extends WeakMap {
    get(key) {
        let value = super.get(key);

        if (!value) {
            value = {
                processedPluginIds: new Set(),
                cache: new Map(),
                envMap: new Map(),
                processorMap: new Map(),
                ruleMap: new Map()
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
 * Merge plugins.
 * `target`'s definition is prior to `source`'s.
 *
 * @param {Object} target The destination to merge
 * @param {Object|undefined} source The source to merge.
 * @param {ConfigArrayInternalSlots} slots The internal slots.
 * @returns {void}
 */
function mergePlugins(target, source, { envMap, processorMap, ruleMap }) {
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

            // Collect envs, processors, and rules.
            collect(key, sourceValue.definition.environments, envMap);
            collect(key, sourceValue.definition.processors, processorMap);
            collect(key, sourceValue.definition.rules, ruleMap, normalizePluginRule);
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

    /*
     * Validate environments and rule's configs.
     * This needs an additional loop to ensure all dependent plugins to be
     * loaded because merging loop starts from the leaf of the configuration
     * tree.
     */
    for (const index of indices) {
        validateConfigArrayElement(
            instance[index],
            id => slots.ruleMap.get(id),
            id => slots.envMap.get(id)
        );
    }

    return config;
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
 */
class ConfigArray extends Array {

    /**
     * Check if this config has `root` flag.
     * @returns {boolean} `true` if this config has `root` flag.
     */
    isRoot() {
        for (let i = this.length - 1; i >= 0; --i) {
            const root = this[i].root;

            if (typeof root === "boolean") {
                return root;
            }
        }
        return false;
    }

    /**
     * Get the plugin env definition with a given ID.
     * This method retrieves only the environments in the elements which have been extracted.
     *
     * @param {string} envId The env ID to get.
     * @returns {Object|null} The env definition.
     */
    getPluginEnvironment(envId) {
        const { envMap } = internalSlotsMap.get(this);

        return envMap.get(envId) || null;
    }

    /**
     * Get the plugin processor definition with a given ID.
     * This method retrieves only the processors in the elements which have been extracted.
     *
     * @param {string} processorId The processor ID to get.
     * @returns {Object|null} The processor definition.
     */
    getPluginProcessor(processorId) {
        const { processorMap } = internalSlotsMap.get(this);

        return processorMap.get(processorId) || null;
    }

    /**
     * Get the plugin rule definition with a given ID.
     * This method retrieves only the rules in the elements which have been extracted.
     *
     * @param {string} ruleId The rule ID to get.
     * @returns {Object|null} The rule definition.
     */
    getPluginRule(ruleId) {
        const { ruleMap } = internalSlotsMap.get(this);

        return ruleMap.get(ruleId) || null;
    }

    /**
     * Extract the config data which is related to a given file.
     * @param {string} filePath The absolute path to the target file.
     * @returns {ExtractedConfig} The extracted config data.
     */
    extractConfig(filePath) {
        if (typeof filePath !== "string" || !path.isAbsolute(filePath)) {
            throw new Error(`'filePath' should be an absolute path, but got ${filePath}.`);
        }

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
