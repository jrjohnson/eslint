"use strict";

const path = require("path");
const { Minimatch } = require("minimatch");
const minimatchOpts = { dot: true, matchBase: true };

/**
 * @typedef {Object} Pattern
 * @property {Minimatch[] | null} includes The positive matchers.
 * @property {Minimatch[] | null} excludes The negative matchers.
 */

/**
 * Normalize a given pattern to an array.
 * @param {string|string[]|undefined} patterns A glob pattern or an array of glob patterns.
 * @returns {string[]|null} Normalized patterns.
 * @private
 */
function normalizePatterns(patterns) {
    if (Array.isArray(patterns)) {
        return patterns.filter(Boolean);
    }
    if (typeof patterns === "string" && patterns) {
        return [patterns];
    }
    return [];
}

/**
 * Create the matchers of given patterns.
 * @param {string[]} patterns The patterns.
 * @returns {Minimatch[] | null} The matchers.
 */
function toMatcher(patterns) {
    if (patterns.length === 0) {
        return null;
    }
    return patterns.map(pattern => new Minimatch(pattern, minimatchOpts));
}

/**
 * Convert a given matcher to string.
 * @param {Pattern} matchers The matchers.
 * @returns {string} The string expression of the matcher.
 */
function patternToJson({ includes, excludes }) {
    return {
        includes: includes && includes.map(m => m.pattern),
        excludes: excludes && excludes.map(m => m.pattern)
    };
}

/**
 * The class to test given paths are matched by the patterns.
 */
class OverrideTester {
    static create(files, excludedFiles, basePath) {
        const includePatterns = normalizePatterns(files);
        const excludePatterns = normalizePatterns(excludedFiles);
        const allPatterns = includePatterns.concat(excludePatterns);

        if (allPatterns.length === 0) {
            return null;
        }

        // Rejects absolute paths or relative paths to parents.
        for (const pattern of allPatterns) {
            if (path.isAbsolute(pattern) || pattern.includes("..")) {
                throw new Error(`Invalid override pattern (expected relative path not containing '..'): ${pattern}`);
            }
        }

        const includes = toMatcher(includePatterns);
        const excludes = toMatcher(excludePatterns);

        return new OverrideTester([{ includes, excludes }], basePath);
    }

    /**
     * Combine two testers by logical and.
     * @param {OverrideTester} a A tester.
     * @param {OverrideTester} b Another tester.
     * @returns {OverrideTester} Combined tester.
     */
    static and(a, b) {
        if (!b) {
            return a;
        }
        if (!a) {
            return b;
        }

        return new OverrideTester(a.patterns.concat(b.patterns), a.basePath);
    }

    /**
     * Initialize this instance.
     * @param {Pattern[]} patterns The matchers.
     * @param {string} basePath The base path.
     */
    constructor(patterns, basePath) {

        /** @type {Pattern[]} */
        this.patterns = patterns;

        /** @type {string} */
        this.basePath = basePath;
    }

    /**
     * Test if a given path is matched or not.
     * @param {string} filePath The absolute path to the target file.
     * @returns {boolean} `true` if the path was matched.
     */
    test(filePath) {
        const relativePath = path.relative(this.basePath, filePath);

        return this.patterns.every(({ includes, excludes }) => (
            (!includes || includes.some(m => m.match(relativePath))) &&
            (!excludes || !excludes.some(m => m.match(relativePath)))
        ));
    }

    /**
     * @returns {Object} a JSON compatible object.
     */
    toJSON() {
        if (this.patterns.length === 1) {
            return {
                ...patternToJson(this.patterns[0]),
                basePath: this.basePath
            };
        }
        return {
            AND: this.patterns.map(patternToJson),
            basePath: this.basePath
        };
    }

    [Symbol.for("nodejs.util.inspect.custom")]() {
        return this.toJSON();
    }
}

module.exports = { OverrideTester };
