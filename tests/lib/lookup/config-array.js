/**
 * @fileoverview Tests for ConfigArray class.
 * @author Toru Nagashima <https://github.com/mysticatea>
 */
"use strict";

const { assert } = require("chai");
const { ConfigArray } = require("../../../lib/lookup/config-array");
const { OverrideTester } = require("../../../lib/lookup/override-tester");

describe("ConfigArray", () => {
    describe("'isRoot()' should the value of the last element which has 'root' property.", () => {
        const patterns = [
            { elements: [], expected: false },
            { elements: [{}], expected: false },
            { elements: [{}, {}], expected: false },
            { elements: [{ root: false }], expected: false },
            { elements: [{ root: true }], expected: true },
            { elements: [{ root: true }, { root: false }], expected: false },
            { elements: [{ root: false }, { root: true }], expected: true },
            { elements: [{ root: true }, { root: 1 }], expected: true } // ignore non-boolean value
        ];

        for (const { elements, expected } of patterns) {
            it(`should be ${expected} if the elements are ${JSON.stringify(elements)}.`, () => {
                assert.strictEqual(new ConfigArray(...elements).isRoot(), expected);
            });
        }
    });

    describe("'getPluginEnvironment(id)' retrieves the environments of used plugins.", () => {
    });

    describe("'extractConfig(filePath)' retrieves the merged config for a given file.", () => {
        it("should throw an error if no arguments were given.", () => {
            assert.throws(() => {
                new ConfigArray().extractConfig();
            }, "'filePath' should be an absolute path, but got undefined.");
        });

        it("should throw an error if a non-string value was given.", () => {
            assert.throws(() => {
                new ConfigArray().extractConfig(100);
            }, "'filePath' should be an absolute path, but got 100.");
        });

        it("should throw an error if a relative path was given.", () => {
            assert.throws(() => {
                new ConfigArray().extractConfig("foo/bar.js");
            }, "'filePath' should be an absolute path, but got foo/bar.js.");
        });

        it("should throw an error if a 'parser' has the loading error.", () => {
            assert.throws(() => {
                new ConfigArray(
                    {
                        parser: { error: new Error("Failed to load a parser.") }
                    }
                ).extractConfig(__filename);
            }, "Failed to load a parser.");
        });

        it("should not throw if the errored 'parser' was not used; overwriten", () => {
            const parser = { id: "a parser" };
            const config = new ConfigArray(
                {
                    parser: { error: new Error("Failed to load a parser.") }
                },
                {
                    parser
                }
            ).extractConfig(__filename);

            assert.strictEqual(config.parser, parser);
        });

        it("should not throw if the errored 'parser' was not used; not matched", () => {
            const config = new ConfigArray(
                {
                    criteria: OverrideTester.create(["*.ts"], [], process.cwd()),
                    parser: { error: new Error("Failed to load a parser.") }
                }
            ).extractConfig(__filename);

            assert.strictEqual(config.parser, null);
        });

        it("should throw an error if a 'plugins' value has the loading error.", () => {
            assert.throws(() => {
                new ConfigArray(
                    {
                        plugins: {
                            foo: { error: new Error("Failed to load a plugin.") }
                        }
                    }
                ).extractConfig(__filename);
            }, "Failed to load a plugin.");
        });

        it("should not throw if the errored 'plugins' value was not used; not matched", () => {
            const config = new ConfigArray(
                {
                    criteria: OverrideTester.create(["*.ts"], [], process.cwd()),
                    plugins: {
                        foo: { error: new Error("Failed to load a plugin.") }
                    }
                }
            ).extractConfig(__filename);

            assert.deepStrictEqual(config.plugins, {});
        });

        describe("Moved from 'merge()' in tests/lib/config/config-ops.js", () => {

            /**
             * Merge two config data.
             * @param {Object} target A config data.
             * @param {Object} source Another config data.
             * @returns {Object} The merged config data.
             */
            function merge(target, source) {
                return new ConfigArray(target, source).extractConfig(__filename);
            }

            it("should combine two objects when passed two objects with different top-level properties", () => {
                const config = [
                    { env: { browser: true } },
                    { globals: { foo: "bar" } }
                ];

                const result = merge(config[0], config[1]);

                assert.strictEqual(result.globals.foo, "bar");
                assert.isTrue(result.env.browser);
            });

            it("should combine without blowing up on null values", () => {
                const config = [
                    { env: { browser: true } },
                    { env: { node: null } }
                ];

                const result = merge(config[0], config[1]);

                assert.strictEqual(result.env.node, null);
                assert.isTrue(result.env.browser);
            });

            it("should combine two objects with parser when passed two objects with different top-level properties", () => {
                const config = [
                    { env: { browser: true }, parser: "espree" },
                    { globals: { foo: "bar" } }
                ];

                const result = merge(config[0], config[1]);

                assert.strictEqual(result.parser, "espree");
            });

            it("should combine configs and override rules when passed configs with the same rules", () => {
                const config = [
                    { rules: { "no-mixed-requires": [0, false] } },
                    { rules: { "no-mixed-requires": [1, true] } }
                ];

                const result = merge(config[0], config[1]);

                assert.isArray(result.rules["no-mixed-requires"]);
                assert.strictEqual(result.rules["no-mixed-requires"][0], 1);
                assert.strictEqual(result.rules["no-mixed-requires"][1], true);
            });

            it("should combine configs when passed configs with parserOptions", () => {
                const config = [
                    { parserOptions: { ecmaFeatures: { jsx: true } } },
                    { parserOptions: { ecmaFeatures: { globalReturn: true } } }
                ];

                const result = merge(config[0], config[1]);

                assert.deepStrictEqual(result, {
                    env: {},
                    globals: {},
                    parser: null,
                    parserOptions: {
                        ecmaFeatures: {
                            jsx: true,
                            globalReturn: true
                        }
                    },
                    plugins: {},
                    processor: null,
                    rules: {},
                    settings: {}
                });

                // double-check that originals were not changed
                assert.deepStrictEqual(config[0], { parserOptions: { ecmaFeatures: { jsx: true } } });
                assert.deepStrictEqual(config[1], { parserOptions: { ecmaFeatures: { globalReturn: true } } });
            });

            it("should override configs when passed configs with the same ecmaFeatures", () => {
                const config = [
                    { parserOptions: { ecmaFeatures: { globalReturn: false } } },
                    { parserOptions: { ecmaFeatures: { globalReturn: true } } }
                ];

                const result = merge(config[0], config[1]);

                assert.deepStrictEqual(result, {
                    env: {},
                    globals: {},
                    parser: null,
                    parserOptions: {
                        ecmaFeatures: {
                            globalReturn: true
                        }
                    },
                    plugins: {},
                    processor: null,
                    rules: {},
                    settings: {}
                });
            });

            it("should combine configs and override rules when merging two configs with arrays and int", () => {

                const config = [
                    { rules: { "no-mixed-requires": [0, false] } },
                    { rules: { "no-mixed-requires": 1 } }
                ];

                const result = merge(config[0], config[1]);

                assert.isArray(result.rules["no-mixed-requires"]);
                assert.strictEqual(result.rules["no-mixed-requires"][0], 1);
                assert.strictEqual(result.rules["no-mixed-requires"][1], false);
                assert.deepStrictEqual(config[0], { rules: { "no-mixed-requires": [0, false] } });
                assert.deepStrictEqual(config[1], { rules: { "no-mixed-requires": 1 } });
            });

            it("should combine configs and override rules options completely", () => {

                const config = [
                    { rules: { "no-mixed-requires1": [1, { event: ["evt", "e"] }] } },
                    { rules: { "no-mixed-requires1": [1, { err: ["error", "e"] }] } }
                ];

                const result = merge(config[0], config[1]);

                assert.isArray(result.rules["no-mixed-requires1"]);
                assert.deepStrictEqual(result.rules["no-mixed-requires1"][1], { err: ["error", "e"] });
                assert.deepStrictEqual(config[0], { rules: { "no-mixed-requires1": [1, { event: ["evt", "e"] }] } });
                assert.deepStrictEqual(config[1], { rules: { "no-mixed-requires1": [1, { err: ["error", "e"] }] } });
            });

            it("should combine configs and override rules options without array or object", () => {

                const config = [
                    { rules: { "no-mixed-requires1": ["warn", "nconf", "underscore"] } },
                    { rules: { "no-mixed-requires1": [2, "requirejs"] } }
                ];

                const result = merge(config[0], config[1]);

                assert.strictEqual(result.rules["no-mixed-requires1"][0], 2);
                assert.strictEqual(result.rules["no-mixed-requires1"][1], "requirejs");
                assert.isUndefined(result.rules["no-mixed-requires1"][2]);
                assert.deepStrictEqual(config[0], { rules: { "no-mixed-requires1": ["warn", "nconf", "underscore"] } });
                assert.deepStrictEqual(config[1], { rules: { "no-mixed-requires1": [2, "requirejs"] } });
            });

            it("should combine configs and override rules options without array or object but special case", () => {

                const config = [
                    { rules: { "no-mixed-requires1": [1, "nconf", "underscore"] } },
                    { rules: { "no-mixed-requires1": "error" } }
                ];

                const result = merge(config[0], config[1]);

                assert.strictEqual(result.rules["no-mixed-requires1"][0], "error");
                assert.strictEqual(result.rules["no-mixed-requires1"][1], "nconf");
                assert.strictEqual(result.rules["no-mixed-requires1"][2], "underscore");
                assert.deepStrictEqual(config[0], { rules: { "no-mixed-requires1": [1, "nconf", "underscore"] } });
                assert.deepStrictEqual(config[1], { rules: { "no-mixed-requires1": "error" } });
            });

            it("should combine configs correctly", () => {

                const config = [
                    {
                        rules: {
                            "no-mixed-requires1": [1, { event: ["evt", "e"] }],
                            "valid-jsdoc": 1,
                            semi: 1,
                            quotes1: [2, { exception: ["hi"] }],
                            smile: [1, ["hi", "bye"]]
                        },
                        parserOptions: {
                            ecmaFeatures: { jsx: true }
                        },
                        env: { browser: true },
                        globals: { foo: false }
                    },
                    {
                        rules: {
                            "no-mixed-requires1": [1, { err: ["error", "e"] }],
                            "valid-jsdoc": 2,
                            test: 1,
                            smile: [1, ["xxx", "yyy"]]
                        },
                        parserOptions: {
                            ecmaFeatures: { globalReturn: true }
                        },
                        env: { browser: false },
                        globals: { foo: true }
                    }
                ];

                const result = merge(config[0], config[1]);

                assert.deepStrictEqual(result, {
                    parser: null,
                    parserOptions: {
                        ecmaFeatures: {
                            jsx: true,
                            globalReturn: true
                        }
                    },
                    plugins: {},
                    env: {
                        browser: false
                    },
                    globals: {
                        foo: true
                    },
                    rules: {
                        "no-mixed-requires1": [1,
                            {
                                err: [
                                    "error",
                                    "e"
                                ]
                            }
                        ],
                        quotes1: [2,
                            {
                                exception: [
                                    "hi"
                                ]
                            }
                        ],
                        semi: [1],
                        smile: [1, ["xxx", "yyy"]],
                        test: [1],
                        "valid-jsdoc": [2]
                    },
                    settings: {},
                    processor: null
                });
                assert.deepStrictEqual(config[0], {
                    rules: {
                        "no-mixed-requires1": [1, { event: ["evt", "e"] }],
                        "valid-jsdoc": 1,
                        semi: 1,
                        quotes1: [2, { exception: ["hi"] }],
                        smile: [1, ["hi", "bye"]]
                    },
                    parserOptions: {
                        ecmaFeatures: { jsx: true }
                    },
                    env: { browser: true },
                    globals: { foo: false }
                });
                assert.deepStrictEqual(config[1], {
                    rules: {
                        "no-mixed-requires1": [1, { err: ["error", "e"] }],
                        "valid-jsdoc": 2,
                        test: 1,
                        smile: [1, ["xxx", "yyy"]]
                    },
                    parserOptions: {
                        ecmaFeatures: { globalReturn: true }
                    },
                    env: { browser: false },
                    globals: { foo: true }
                });
            });

            it("should copy deeply if there is not the destination's property", () => {
                const a = {};
                const b = { settings: { bar: 1 } };

                const result = merge(a, b);

                assert(a.settings === void 0);
                assert(b.settings.bar === 1);
                assert(result.settings.bar === 1);

                result.settings.bar = 2;
                assert(b.settings.bar === 1);
                assert(result.settings.bar === 2);
            });
        });
    });
});
