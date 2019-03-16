/**
 * @fileoverview Tests for FileEnumerator class.
 * @author Toru Nagashima <https://github.com/mysticatea>
 */
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { assert } = require("chai");
const mockFs = require("mock-fs");
const sh = require("shelljs");
const sinon = require("sinon");
const { ConfigArrayFactory } = require("../../../lib/lookup/config-array-factory");
const { ExtractedConfig } = require("../../../lib/lookup/extracted-config");
const { FileEnumerator } = require("../../../lib/lookup/file-enumerator");
const { IgnoredPaths } = require("../../../lib/lookup/ignored-paths");
const { ModuleResolver } = require("../../../lib/lookup/module-resolver");

const proxyquire = require("proxyquire").noCallThru().noPreserveCache();

// Needs to load lazy loading modules before mocking fs.
require("js-yaml");

/**
 * Creates a stubbed FileEnumerator object that will load plugins by name from the objects specified.
 * @param {Object} options The options for FileEnumerator.
 * @param {Object} plugins The keys are the package names, values are plugin objects.
 * @returns {FileEnumerator} The stubbed instance of Config.
 * @private
 */
function createStubbedFileEnumerator(options, plugins) {
    const { ConfigArrayFactory: StubbedConfigArrayFactory } = proxyquire(
        "../../../lib/lookup/config-array-factory",
        {
            ...plugins,
            "./module-resolver": {
                ModuleResolver: {
                    resolve(request, relativeTo) {
                        if (plugins.hasOwnProperty(request)) { // eslint-disable-line no-prototype-builtins
                            return request;
                        }
                        return ModuleResolver.resolve(request, relativeTo);
                    }
                }
            }
        }
    );

    return new FileEnumerator({
        ...options,
        configArrayFactory: new StubbedConfigArrayFactory(options)
    });
}

describe("FileEnumerator", () => {
    describe("Moved from tests/lib/util/glob-utils.js", () => {
        let fixtureDir;

        /**
         * Returns the path inside of the fixture directory.
         * @returns {string} The path inside the fixture directory.
         * @private
         */
        function getFixturePath(...args) {
            return path.join(fs.realpathSync(fixtureDir), ...args);
        }

        /**
         * List files as a compatible shape with glob-utils.
         * @param {string|string[]} patterns The patterns to list files.
         * @param {Object} options The option for FileEnumerator.
         * @returns {{filename:string,ignored:boolean}[]} The listed files.
         */
        function listFiles(patterns, options) {
            return Array.from(
                new FileEnumerator({
                    ...options,
                    ignoredPaths: new IgnoredPaths(options),
                    useEslintrc: false
                }).iterateFiles(patterns),
                ({ filePath, ignored }) => ({ filename: filePath, ignored })
            );
        }

        before(() => {
            fixtureDir = `${os.tmpdir()}/eslint/tests/fixtures/`;
            sh.mkdir("-p", fixtureDir);
            sh.cp("-r", "./tests/fixtures/*", fixtureDir);
        });

        after(() => {
            sh.rm("-r", fixtureDir);
        });

        describe("listFilesToProcess()", () => {
            it("should return an array with a resolved (absolute) filename", () => {
                const patterns = [getFixturePath("glob-util", "one-js-file", "**/*.js")];
                const result = listFiles(patterns, {
                    cwd: getFixturePath()
                });

                const file1 = getFixturePath("glob-util", "one-js-file", "baz.js");

                assert.isArray(result);
                assert.deepStrictEqual(result, [{ filename: file1, ignored: false }]);
            });

            it("should return all files matching a glob pattern", () => {
                const patterns = [getFixturePath("glob-util", "two-js-files", "**/*.js")];
                const result = listFiles(patterns, {
                    cwd: getFixturePath()
                });

                const file1 = getFixturePath("glob-util", "two-js-files", "bar.js");
                const file2 = getFixturePath("glob-util", "two-js-files", "foo.js");

                assert.strictEqual(result.length, 2);
                assert.deepStrictEqual(result, [
                    { filename: file1, ignored: false },
                    { filename: file2, ignored: false }
                ]);
            });

            it("should return all files matching multiple glob patterns", () => {
                const patterns = [
                    getFixturePath("glob-util", "two-js-files", "**/*.js"),
                    getFixturePath("glob-util", "one-js-file", "**/*.js")
                ];
                const result = listFiles(patterns, {
                    cwd: getFixturePath()
                });

                const file1 = getFixturePath("glob-util", "two-js-files", "bar.js");
                const file2 = getFixturePath("glob-util", "two-js-files", "foo.js");
                const file3 = getFixturePath("glob-util", "one-js-file", "baz.js");

                assert.strictEqual(result.length, 3);
                assert.deepStrictEqual(result, [
                    { filename: file1, ignored: false },
                    { filename: file2, ignored: false },
                    { filename: file3, ignored: false }
                ]);
            });

            it("should ignore hidden files for standard glob patterns", () => {
                const patterns = [getFixturePath("glob-util", "hidden", "**/*.js")];

                assert.throws(() => {
                    listFiles(patterns, {
                        cwd: getFixturePath()
                    });
                }, `All files matched by '${patterns[0]}' are ignored.`);
            });

            it("should return hidden files if included in glob pattern", () => {
                const patterns = [getFixturePath("glob-util", "hidden", "**/.*.js")];
                const result = listFiles(patterns, {
                    cwd: getFixturePath()
                });

                const file1 = getFixturePath("glob-util", "hidden", ".foo.js");

                assert.strictEqual(result.length, 1);
                assert.deepStrictEqual(result, [
                    { filename: file1, ignored: false }
                ]);
            });

            it("should ignore default ignored files if not passed explicitly", () => {
                const directory = getFixturePath("glob-util", "hidden");
                const patterns = [directory];

                assert.throws(() => {
                    listFiles(patterns, {
                        cwd: getFixturePath()
                    });
                }, `All files matched by '${directory}' are ignored.`);
            });

            it("should ignore and warn for default ignored files when passed explicitly", () => {
                const filename = getFixturePath("glob-util", "hidden", ".foo.js");
                const patterns = [filename];
                const result = listFiles(patterns, {
                    cwd: getFixturePath()
                });

                assert.strictEqual(result.length, 1);
                assert.deepStrictEqual(result[0], { filename, ignored: true });
            });

            it("should ignore default ignored files if not passed explicitly even if ignore is false", () => {
                const directory = getFixturePath("glob-util", "hidden");
                const patterns = [directory];

                assert.throws(() => {
                    listFiles(patterns, {
                        cwd: getFixturePath(),
                        ignore: false
                    });
                }, `All files matched by '${directory}' are ignored.`);
            });

            it("should not ignore default ignored files when passed explicitly if ignore is false", () => {
                const filename = getFixturePath("glob-util", "hidden", ".foo.js");
                const patterns = [filename];
                const result = listFiles(patterns, {
                    cwd: getFixturePath(),
                    ignore: false
                });

                assert.strictEqual(result.length, 1);
                assert.deepStrictEqual(result[0], { filename, ignored: false });
            });

            it("should throw an error for a file which does not exist", () => {
                const filename = getFixturePath("glob-util", "hidden", "bar.js");
                const patterns = [filename];

                assert.throws(() => {
                    listFiles(patterns, {
                        cwd: getFixturePath(),
                        allowMissingGlobs: true
                    });
                }, `No files matching '${filename}' were found.`);
            });

            it("should throw if a folder that does not have any applicable files is linted", () => {
                const filename = getFixturePath("glob-util", "empty");
                const patterns = [filename];

                assert.throws(() => {
                    listFiles(patterns, {
                        cwd: getFixturePath()
                    });
                }, `No files matching '${filename}' were found.`);
            });

            it("should throw if only ignored files match a glob", () => {
                const pattern = getFixturePath("glob-util", "ignored");
                const options = { ignore: true, ignorePath: getFixturePath("glob-util", "ignored", ".eslintignore") };

                assert.throws(() => {
                    listFiles([pattern], options);
                }, `All files matched by '${pattern}' are ignored.`);
            });

            it("should throw an error if no files match a glob", () => {

                // Relying here on the .eslintignore from the repo root
                const patterns = ["tests/fixtures/glob-util/ignored/**/*.js"];

                assert.throws(() => {
                    listFiles(patterns);
                }, `No files matching '${patterns[0]}' were found.`);
            });

            it("should return an ignored file, if ignore option is turned off", () => {
                const options = { ignore: false };
                const patterns = [getFixturePath("glob-util", "ignored", "**/*.js")];
                const result = listFiles(patterns, options);

                assert.strictEqual(result.length, 1);
            });

            it("should ignore a file from a glob if it matches a pattern in an ignore file", () => {
                const options = { ignore: true, ignorePath: getFixturePath("glob-util", "ignored", ".eslintignore") };
                const patterns = [getFixturePath("glob-util", "ignored", "**/*.js")];

                assert.throws(() => {
                    listFiles(patterns, options);
                }, `All files matched by '${patterns[0]}' are ignored.`);
            });

            it("should ignore a file from a glob if matching a specified ignore pattern", () => {
                const options = { ignore: true, ignorePattern: "foo.js", cwd: getFixturePath() };
                const patterns = [getFixturePath("glob-util", "ignored", "**/*.js")];

                assert.throws(() => {
                    listFiles(patterns, options);
                }, `All files matched by '${patterns[0]}' are ignored.`);
            });

            it("should return a file only once if listed in more than 1 pattern", () => {
                const patterns = [
                    getFixturePath("glob-util", "one-js-file", "**/*.js"),
                    getFixturePath("glob-util", "one-js-file", "baz.js")
                ];
                const result = listFiles(patterns, {
                    cwd: path.join(fixtureDir, "..")
                });

                const file1 = getFixturePath("glob-util", "one-js-file", "baz.js");

                assert.isArray(result);
                assert.deepStrictEqual(result, [
                    { filename: file1, ignored: false }
                ]);
            });

            it("should set 'ignored: true' for files that are explicitly specified but ignored", () => {
                const options = { ignore: true, ignorePattern: "foo.js", cwd: getFixturePath() };
                const filename = getFixturePath("glob-util", "ignored", "foo.js");
                const patterns = [filename];
                const result = listFiles(patterns, options);

                assert.strictEqual(result.length, 1);
                assert.deepStrictEqual(result, [
                    { filename, ignored: true }
                ]);
            });

            it("should not return files from default ignored folders", () => {
                const options = { cwd: getFixturePath("glob-util") };
                const glob = getFixturePath("glob-util", "**/*.js");
                const patterns = [glob];
                const result = listFiles(patterns, options);
                const resultFilenames = result.map(resultObj => resultObj.filename);

                assert.notInclude(resultFilenames, getFixturePath("glob-util", "node_modules", "dependency.js"));
            });

            it("should return unignored files from default ignored folders", () => {
                const options = { ignorePattern: "!/node_modules/dependency.js", cwd: getFixturePath("glob-util") };
                const glob = getFixturePath("glob-util", "**/*.js");
                const patterns = [glob];
                const result = listFiles(patterns, options);
                const unignoredFilename = getFixturePath("glob-util", "node_modules", "dependency.js");

                assert.includeDeepMembers(result, [{ filename: unignoredFilename, ignored: false }]);
            });
        });
    });

    describe("Moved from tests/lib/config.js", () => {
        let fixtureDir;
        let sandbox;

        const DIRECTORY_CONFIG_HIERARCHY = require("../../fixtures/config-hierarchy/file-structure.json");

        /**
         * Returns the path inside of the fixture directory.
         * @returns {string} The path inside the fixture directory.
         * @private
         */
        function getFixturePath(...args) {
            return path.join(fixtureDir, "config-hierarchy", ...args);
        }

        /**
         * Mocks the current CWD path
         * @param {string} fakeCWDPath - fake CWD path
         * @returns {void}
         * @private
         */
        function mockCWDResponse(fakeCWDPath) {
            sandbox.stub(process, "cwd")
                .returns(fakeCWDPath);
        }

        /**
         * Mocks the current user's home path
         * @param {string} fakeUserHomePath - fake user's home path
         * @returns {void}
         * @private
         */
        function mockOsHomedir(fakeUserHomePath) {
            sandbox.stub(os, "homedir")
                .returns(fakeUserHomePath);
        }

        /**
         * Asserts that two configs are equal. This is necessary because assert.deepStrictEqual()
         * gets confused when properties are in different orders.
         * @param {Object} actual The config object to check.
         * @param {Object} expected What the config object should look like.
         * @returns {void}
         * @private
         */
        function assertConfigsEqual(actual, expected) {
            const defaults = new ExtractedConfig().toCompatibleObjectAsConfigFileContent();

            assert.deepStrictEqual(actual, { ...defaults, ...expected });
        }

        /**
         * Wait for the next tick.
         * @returns {Promise<void>} -
         */
        function nextTick() {
            return new Promise(resolve => process.nextTick(resolve));
        }

        /**
         * Get the config data for a file.
         * @param {FileEnumerator} enumerator The enumerator to get config.
         * @param {string} filePath The path to a source code.
         * @returns {Object} The gotten config.
         */
        function getConfig(enumerator, filePath = "a.js") {
            const { cwd } = enumerator;
            const absolutePath = path.resolve(cwd, filePath);

            return enumerator
                .getConfigArrayForFile(absolutePath)
                .extractConfig(absolutePath)
                .toCompatibleObjectAsConfigFileContent();
        }

        // copy into clean area so as not to get "infected" by this project's .eslintrc files
        before(() => {
            fixtureDir = `${os.tmpdir()}/eslint/fixtures`;
            sh.mkdir("-p", fixtureDir);
            sh.cp("-r", "./tests/fixtures/config-hierarchy", fixtureDir);
        });

        beforeEach(() => {
            sandbox = sinon.sandbox.create();
        });

        afterEach(() => {
            sandbox.verifyAndRestore();
        });

        after(() => {
            sh.rm("-r", fixtureDir);
        });

        describe("new Config()", () => {

            // https://github.com/eslint/eslint/issues/2380
            it("should not modify baseConfig when format is specified", () => {
                const customBaseConfig = { foo: "bar" };

                new FileEnumerator({ baseConfig: customBaseConfig, format: "foo" }); // eslint-disable-line no-new

                assert.deepStrictEqual(customBaseConfig, { foo: "bar" });
            });

            it("should create config object when using baseConfig with extends", () => {
                const customBaseConfig = {
                    extends: path.resolve(__dirname, "../../fixtures/config-extends/array/.eslintrc")
                };
                const enumerator = new FileEnumerator({ baseConfig: customBaseConfig, useEslintrc: false });
                const config = getConfig(enumerator);

                assert.deepStrictEqual(config.env, {
                    browser: false,
                    es6: true,
                    node: true
                });
                assert.deepStrictEqual(config.rules, {
                    "no-empty": [1],
                    "comma-dangle": [2],
                    "no-console": [2]
                });
            });
        });

        describe("getConfig()", () => {
            it("should return the project config when called in current working directory", () => {
                const enumerator = new FileEnumerator();
                const actual = getConfig(enumerator);

                assert.strictEqual(actual.rules.strict[1], "global");
            });

            it("should not retain configs from previous directories when called multiple times", () => {
                const firstpath = path.resolve(__dirname, "../../fixtures/configurations/single-quotes/subdir/.eslintrc");
                const secondpath = path.resolve(__dirname, "../../fixtures/configurations/single-quotes/.eslintrc");
                const enumerator = new FileEnumerator();
                let config;

                config = getConfig(enumerator, firstpath);
                assert.deepStrictEqual(config.rules["no-new"], [0]);
                config = getConfig(enumerator, secondpath);
                assert.deepStrictEqual(config.rules["no-new"], [1]);
            });

            it("should throw error when a configuration file doesn't exist", () => {
                const configPath = path.resolve(__dirname, "../../fixtures/configurations/.eslintrc");
                const enumerator = new FileEnumerator();

                sandbox.stub(fs, "readFileSync").throws(new Error());

                assert.throws(() => {
                    getConfig(enumerator, configPath);
                }, "Cannot read config file");

            });

            it("should throw error when a configuration file is not require-able", () => {
                const configPath = ".eslintrc";
                const enumerator = new FileEnumerator();

                sandbox.stub(fs, "readFileSync").throws(new Error());

                assert.throws(() => {
                    getConfig(enumerator, configPath);
                }, "Cannot read config file");

            });

            it("should cache config when the same directory is passed twice", () => {
                const configPath = path.resolve(__dirname, "../../fixtures/configurations/single-quotes/.eslintrc");
                const configArrayFactory = new ConfigArrayFactory();
                const enumerator = new FileEnumerator({ configArrayFactory });

                sandbox.spy(configArrayFactory, "loadOnDirectory");

                // If cached this should be called only once
                getConfig(enumerator, configPath);
                const callcount = configArrayFactory.loadOnDirectory.callcount;

                getConfig(enumerator, configPath);

                assert.strictEqual(configArrayFactory.loadOnDirectory.callcount, callcount);
            });

            // make sure JS-style comments don't throw an error
            it("should load the config file when there are JS-style comments in the text", () => {
                const specificConfigPath = path.resolve(__dirname, "../../fixtures/configurations/comments.json");
                const enumerator = new FileEnumerator({ specificConfigPath, useEslintrc: false });
                const config = getConfig(enumerator);
                const { semi, strict } = config.rules;

                assert.deepStrictEqual(semi, [1]);
                assert.deepStrictEqual(strict, [0]);
            });

            // make sure YAML files work correctly
            it("should load the config file when a YAML file is used", () => {
                const specificConfigPath = path.resolve(__dirname, "../../fixtures/configurations/env-browser.yaml");
                const enumerator = new FileEnumerator({ specificConfigPath, useEslintrc: false });
                const config = getConfig(enumerator);
                const { "no-alert": noAlert, "no-undef": noUndef } = config.rules;

                assert.deepStrictEqual(noAlert, [0]);
                assert.deepStrictEqual(noUndef, [2]);
            });

            it("should contain the correct value for parser when a custom parser is specified", () => {
                const configPath = path.resolve(__dirname, "../../fixtures/configurations/parser/.eslintrc.json");
                const enumerator = new FileEnumerator();
                const config = getConfig(enumerator, configPath);

                assert.strictEqual(config.parser, path.resolve(path.dirname(configPath), "./custom.js"));
            });

            /*
             * Configuration hierarchy ---------------------------------------------
             * https://github.com/eslint/eslint/issues/3915
             */
            it("should correctly merge environment settings", () => {
                const enumerator = new FileEnumerator({ useEslintrc: true });
                const file = getFixturePath("envs", "sub", "foo.js");
                const expected = {
                    rules: {},
                    env: {
                        browser: true,
                        node: false
                    }
                };
                const actual = getConfig(enumerator, file);

                assertConfigsEqual(actual, expected);
            });

            // Default configuration - blank
            it("should return a blank config when using no .eslintrc", () => {
                const enumerator = new FileEnumerator({ useEslintrc: false });
                const file = getFixturePath("broken", "console-wrong-quotes.js");
                const expected = {
                    rules: {},
                    globals: {},
                    env: {}
                };
                const actual = getConfig(enumerator, file);

                assertConfigsEqual(actual, expected);
            });

            it("should return a blank config when baseConfig is set to false and no .eslintrc", () => {
                const enumerator = new FileEnumerator({ baseConfig: false, useEslintrc: false });
                const file = getFixturePath("broken", "console-wrong-quotes.js");
                const expected = {
                    rules: {},
                    globals: {},
                    env: {}
                };
                const actual = getConfig(enumerator, file);

                assertConfigsEqual(actual, expected);
            });

            // No default configuration
            it("should return an empty config when not using .eslintrc", () => {
                const enumerator = new FileEnumerator({ useEslintrc: false });
                const file = getFixturePath("broken", "console-wrong-quotes.js");
                const actual = getConfig(enumerator, file);

                assertConfigsEqual(actual, {});
            });

            it("should return a modified config when baseConfig is set to an object and no .eslintrc", () => {
                const enumerator = new FileEnumerator({
                    baseConfig: {
                        env: {
                            node: true
                        },
                        rules: {
                            quotes: [2, "single"]
                        }
                    },
                    useEslintrc: false
                });
                const file = getFixturePath("broken", "console-wrong-quotes.js");
                const expected = {
                    env: {
                        node: true
                    },
                    rules: {
                        quotes: [2, "single"]
                    }
                };
                const actual = getConfig(enumerator, file);

                assertConfigsEqual(actual, expected);
            });

            it("should return a modified config without plugin rules enabled when baseConfig is set to an object with plugin and no .eslintrc", () => {
                const customRule = require("../../fixtures/rules/custom-rule");
                const examplePluginName = "eslint-plugin-example";
                const enumerator = createStubbedFileEnumerator(
                    {
                        baseConfig: {
                            env: {
                                node: true
                            },
                            rules: {
                                quotes: [2, "single"]
                            },
                            plugins: [examplePluginName]
                        },
                        useEslintrc: false
                    },
                    {
                        [examplePluginName]: {
                            rules: { "example-rule": customRule },

                            // rulesConfig support removed in 2.0.0, so this should have no effect
                            rulesConfig: { "example-rule": 1 }
                        }
                    }
                );
                const file = getFixturePath("broken", "plugins", "console-wrong-quotes.js");
                const expected = {
                    env: {
                        node: true
                    },
                    plugins: ["example"],
                    rules: {
                        quotes: [2, "single"]
                    }
                };
                const actual = getConfig(enumerator, file);

                assertConfigsEqual(actual, expected);
            });

            // Project configuration - second level .eslintrc
            it("should merge configs when local .eslintrc overrides parent .eslintrc", () => {
                const enumerator = new FileEnumerator();
                const file = getFixturePath("broken", "subbroken", "console-wrong-quotes.js");
                const expected = {
                    env: {
                        node: true
                    },
                    rules: {
                        "no-console": [1],
                        quotes: [2, "single"]
                    }
                };
                const actual = getConfig(enumerator, file);

                assertConfigsEqual(actual, expected);
            });

            // Project configuration - third level .eslintrc
            it("should merge configs when local .eslintrc overrides parent and grandparent .eslintrc", () => {
                const enumerator = new FileEnumerator();
                const file = getFixturePath("broken", "subbroken", "subsubbroken", "console-wrong-quotes.js");
                const expected = {
                    env: {
                        node: true
                    },
                    rules: {
                        "no-console": [0],
                        quotes: [1, "double"]
                    }
                };
                const actual = getConfig(enumerator, file);

                assertConfigsEqual(actual, expected);
            });

            // Project configuration - root set in second level .eslintrc
            it("should not return or traverse configurations in parents of config with root:true", () => {
                const enumerator = new FileEnumerator();
                const file = getFixturePath("root-true", "parent", "root", "wrong-semi.js");
                const expected = {
                    rules: {
                        semi: [2, "never"]
                    }
                };
                const actual = getConfig(enumerator, file);

                assertConfigsEqual(actual, expected);
            });

            // Project configuration - root set in second level .eslintrc
            it("should return project config when called with a relative path from a subdir", () => {
                const enumerator = new FileEnumerator({ cwd: getFixturePath("root-true", "parent", "root", "subdir") });
                const dir = ".";
                const expected = {
                    rules: {
                        semi: [2, "never"]
                    }
                };
                const actual = getConfig(enumerator, dir);

                assertConfigsEqual(actual, expected);
            });

            // Command line configuration - --config with first level .eslintrc
            it("should merge command line config when config file adds to local .eslintrc", () => {
                const enumerator = new FileEnumerator({
                    specificConfigPath: getFixturePath("broken", "add-conf.yaml")
                });
                const file = getFixturePath("broken", "console-wrong-quotes.js");
                const expected = {
                    env: {
                        node: true
                    },
                    rules: {
                        quotes: [2, "double"],
                        semi: [1, "never"]
                    }
                };
                const actual = getConfig(enumerator, file);

                assertConfigsEqual(actual, expected);
            });

            // Command line configuration - --config with first level .eslintrc
            it("should merge command line config when config file overrides local .eslintrc", () => {
                const enumerator = new FileEnumerator({
                    specificConfigPath: getFixturePath("broken", "override-conf.yaml")
                });
                const file = getFixturePath("broken", "console-wrong-quotes.js");
                const expected = {
                    env: {
                        node: true
                    },
                    rules: {
                        quotes: [0, "double"]
                    }
                };
                const actual = getConfig(enumerator, file);

                assertConfigsEqual(actual, expected);
            });

            // Command line configuration - --config with second level .eslintrc
            it("should merge command line config when config file adds to local and parent .eslintrc", () => {
                const enumerator = new FileEnumerator({
                    specificConfigPath: getFixturePath("broken", "add-conf.yaml")
                });
                const file = getFixturePath("broken", "subbroken", "console-wrong-quotes.js");
                const expected = {
                    env: {
                        node: true
                    },
                    rules: {
                        quotes: [2, "single"],
                        "no-console": [1],
                        semi: [1, "never"]
                    }
                };
                const actual = getConfig(enumerator, file);

                assertConfigsEqual(actual, expected);
            });

            // Command line configuration - --config with second level .eslintrc
            it("should merge command line config when config file overrides local and parent .eslintrc", () => {
                const enumerator = new FileEnumerator({
                    specificConfigPath: getFixturePath("broken", "override-conf.yaml")
                });
                const file = getFixturePath("broken", "subbroken", "console-wrong-quotes.js");
                const expected = {
                    env: {
                        node: true
                    },
                    rules: {
                        quotes: [0, "single"],
                        "no-console": [1]
                    }
                };
                const actual = getConfig(enumerator, file);

                assertConfigsEqual(actual, expected);
            });

            // Command line configuration - --rule with --config and first level .eslintrc
            it("should merge command line config and rule when rule and config file overrides local .eslintrc", () => {
                const enumerator = new FileEnumerator({
                    cliConfig: {
                        rules: {
                            quotes: [1, "double"]
                        }
                    },
                    specificConfigPath: getFixturePath("broken", "override-conf.yaml")
                });
                const file = getFixturePath("broken", "console-wrong-quotes.js");
                const expected = {
                    env: {
                        node: true
                    },
                    rules: {
                        quotes: [1, "double"]
                    }
                };
                const actual = getConfig(enumerator, file);

                assertConfigsEqual(actual, expected);
            });

            // Command line configuration - --plugin
            it("should merge command line plugin with local .eslintrc", () => {
                const enumerator = createStubbedFileEnumerator(
                    {
                        cliConfig: {
                            plugins: ["another-plugin"]
                        }
                    },
                    {
                        "eslint-plugin-example": {},
                        "eslint-plugin-another-plugin": {}
                    }
                );
                const file = getFixturePath("broken", "plugins", "console-wrong-quotes.js");
                const expected = {
                    env: {
                        node: true
                    },
                    plugins: [
                        "example",
                        "another-plugin"
                    ],
                    rules: {
                        quotes: [2, "double"]
                    }
                };
                const actual = getConfig(enumerator, file);

                assertConfigsEqual(actual, expected);
            });


            it("should merge multiple different config file formats", () => {
                const enumerator = new FileEnumerator();
                const file = getFixturePath("fileexts/subdir/subsubdir/foo.js");
                const expected = {
                    env: {
                        browser: true
                    },
                    rules: {
                        semi: [2, "always"],
                        eqeqeq: [2]
                    }
                };
                const actual = getConfig(enumerator, file);

                assertConfigsEqual(actual, expected);
            });


            it("should load user config globals", () => {
                const configPath = path.resolve(__dirname, "../../fixtures/globals/conf.yaml");
                const enumerator = new FileEnumerator({ specificConfigPath: configPath, useEslintrc: false });
                const expected = {
                    globals: {
                        foo: true
                    }
                };
                const actual = getConfig(enumerator, configPath);

                assertConfigsEqual(actual, expected);
            });

            it("should not load disabled environments", () => {
                const configPath = path.resolve(__dirname, "../../fixtures/environments/disable.yaml");
                const enumerator = new FileEnumerator({ specificConfigPath: configPath, useEslintrc: false });
                const config = getConfig(enumerator, configPath);

                assert.isUndefined(config.globals.window);
            });

            it("should gracefully handle empty files", () => {
                const configPath = path.resolve(__dirname, "../../fixtures/configurations/env-node.json");
                const enumerator = new FileEnumerator({ specificConfigPath: configPath });

                getConfig(enumerator, path.resolve(__dirname, "../../fixtures/configurations/empty/empty.json"));
            });

            // Meaningful stack-traces
            it("should include references to where an `extends` configuration was loaded from", () => {
                const configPath = path.resolve(__dirname, "../../fixtures/config-extends/error.json");

                assert.throws(() => {
                    const enumerator = new FileEnumerator({ useEslintrc: false, specificConfigPath: configPath });

                    getConfig(enumerator, configPath);
                }, /Referenced from:.*?error\.json/u);
            });

            // Keep order with the last array element taking highest precedence
            it("should make the last element in an array take the highest precedence", () => {
                const configPath = path.resolve(__dirname, "../../fixtures/config-extends/array/.eslintrc");
                const enumerator = new FileEnumerator({ useEslintrc: false, specificConfigPath: configPath });
                const expected = {
                    rules: { "no-empty": [1], "comma-dangle": [2], "no-console": [2] },
                    env: { browser: false, node: true, es6: true }
                };
                const actual = getConfig(enumerator, configPath);

                assertConfigsEqual(actual, expected);
            });

            describe("with env in a child configuration file", () => {
                it("should not overwrite parserOptions of the parent with env of the child", () => {
                    const enumerator = new FileEnumerator();
                    const targetPath = getFixturePath("overwrite-ecmaFeatures", "child", "foo.js");
                    const expected = {
                        rules: {},
                        env: { commonjs: true },
                        parserOptions: { ecmaFeatures: { globalReturn: false } }
                    };
                    const actual = getConfig(enumerator, targetPath);

                    assertConfigsEqual(actual, expected);
                });
            });

            describe("personal config file within home directory", () => {

                /**
                 * Returns the path inside of the fixture directory.
                 * @returns {string} The path inside the fixture directory.
                 * @private
                 */
                function getFakeFixturePath(...args) {
                    return path.join(process.cwd(), "eslint", "fixtures", "config-hierarchy", ...args);
                }

                /**
                 * Mocks the file system for personal-config files
                 * @returns {undefined}
                 * @private
                 */
                function mockPersonalConfigFileSystem() {
                    mockFs({
                        eslint: {
                            fixtures: {
                                "config-hierarchy": DIRECTORY_CONFIG_HIERARCHY
                            }
                        }
                    });
                }

                afterEach(() => {
                    mockFs.restore();
                });

                it("should load the personal config if no local config was found", () => {
                    const projectPath = getFakeFixturePath("personal-config", "project-without-config");
                    const homePath = getFakeFixturePath("personal-config", "home-folder");
                    const filePath = getFakeFixturePath("personal-config", "project-without-config", "foo.js");

                    mockOsHomedir(homePath);
                    mockPersonalConfigFileSystem();
                    mockCWDResponse(projectPath);

                    const enumerator = new FileEnumerator();
                    const actual = getConfig(enumerator, filePath);
                    const expected = {
                        rules: {
                            "home-folder-rule": [2]
                        }
                    };

                    assertConfigsEqual(actual, expected);
                });

                it("should ignore the personal config if a local config was found", () => {
                    const projectPath = getFakeFixturePath("personal-config", "home-folder", "project");
                    const homePath = getFakeFixturePath("personal-config", "home-folder");
                    const filePath = getFakeFixturePath("personal-config", "home-folder", "project", "foo.js");

                    mockOsHomedir(homePath);
                    mockPersonalConfigFileSystem();
                    mockCWDResponse(projectPath);

                    const enumerator = new FileEnumerator();
                    const actual = getConfig(enumerator, filePath);
                    const expected = {
                        rules: {
                            "project-level-rule": [2]
                        }
                    };

                    assertConfigsEqual(actual, expected);
                });

                it("should ignore the personal config if config is passed through cli", () => {
                    const configPath = getFakeFixturePath("quotes-error.json");
                    const projectPath = getFakeFixturePath("personal-config", "project-without-config");
                    const homePath = getFakeFixturePath("personal-config", "home-folder");
                    const filePath = getFakeFixturePath("personal-config", "project-without-config", "foo.js");

                    mockOsHomedir(homePath);
                    mockPersonalConfigFileSystem();
                    mockCWDResponse(projectPath);

                    const enumerator = new FileEnumerator({ specificConfigPath: configPath });
                    const actual = getConfig(enumerator, filePath);
                    const expected = {
                        rules: {
                            quotes: [2, "double"]
                        }
                    };

                    assertConfigsEqual(actual, expected);
                });

                it("should still load the project config if the current working directory is the same as the home folder", () => {
                    const projectPath = getFakeFixturePath("personal-config", "project-with-config");
                    const filePath = getFakeFixturePath("personal-config", "project-with-config", "subfolder", "foo.js");

                    mockOsHomedir(projectPath);
                    mockPersonalConfigFileSystem();
                    mockCWDResponse(projectPath);

                    const enumerator = new FileEnumerator();
                    const actual = getConfig(enumerator, filePath);
                    const expected = {
                        rules: {
                            "project-level-rule": [2],
                            "subfolder-level-rule": [2]
                        }
                    };

                    assertConfigsEqual(actual, expected);
                });
            });

            describe("when no local or personal config is found", () => {

                /**
                 * Returns the path inside of the fixture directory.
                 * @returns {string} The path inside the fixture directory.
                 * @private
                 */
                function getFakeFixturePath(...args) {
                    return path.join(process.cwd(), "eslint", "fixtures", "config-hierarchy", ...args);
                }

                /**
                 * Mocks the file system for personal-config files
                 * @returns {undefined}
                 * @private
                 */
                function mockPersonalConfigFileSystem() {
                    mockFs({
                        eslint: {
                            fixtures: {
                                "config-hierarchy": DIRECTORY_CONFIG_HIERARCHY
                            }
                        }
                    });
                }

                afterEach(() => {
                    mockFs.restore();
                });

                it("should throw an error if no local config and no personal config was found", () => {
                    const projectPath = getFakeFixturePath("personal-config", "project-without-config");
                    const homePath = getFakeFixturePath("personal-config", "folder-does-not-exist");
                    const filePath = getFakeFixturePath("personal-config", "project-without-config", "foo.js");

                    mockOsHomedir(homePath);
                    mockPersonalConfigFileSystem();
                    mockCWDResponse(projectPath);

                    const enumerator = new FileEnumerator();

                    assert.throws(() => {
                        getConfig(enumerator, filePath);
                    }, "No ESLint configuration found");
                });

                it("should throw an error if no local config was found and ~/package.json contains no eslintConfig section", () => {
                    const projectPath = getFakeFixturePath("personal-config", "project-without-config");
                    const homePath = getFakeFixturePath("personal-config", "home-folder-with-packagejson");
                    const filePath = getFakeFixturePath("personal-config", "project-without-config", "foo.js");

                    mockOsHomedir(homePath);
                    mockPersonalConfigFileSystem();
                    mockCWDResponse(projectPath);

                    const enumerator = new FileEnumerator();

                    assert.throws(() => {
                        getConfig(enumerator, filePath);
                    }, "No ESLint configuration found");
                });

                it("should not throw an error if no local config and no personal config was found but useEslintrc is false", () => {
                    const projectPath = getFakeFixturePath("personal-config", "project-without-config");
                    const homePath = getFakeFixturePath("personal-config", "folder-does-not-exist");
                    const filePath = getFakeFixturePath("personal-config", "project-without-config", "foo.js");

                    mockOsHomedir(homePath);
                    mockPersonalConfigFileSystem();
                    mockCWDResponse(projectPath);

                    const enumerator = new FileEnumerator({ useEslintrc: false });

                    getConfig(enumerator, filePath);
                });

                it("should not throw an error if no local config and no personal config was found but rules are specified", () => {
                    const projectPath = getFakeFixturePath("personal-config", "project-without-config");
                    const homePath = getFakeFixturePath("personal-config", "folder-does-not-exist");
                    const filePath = getFakeFixturePath("personal-config", "project-without-config", "foo.js");

                    mockOsHomedir(homePath);
                    mockPersonalConfigFileSystem();
                    mockCWDResponse(projectPath);

                    const enumerator = new FileEnumerator({
                        cliConfig: {
                            rules: { quotes: [2, "single"] }
                        }
                    });

                    getConfig(enumerator, filePath);
                });

                it("should not throw an error if no local config and no personal config was found but baseConfig is specified", () => {
                    const projectPath = getFakeFixturePath("personal-config", "project-without-config");
                    const homePath = getFakeFixturePath("personal-config", "folder-does-not-exist");
                    const filePath = getFakeFixturePath("personal-config", "project-without-config", "foo.js");

                    mockOsHomedir(homePath);
                    mockPersonalConfigFileSystem();
                    mockCWDResponse(projectPath);

                    const enumerator = new FileEnumerator({ baseConfig: {} });

                    getConfig(enumerator, filePath);
                });
            });

            describe("with overrides", () => {

                /**
                 * Returns the path inside of the fixture directory.
                 * @param {...string} pathSegments One or more path segments, in order of depth, shallowest first
                 * @returns {string} The path inside the fixture directory.
                 * @private
                 */
                function getFakeFixturePath(...pathSegments) {
                    return path.join(process.cwd(), "eslint", "fixtures", "config-hierarchy", ...pathSegments);
                }

                beforeEach(() => {
                    mockFs({
                        eslint: {
                            fixtures: {
                                "config-hierarchy": DIRECTORY_CONFIG_HIERARCHY
                            }
                        }
                    });
                });

                afterEach(() => {
                    mockFs.restore();
                });

                it("should merge override config when the pattern matches the file name", () => {
                    const enumerator = new FileEnumerator();
                    const targetPath = getFakeFixturePath("overrides", "foo.js");
                    const expected = {
                        rules: {
                            quotes: [2, "single"],
                            "no-else-return": [0],
                            "no-unused-vars": [1],
                            semi: [1, "never"]
                        }
                    };
                    const actual = getConfig(enumerator, targetPath);

                    assertConfigsEqual(actual, expected);
                });

                it("should merge override config when the pattern matches the file path relative to the config file", () => {
                    const enumerator = new FileEnumerator();
                    const targetPath = getFakeFixturePath("overrides", "child", "child-one.js");
                    const expected = {
                        rules: {
                            curly: ["error", "multi", "consistent"],
                            "no-else-return": [0],
                            "no-unused-vars": [1],
                            quotes: [2, "double"],
                            semi: [1, "never"]
                        }
                    };
                    const actual = getConfig(enumerator, targetPath);

                    assertConfigsEqual(actual, expected);
                });

                it("should not merge override config when the pattern matches the absolute file path", () => {
                    const resolvedPath = path.resolve(__dirname, "../../fixtures/config-hierarchy/overrides/bar.js");

                    assert.throws(() => new FileEnumerator({
                        baseConfig: {
                            overrides: [{
                                files: resolvedPath,
                                rules: {
                                    quotes: [1, "double"]
                                }
                            }]
                        },
                        useEslintrc: false
                    }), /Invalid override pattern/u);
                });

                it("should not merge override config when the pattern traverses up the directory tree", () => {
                    const parentPath = "overrides/../**/*.js";

                    assert.throws(() => new FileEnumerator({
                        baseConfig: {
                            overrides: [{
                                files: parentPath,
                                rules: {
                                    quotes: [1, "single"]
                                }
                            }]
                        },
                        useEslintrc: false
                    }), /Invalid override pattern/u);
                });

                it("should merge all local configs (override and non-override) before non-local configs", () => {
                    const enumerator = new FileEnumerator();
                    const targetPath = getFakeFixturePath("overrides", "two", "child-two.js");
                    const expected = {
                        rules: {
                            "no-console": [0],
                            "no-else-return": [0],
                            "no-unused-vars": [2],
                            quotes: [2, "double"],
                            semi: [2, "never"]
                        }
                    };
                    const actual = getConfig(enumerator, targetPath);

                    assertConfigsEqual(actual, expected);
                });

                it("should apply overrides in parent .eslintrc over non-override rules in child .eslintrc", () => {
                    const targetPath = getFakeFixturePath("overrides", "three", "foo.js");
                    const enumerator = new FileEnumerator({
                        cwd: getFakeFixturePath("overrides"),
                        baseConfig: {
                            overrides: [
                                {
                                    files: "three/**/*.js",
                                    rules: {
                                        "semi-style": [2, "last"]
                                    }
                                }
                            ]
                        },
                        useEslintrc: false
                    });
                    const expected = {
                        rules: {
                            "semi-style": [2, "last"]
                        }
                    };
                    const actual = getConfig(enumerator, targetPath);

                    assertConfigsEqual(actual, expected);
                });

                it("should apply overrides if all glob patterns match", () => {
                    const targetPath = getFakeFixturePath("overrides", "one", "child-one.js");
                    const enumerator = new FileEnumerator({
                        cwd: getFakeFixturePath("overrides"),
                        baseConfig: {
                            overrides: [{
                                files: ["one/**/*", "*.js"],
                                rules: {
                                    quotes: [2, "single"]
                                }
                            }]
                        },
                        useEslintrc: false
                    });
                    const expected = {
                        rules: {
                            quotes: [2, "single"]
                        }
                    };
                    const actual = getConfig(enumerator, targetPath);

                    assertConfigsEqual(actual, expected);
                });

                it("should apply overrides even if some glob patterns do not match", () => {
                    const targetPath = getFakeFixturePath("overrides", "one", "child-one.js");
                    const enumerator = new FileEnumerator({
                        cwd: getFakeFixturePath("overrides"),
                        baseConfig: {
                            overrides: [{
                                files: ["one/**/*", "*two.js"],
                                rules: {
                                    quotes: [2, "single"]
                                }
                            }]
                        },
                        useEslintrc: false
                    });
                    const expected = {
                        rules: {
                            quotes: [2, "single"]
                        }
                    };
                    const actual = getConfig(enumerator, targetPath);

                    assertConfigsEqual(actual, expected);
                });

                it("should not apply overrides if any excluded glob patterns match", () => {
                    const targetPath = getFakeFixturePath("overrides", "one", "child-one.js");
                    const enumerator = new FileEnumerator({
                        cwd: getFakeFixturePath("overrides"),
                        baseConfig: {
                            overrides: [{
                                files: "one/**/*",
                                excludedFiles: ["two/**/*", "*one.js"],
                                rules: {
                                    quotes: [2, "single"]
                                }
                            }]
                        },
                        useEslintrc: false
                    });
                    const expected = {
                        rules: {}
                    };
                    const actual = getConfig(enumerator, targetPath);

                    assertConfigsEqual(actual, expected);
                });

                it("should apply overrides if all excluded glob patterns fail to match", () => {
                    const targetPath = getFakeFixturePath("overrides", "one", "child-one.js");
                    const enumerator = new FileEnumerator({
                        cwd: getFakeFixturePath("overrides"),
                        baseConfig: {
                            overrides: [{
                                files: "one/**/*",
                                excludedFiles: ["two/**/*", "*two.js"],
                                rules: {
                                    quotes: [2, "single"]
                                }
                            }]
                        },
                        useEslintrc: false
                    });
                    const expected = {
                        rules: {
                            quotes: [2, "single"]
                        }
                    };
                    const actual = getConfig(enumerator, targetPath);

                    assertConfigsEqual(actual, expected);
                });

                it("should cascade", () => {
                    const targetPath = getFakeFixturePath("overrides", "foo.js");
                    const enumerator = new FileEnumerator({
                        cwd: getFakeFixturePath("overrides"),
                        baseConfig: {
                            overrides: [
                                {
                                    files: "foo.js",
                                    rules: {
                                        semi: [2, "never"],
                                        quotes: [2, "single"]
                                    }
                                },
                                {
                                    files: "foo.js",
                                    rules: {
                                        semi: [2, "never"],
                                        quotes: [2, "double"]
                                    }
                                }
                            ]
                        },
                        useEslintrc: false
                    });
                    const expected = {
                        rules: {
                            semi: [2, "never"],
                            quotes: [2, "double"]
                        }
                    };
                    const actual = getConfig(enumerator, targetPath);

                    assertConfigsEqual(actual, expected);
                });
            });

            describe("deprecation warnings", () => {
                let warning = null;

                function onWarning(w) { // eslint-disable-line require-jsdoc

                    // Node.js 6.x does not have 'w.code' property.
                    if (!Object.prototype.hasOwnProperty.call(w, "code") || typeof w.code === "string" && w.code.startsWith("ESLINT_")) {
                        warning = w;
                    }
                }

                beforeEach(() => {
                    warning = null;
                    process.on("warning", onWarning);
                });
                afterEach(() => {
                    process.removeListener("warning", onWarning);
                });

                it("should emit a deprecation warning if 'ecmaFeatures' is given.", async() => {
                    const cwd = path.resolve(__dirname, "../../fixtures/config-file/ecma-features/");
                    const enumerator = new FileEnumerator({ cwd });

                    getConfig(enumerator, "test.js");

                    // Wait for "warning" event.
                    await nextTick();

                    assert.notStrictEqual(warning, null);
                    assert.strictEqual(
                        warning.message,
                        `The 'ecmaFeatures' config file property is deprecated, and has no effect. (found in "tests${path.sep}fixtures${path.sep}config-file${path.sep}ecma-features${path.sep}.eslintrc.yml")`
                    );
                });

                it("should emit a deprecation warning if 'parserOptions.ecmaFeatures.experimentalObjectRestSpread' is given.", async() => {
                    const cwd = path.resolve(__dirname, "../../fixtures/config-file/experimental-object-rest-spread/basic/");
                    const enumerator = new FileEnumerator({ cwd });

                    getConfig(enumerator, "test.js");

                    // Wait for "warning" event.
                    await nextTick();

                    assert.notStrictEqual(warning, null);
                    assert.strictEqual(
                        warning.message,
                        `The 'parserOptions.ecmaFeatures.experimentalObjectRestSpread' option is deprecated. Use 'parserOptions.ecmaVersion' instead. (found in "tests${path.sep}fixtures${path.sep}config-file${path.sep}experimental-object-rest-spread${path.sep}basic${path.sep}.eslintrc.yml")`
                    );
                });

                it("should emit a deprecation warning if 'parserOptions.ecmaFeatures.experimentalObjectRestSpread' is given in a parent config.", async() => {
                    const cwd = path.resolve(__dirname, "../../fixtures/config-file/experimental-object-rest-spread/subdir/");
                    const enumerator = new FileEnumerator({ cwd });

                    getConfig(enumerator, "lib/test.js");

                    // Wait for "warning" event.
                    await nextTick();

                    assert.notStrictEqual(warning, null);
                    assert.strictEqual(
                        warning.message,
                        `The 'parserOptions.ecmaFeatures.experimentalObjectRestSpread' option is deprecated. Use 'parserOptions.ecmaVersion' instead. (found in "tests${path.sep}fixtures${path.sep}config-file${path.sep}experimental-object-rest-spread${path.sep}subdir${path.sep}.eslintrc.yml")`
                    );
                });

                it("should emit a deprecation warning if 'parserOptions.ecmaFeatures.experimentalObjectRestSpread' is given in a shareable config.", async() => {
                    const cwd = path.resolve(__dirname, "../../fixtures/config-file/experimental-object-rest-spread/extends/");
                    const enumerator = new FileEnumerator({ cwd });

                    getConfig(enumerator, "test.js");

                    // Wait for "warning" event.
                    await nextTick();

                    assert.notStrictEqual(warning, null);
                    assert.strictEqual(
                        warning.message,
                        `The 'parserOptions.ecmaFeatures.experimentalObjectRestSpread' option is deprecated. Use 'parserOptions.ecmaVersion' instead. (found in "tests${path.sep}fixtures${path.sep}config-file${path.sep}experimental-object-rest-spread${path.sep}extends${path.sep}common.yml")`
                    );
                });

                it("should NOT emit a deprecation warning even if 'parserOptions.ecmaFeatures.experimentalObjectRestSpread' is given, if parser is not espree.", async() => {
                    const cwd = path.resolve(__dirname, "../../fixtures/config-file/experimental-object-rest-spread/another-parser/");
                    const enumerator = new FileEnumerator({ cwd });

                    getConfig(enumerator, "test.js");

                    // Wait for "warning" event.
                    await nextTick();

                    assert.strictEqual(warning, null);
                });
            });
        });
    });
});
