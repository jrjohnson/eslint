/**
 * @fileoverview Tests for ConfigArrayFactory class.
 * @author Toru Nagashima <https://github.com/mysticatea>
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { assert } = require("chai");
const importFresh = require("import-fresh");
const leche = require("leche");
const shell = require("shelljs");
const { ConfigArrayFactory } = require("../../../lib/lookup/config-array-factory");
const { ModuleResolver } = require("../../../lib/lookup/module-resolver");

const proxyquire = require("proxyquire").noCallThru().noPreserveCache();
const temp = require("temp").track();

/**
 * Creates a module resolver that always resolves the given mappings.
 * @param {Object<string, string|Object>} mapping A mapping of modules. The mapped value is a string, it resolves the module name to the path. Otherwise, it resolves the module name as is, and stubs the module.
 * @returns {ConfigArrayFactory} The stubbed ConfigArrayFactory class.
 * @private
 */
function createStubbedConfigArrayFactory(mapping) {
    const stubs = {
        "./module-resolver": {
            ModuleResolver: {
                resolve(request, relativeTo) {
                    if (mapping.hasOwnProperty(request)) { // eslint-disable-line no-prototype-builtins
                        if (typeof mapping[request] === "string") {
                            return mapping[request];
                        }
                        if (mapping[request] instanceof Error) {
                            throw mapping[request];
                        }
                        return request;
                    }
                    return ModuleResolver.resolve(request, relativeTo);
                }
            }
        },
        "import-fresh"(request) {
            return stubs[request] || importFresh(request);
        }
    };

    for (const [id, value] of Object.entries(mapping)) {
        if (typeof value === "object") {
            stubs[id] = value;
        }
    }

    const { ConfigArrayFactory: StubbedConfigArrayFactory } = proxyquire(
        "../../../lib/lookup/config-array-factory",
        stubs
    );

    return new StubbedConfigArrayFactory();
}

describe("ConfigArrayFactory", () => {

    describe("Moved from tests/lib/config/config-file.js", () => {

        /*
         * Project path is the project that is including ESLint as a dependency. In the
         * case of these tests, it will end up the parent of the "eslint" folder. That's
         * fine for the purposes of testing because the tests are just relative to an
         * ancestor location.
         */
        const PROJECT_PATH = path.resolve(__dirname, "../../../../");

        /**
         * Helper function get easily get a path in the fixtures directory.
         * @param {string} filepath The path to find in the fixtures directory.
         * @returns {string} Full path in the fixtures directory.
         * @private
         */
        function getFixturePath(filepath) {
            return path.resolve(__dirname, "../../fixtures/config-file", filepath);
        }

        /**
         * Helper function to write configs to temp file.
         * @param {Object} config Config to write out to temp file.
         * @param {string} filename Name of file to write in temp dir.
         * @param {string} existingTmpDir Optional dir path if temp file exists.
         * @returns {string} Full path to the temp file.
         * @private
         */
        function writeTempConfigFile(config, filename, existingTmpDir) {
            const tmpFileDir = existingTmpDir || temp.mkdirSync("eslint-tests-"),
                tmpFilePath = path.join(tmpFileDir, filename),
                tmpFileContents = JSON.stringify(config);

            fs.writeFileSync(tmpFilePath, tmpFileContents);
            return tmpFilePath;
        }

        /**
         * Helper function to write JS configs to temp file.
         * @param {Object} config Config to write out to temp file.
         * @param {string} filename Name of file to write in temp dir.
         * @param {string} existingTmpDir Optional dir path if temp file exists.
         * @returns {string} Full path to the temp file.
         * @private
         */
        function writeTempJsConfigFile(config, filename, existingTmpDir) {
            const tmpFileDir = existingTmpDir || temp.mkdirSync("eslint-tests-"),
                tmpFilePath = path.join(tmpFileDir, filename),
                tmpFileContents = `module.exports = ${JSON.stringify(config)}`;

            fs.writeFileSync(tmpFilePath, tmpFileContents);
            return tmpFilePath;
        }

        /**
         * Creates a module path relative to the current working directory.
         * @param {string} moduleName The full module name.
         * @returns {string} A full path for the module local to cwd.
         * @private
         */
        function getProjectModulePath(moduleName) {
            return path.resolve(PROJECT_PATH, "./node_modules", moduleName, "index.js");
        }

        /**
         * Creates a module path relative to the given directory.
         * @param {string} moduleName The full module name.
         * @returns {string} A full path for the module local to the given directory.
         * @private
         */
        function getRelativeModulePath(moduleName) {
            return path.resolve("./node_modules", moduleName, "index.js");
        }

        describe("applyExtends()", () => {

            /**
             * Apply `extends` property.
             * @param {ConfigArrayFactory} factory The factory.
             * @param {Object} configData The config that has `extends` property.
             * @param {string} filePath The path to the config data.
             * @returns {Object} The applied config data.
             */
            function applyExtends(factory, configData, filePath) {
                return factory
                    .create(configData, { filePath })
                    .extractConfig(filePath)
                    .toCompatibleObjectAsConfigFileContent();
            }

            it("should apply extension 'foo' when specified from root directory config", () => {
                const resolvedPath = path.resolve(PROJECT_PATH, "./node_modules/eslint-config-foo/index.js");
                const factory = createStubbedConfigArrayFactory({
                    "eslint-config-foo": resolvedPath,
                    [resolvedPath]: {
                        env: { browser: true }
                    }
                });

                const config = applyExtends(factory, {
                    extends: "foo",
                    rules: { eqeqeq: 2 }
                }, "/whatever");

                assert.deepStrictEqual(config, {
                    parser: null,
                    parserOptions: {},
                    plugins: [],
                    env: { browser: true },
                    globals: {},
                    rules: { eqeqeq: [2] },
                    settings: {}
                });
            });

            it("should apply all rules when extends config includes 'eslint:all'", () => {
                const factory = createStubbedConfigArrayFactory({});
                const config = applyExtends(factory, {
                    extends: "eslint:all"
                }, "/whatever");

                assert.strictEqual(config.rules.eqeqeq[0], "error");
                assert.strictEqual(config.rules.curly[0], "error");
            });

            it("should throw an error when extends config module is not found", () => {
                const factory = createStubbedConfigArrayFactory({});

                assert.throws(() => {
                    applyExtends(factory, {
                        extends: "foo",
                        rules: { eqeqeq: 2 }
                    }, "/whatever");
                }, /Cannot find module 'eslint-config-foo'/u);
            });

            it("should throw an error when an eslint config is not found", () => {
                const factory = createStubbedConfigArrayFactory({});

                assert.throws(() => {
                    applyExtends(factory, {
                        extends: "eslint:foo",
                        rules: { eqeqeq: 2 }
                    }, "/whatever");
                }, /Failed to load config "eslint:foo" to extend from./u);
            });

            it("should throw an error when a parser in a plugin config is not found", () => {
                const resolvedPath = path.resolve(PROJECT_PATH, "./node_modules/eslint-plugin-test/index.js");
                const factory = createStubbedConfigArrayFactory({
                    "eslint-plugin-test": resolvedPath,
                    [resolvedPath]: {
                        configs: {
                            bar: {
                                parser: "babel-eslint"
                            }
                        }
                    }
                });

                assert.throws(() => {
                    applyExtends(factory, {
                        extends: "plugin:test/bar",
                        rules: { eqeqeq: 2 }
                    }, "/whatever");
                }, /Cannot find module 'babel-eslint'/u);
            });

            it("should throw an error when a plugin config is not found", () => {
                const resolvedPath = path.resolve(PROJECT_PATH, "./node_modules/eslint-plugin-test/index.js");
                const factory = createStubbedConfigArrayFactory({
                    "eslint-plugin-test": resolvedPath,
                    [resolvedPath]: {
                        configs: {
                            baz: {}
                        }
                    }
                });

                assert.throws(() => {
                    applyExtends(factory, {
                        extends: "plugin:test/bar",
                        rules: { eqeqeq: 2 }
                    }, "/whatever");
                }, /Failed to load config "plugin:test\/bar" to extend from./u);
            });

            it("should apply extensions recursively when specified from package", () => {
                const resolvedPaths = [
                    path.resolve(PROJECT_PATH, "./node_modules/eslint-config-foo/index.js"),
                    path.resolve(PROJECT_PATH, "./node_modules/eslint-config-bar/index.js")
                ];
                const factory = createStubbedConfigArrayFactory({
                    "eslint-config-foo": resolvedPaths[0],
                    "eslint-config-bar": resolvedPaths[1],
                    [resolvedPaths[0]]: {
                        extends: "bar",
                        env: { browser: true }
                    },
                    [resolvedPaths[1]]: {
                        rules: {
                            bar: 2
                        }
                    }
                });
                const config = applyExtends(factory, {
                    extends: "foo",
                    rules: { eqeqeq: 2 }
                }, "/whatever");

                assert.deepStrictEqual(config, {
                    parser: null,
                    parserOptions: {},
                    plugins: [],
                    env: { browser: true },
                    globals: {},
                    rules: {
                        eqeqeq: [2],
                        bar: [2]
                    },
                    settings: {}
                });
            });

            it("should apply extensions when specified from a JavaScript file", () => {
                const extendsFile = "./.eslintrc.js";
                const filePath = getFixturePath("js/foo.js");
                const factory = createStubbedConfigArrayFactory({});
                const config = applyExtends(factory, {
                    extends: extendsFile,
                    rules: { eqeqeq: 2 }
                }, filePath);

                assert.deepStrictEqual(config, {
                    parser: null,
                    parserOptions: {},
                    plugins: [],
                    env: {},
                    globals: {},
                    rules: {
                        semi: [2, "always"],
                        eqeqeq: [2]
                    },
                    settings: {}
                });
            });

            it("should apply extensions when specified from a YAML file", () => {
                const extendsFile = "./.eslintrc.yaml";
                const filePath = getFixturePath("yaml/foo.js");
                const factory = createStubbedConfigArrayFactory({});
                const config = applyExtends(factory, {
                    extends: extendsFile,
                    rules: { eqeqeq: 2 }
                }, filePath);

                assert.deepStrictEqual(config, {
                    parser: null,
                    parserOptions: {},
                    plugins: [],
                    env: { browser: true },
                    globals: {},
                    rules: {
                        eqeqeq: [2]
                    },
                    settings: {}
                });
            });

            it("should apply extensions when specified from a JSON file", () => {
                const extendsFile = "./.eslintrc.json";
                const filePath = getFixturePath("json/foo.js");
                const factory = createStubbedConfigArrayFactory({});
                const config = applyExtends(factory, {
                    extends: extendsFile,
                    rules: { eqeqeq: 2 }
                }, filePath);

                assert.deepStrictEqual(config, {
                    parser: null,
                    parserOptions: {},
                    plugins: [],
                    env: {},
                    globals: {},
                    rules: {
                        eqeqeq: [2],
                        quotes: [2, "double"]
                    },
                    settings: {}
                });
            });

            it("should apply extensions when specified from a package.json file in a sibling directory", () => {
                const extendsFile = "../package-json/package.json";
                const filePath = getFixturePath("json/foo.js");
                const factory = createStubbedConfigArrayFactory({});
                const config = applyExtends(factory, {
                    extends: extendsFile,
                    rules: { eqeqeq: 2 }
                }, filePath);

                assert.deepStrictEqual(config, {
                    parser: null,
                    parserOptions: {},
                    plugins: [],
                    env: { es6: true },
                    globals: {},
                    rules: {
                        eqeqeq: [2]
                    },
                    settings: {}
                });
            });
        });

        describe("load()", () => {

            /**
             * Load a given config file.
             * @param {ConfigArrayFactory} factory The factory.
             * @param {string} filePath The path to a config file.
             * @returns {Object} The applied config data.
             */
            function load(factory, filePath) {
                return factory
                    .loadFile(filePath)
                    .extractConfig(filePath)
                    .toCompatibleObjectAsConfigFileContent();
            }

            it("should throw error if file doesnt exist", () => {
                const factory = new ConfigArrayFactory();

                assert.throws(() => {
                    load(factory, getFixturePath("legacy/nofile.js"));
                });

                assert.throws(() => {
                    load(factory, getFixturePath("legacy/package.json"));
                });
            });

            it("should load information from a legacy file", () => {
                const factory = new ConfigArrayFactory();
                const configFilePath = getFixturePath("legacy/.eslintrc");
                const config = load(factory, configFilePath);

                assert.deepStrictEqual(config, {
                    parser: null,
                    parserOptions: {},
                    plugins: [],
                    env: {},
                    globals: {},
                    rules: {
                        eqeqeq: [2]
                    },
                    settings: {}
                });
            });

            it("should load information from a JavaScript file", () => {
                const factory = new ConfigArrayFactory();
                const configFilePath = getFixturePath("js/.eslintrc.js");
                const config = load(factory, configFilePath);

                assert.deepStrictEqual(config, {
                    parser: null,
                    parserOptions: {},
                    plugins: [],
                    env: {},
                    globals: {},
                    rules: {
                        semi: [2, "always"]
                    },
                    settings: {}
                });
            });

            it("should throw error when loading invalid JavaScript file", () => {
                const factory = new ConfigArrayFactory();

                assert.throws(() => {
                    load(factory, getFixturePath("js/.eslintrc.broken.js"));
                }, /Cannot read config file/u);
            });

            it("should interpret parser module name when present in a JavaScript file", () => {
                const factory = new ConfigArrayFactory();
                const configFilePath = getFixturePath("js/.eslintrc.parser.js");
                const config = load(factory, configFilePath);

                assert.deepStrictEqual(config, {
                    parser: path.resolve(getFixturePath("js/node_modules/foo/index.js")),
                    parserOptions: {},
                    plugins: [],
                    env: {},
                    globals: {},
                    rules: {
                        semi: [2, "always"]
                    },
                    settings: {}
                });
            });

            it("should interpret parser path when present in a JavaScript file", () => {
                const factory = new ConfigArrayFactory();
                const configFilePath = getFixturePath("js/.eslintrc.parser2.js");
                const config = load(factory, configFilePath);

                assert.deepStrictEqual(config, {
                    parser: path.resolve(getFixturePath("js/not-a-config.js")),
                    parserOptions: {},
                    plugins: [],
                    env: {},
                    globals: {},
                    rules: {
                        semi: [2, "always"]
                    },
                    settings: {}
                });
            });

            it("should interpret parser module name or path when parser is set to default parser in a JavaScript file", () => {
                const factory = new ConfigArrayFactory();
                const configFilePath = getFixturePath("js/.eslintrc.parser3.js");
                const config = load(factory, configFilePath);

                assert.deepStrictEqual(config, {
                    parser: require.resolve("espree"),
                    parserOptions: {},
                    plugins: [],
                    env: {},
                    globals: {},
                    rules: {
                        semi: [2, "always"]
                    },
                    settings: {}
                });
            });

            it("should load information from a JSON file", () => {
                const factory = new ConfigArrayFactory();
                const configFilePath = getFixturePath("json/.eslintrc.json");
                const config = load(factory, configFilePath);

                assert.deepStrictEqual(config, {
                    parser: null,
                    parserOptions: {},
                    plugins: [],
                    env: {},
                    globals: {},
                    rules: {
                        quotes: [2, "double"]
                    },
                    settings: {}
                });
            });

            it("should load fresh information from a JSON file", () => {
                const factory = new ConfigArrayFactory();
                const initialConfig = {
                        parser: null,
                        parserOptions: {},
                        plugins: [],
                        env: {},
                        globals: {},
                        rules: {
                            quotes: [2, "double"]
                        },
                        settings: {}
                    },
                    updatedConfig = {
                        parser: null,
                        parserOptions: {},
                        plugins: [],
                        env: {},
                        globals: {},
                        rules: {
                            quotes: [0]
                        },
                        settings: {}
                    },
                    tmpFilename = "fresh-test.json",
                    tmpFilePath = writeTempConfigFile(initialConfig, tmpFilename);
                let config = load(factory, tmpFilePath);

                assert.deepStrictEqual(config, initialConfig);
                writeTempConfigFile(updatedConfig, tmpFilename, path.dirname(tmpFilePath));
                config = load(factory, tmpFilePath);
                assert.deepStrictEqual(config, updatedConfig);
            });

            it("should load information from a package.json file", () => {
                const factory = new ConfigArrayFactory();
                const configFilePath = getFixturePath("package-json/package.json");
                const config = load(factory, configFilePath);

                assert.deepStrictEqual(config, {
                    parser: null,
                    parserOptions: {},
                    plugins: [],
                    env: { es6: true },
                    globals: {},
                    rules: {},
                    settings: {}
                });
            });

            it("should throw error when loading invalid package.json file", () => {
                const factory = new ConfigArrayFactory();

                assert.throws(() => {
                    try {
                        load(factory, getFixturePath("broken-package-json/package.json"));
                    } catch (error) {
                        assert.strictEqual(error.messageTemplate, "failed-to-read-json");
                        throw error;
                    }
                }, /Cannot read config file/u);
            });

            it("should load fresh information from a package.json file", () => {
                const factory = new ConfigArrayFactory();
                const initialConfig = {
                        eslintConfig: {
                            parser: null,
                            parserOptions: {},
                            plugins: [],
                            env: {},
                            globals: {},
                            rules: {
                                quotes: [2, "double"]
                            },
                            settings: {}
                        }
                    },
                    updatedConfig = {
                        eslintConfig: {
                            parser: null,
                            parserOptions: {},
                            plugins: [],
                            env: {},
                            globals: {},
                            rules: {
                                quotes: [0]
                            },
                            settings: {}
                        }
                    },
                    tmpFilename = "package.json",
                    tmpFilePath = writeTempConfigFile(initialConfig, tmpFilename);
                let config = load(factory, tmpFilePath);

                assert.deepStrictEqual(config, initialConfig.eslintConfig);
                writeTempConfigFile(updatedConfig, tmpFilename, path.dirname(tmpFilePath));
                config = load(factory, tmpFilePath);
                assert.deepStrictEqual(config, updatedConfig.eslintConfig);
            });

            it("should load fresh information from a .eslintrc.js file", () => {
                const factory = new ConfigArrayFactory();
                const initialConfig = {
                        parser: null,
                        parserOptions: {},
                        plugins: [],
                        env: {},
                        globals: {},
                        rules: {
                            quotes: [2, "double"]
                        },
                        settings: {}
                    },
                    updatedConfig = {
                        parser: null,
                        parserOptions: {},
                        plugins: [],
                        env: {},
                        globals: {},
                        rules: {
                            quotes: [0]
                        },
                        settings: {}
                    },
                    tmpFilename = ".eslintrc.js",
                    tmpFilePath = writeTempJsConfigFile(initialConfig, tmpFilename);
                let config = load(factory, tmpFilePath);

                assert.deepStrictEqual(config, initialConfig);
                writeTempJsConfigFile(updatedConfig, tmpFilename, path.dirname(tmpFilePath));
                config = load(factory, tmpFilePath);
                assert.deepStrictEqual(config, updatedConfig);
            });

            it("should load information from a YAML file", () => {
                const factory = new ConfigArrayFactory();
                const configFilePath = getFixturePath("yaml/.eslintrc.yaml");
                const config = load(factory, configFilePath);

                assert.deepStrictEqual(config, {
                    parser: null,
                    parserOptions: {},
                    plugins: [],
                    env: { browser: true },
                    globals: {},
                    rules: {},
                    settings: {}
                });
            });

            it("should load information from a YAML file", () => {
                const factory = new ConfigArrayFactory();
                const configFilePath = getFixturePath("yaml/.eslintrc.empty.yaml");
                const config = load(factory, configFilePath);

                assert.deepStrictEqual(config, {
                    parser: null,
                    parserOptions: {},
                    plugins: [],
                    env: {},
                    globals: {},
                    rules: {},
                    settings: {}
                });
            });

            it("should load information from a YML file", () => {
                const factory = new ConfigArrayFactory();
                const configFilePath = getFixturePath("yml/.eslintrc.yml");
                const config = load(factory, configFilePath);

                assert.deepStrictEqual(config, {
                    parser: null,
                    parserOptions: {},
                    plugins: [],
                    env: { node: true },
                    globals: {},
                    rules: {},
                    settings: {}
                });
            });

            it("should load information from a YML file and apply extensions", () => {
                const factory = new ConfigArrayFactory();
                const configFilePath = getFixturePath("extends/.eslintrc.yml");
                const config = load(factory, configFilePath);

                assert.deepStrictEqual(config, {
                    env: { es6: true },
                    globals: {},
                    parser: null,
                    parserOptions: {},
                    plugins: [],
                    rules: { booya: [2] },
                    settings: {}
                });
            });

            it("should load information from `extends` chain.", () => {
                const factory = new ConfigArrayFactory();
                const configFilePath = getFixturePath("extends-chain/.eslintrc.json");
                const config = load(factory, configFilePath);

                assert.deepStrictEqual(config, {
                    env: {},
                    globals: {},
                    parser: null,
                    parserOptions: {},
                    plugins: [],
                    rules: {
                        a: [2], // from node_modules/eslint-config-a
                        b: [2], // from node_modules/eslint-config-a/node_modules/eslint-config-b
                        c: [2] // from node_modules/eslint-config-a/node_modules/eslint-config-b/node_modules/eslint-config-c
                    },
                    settings: {}
                });
            });

            it("should load information from `extends` chain with relative path.", () => {
                const factory = new ConfigArrayFactory();
                const configFilePath = getFixturePath("extends-chain-2/.eslintrc.json");
                const config = load(factory, configFilePath);

                assert.deepStrictEqual(config, {
                    env: {},
                    globals: {},
                    parser: null,
                    parserOptions: {},
                    plugins: [],
                    rules: {
                        a: [2], // from node_modules/eslint-config-a/index.js
                        relative: [2] // from node_modules/eslint-config-a/relative.js
                    },
                    settings: {}
                });
            });

            it("should load information from `extends` chain in .eslintrc with relative path.", () => {
                const factory = new ConfigArrayFactory();
                const configFilePath = getFixturePath("extends-chain-2/relative.eslintrc.json");
                const config = load(factory, configFilePath);

                assert.deepStrictEqual(config, {
                    env: {},
                    globals: {},
                    parser: null,
                    parserOptions: {},
                    plugins: [],
                    rules: {
                        a: [2], // from node_modules/eslint-config-a/index.js
                        relative: [2] // from node_modules/eslint-config-a/relative.js
                    },
                    settings: {}
                });
            });

            it("should load information from `parser` in .eslintrc with relative path.", () => {
                const factory = new ConfigArrayFactory();
                const configFilePath = getFixturePath("extends-chain-2/parser.eslintrc.json");
                const config = load(factory, configFilePath);
                const parserPath = getFixturePath("extends-chain-2/parser.js");

                assert.deepStrictEqual(config, {
                    env: {},
                    globals: {},
                    parser: parserPath,
                    parserOptions: {},
                    plugins: [],
                    rules: {},
                    settings: {}
                });
            });

            describe("even if it's in another directory,", () => {
                let fixturePath = "";

                before(() => {
                    const tempDir = temp.mkdirSync("eslint-test-chain");
                    const chain2 = getFixturePath("extends-chain-2");

                    fixturePath = path.join(tempDir, "extends-chain-2");
                    shell.cp("-r", chain2, fixturePath);
                });

                after(() => {
                    temp.cleanupSync();
                });

                it("should load information from `extends` chain in .eslintrc with relative path.", () => {
                    const factory = new ConfigArrayFactory();
                    const configFilePath = path.join(fixturePath, "relative.eslintrc.json");
                    const config = load(factory, configFilePath);

                    assert.deepStrictEqual(config, {
                        env: {},
                        globals: {},
                        parser: null,
                        parserOptions: {},
                        plugins: [],
                        rules: {
                            a: [2], // from node_modules/eslint-config-a/index.js
                            relative: [2] // from node_modules/eslint-config-a/relative.js
                        },
                        settings: {}
                    });
                });

                it("should load information from `parser` in .eslintrc with relative path.", () => {
                    const factory = new ConfigArrayFactory();
                    const configFilePath = path.join(fixturePath, "parser.eslintrc.json");
                    const config = load(factory, configFilePath);
                    const parserPath = path.join(fixturePath, "parser.js");

                    assert.deepStrictEqual(config, {
                        env: {},
                        globals: {},
                        parser: parserPath,
                        parserOptions: {},
                        plugins: [],
                        rules: {},
                        settings: {}
                    });
                });
            });

            describe("Plugins", () => {
                it("should load information from a YML file and load plugins", () => {
                    const stubbedFactory = createStubbedConfigArrayFactory({
                        "eslint-plugin-test": {
                            environments: {
                                bar: { globals: { bar: true } }
                            }
                        }
                    });
                    const configFilePath = getFixturePath("plugins/.eslintrc.yml");
                    const config = load(stubbedFactory, configFilePath);

                    assert.deepStrictEqual(config, {
                        parser: null,
                        parserOptions: {},
                        env: { "test/bar": true },
                        globals: {},
                        plugins: ["test"],
                        rules: {
                            "test/foo": [2]
                        },
                        settings: {}
                    });
                });

                it("should load two separate configs from a plugin", () => {
                    const resolvedPath = path.resolve(PROJECT_PATH, "./node_modules/eslint-plugin-test/index.js");
                    const stubbedFactory = createStubbedConfigArrayFactory({
                        "eslint-plugin-test": resolvedPath,
                        [resolvedPath]: {
                            configs: {
                                foo: { rules: { semi: 2, quotes: 1 } },
                                bar: { rules: { quotes: 2, yoda: 2 } }
                            }
                        }
                    });
                    const configFilePath = getFixturePath("plugins/.eslintrc2.yml");
                    const config = load(stubbedFactory, configFilePath);

                    assert.deepStrictEqual(config, {
                        parser: null,
                        parserOptions: {},
                        plugins: [],
                        globals: {},
                        env: {},
                        rules: {
                            semi: [2],
                            quotes: [2],
                            yoda: [2]
                        },
                        settings: {}
                    });
                });
            });

            describe("even if config files have Unicode BOM,", () => {
                it("should read the JSON config file correctly.", () => {
                    const factory = new ConfigArrayFactory();
                    const configFilePath = getFixturePath("bom/.eslintrc.json");
                    const config = load(factory, configFilePath);

                    assert.deepStrictEqual(config, {
                        env: {},
                        globals: {},
                        parser: null,
                        parserOptions: {},
                        plugins: [],
                        rules: {
                            semi: ["error"]
                        },
                        settings: {}
                    });
                });

                it("should read the YAML config file correctly.", () => {
                    const factory = new ConfigArrayFactory();
                    const configFilePath = getFixturePath("bom/.eslintrc.yaml");
                    const config = load(factory, configFilePath);

                    assert.deepStrictEqual(config, {
                        env: {},
                        globals: {},
                        parser: null,
                        parserOptions: {},
                        plugins: [],
                        rules: {
                            semi: ["error"]
                        },
                        settings: {}
                    });
                });

                it("should read the config in package.json correctly.", () => {
                    const factory = new ConfigArrayFactory();
                    const configFilePath = getFixturePath("bom/package.json");
                    const config = load(factory, configFilePath);

                    assert.deepStrictEqual(config, {
                        env: {},
                        globals: {},
                        parser: null,
                        parserOptions: {},
                        plugins: [],
                        rules: {
                            semi: ["error"]
                        },
                        settings: {}
                    });
                });
            });

            it("throws an error including the config file name if the config file is invalid", () => {
                const factory = new ConfigArrayFactory();
                const configFilePath = getFixturePath("invalid/invalid-top-level-property.yml");

                try {
                    load(factory, configFilePath);
                } catch (err) {
                    assert.include(err.message, `ESLint configuration in ${configFilePath} is invalid`);
                    return;
                }
                assert.fail();
            });
        });

        describe("resolve()", () => {

            /**
             * Resolve `extends` module.
             * @param {ConfigArrayFactory} factory The factory.
             * @param {string} request The module name to resolve.
             * @param {string} [relativeTo] The importer path to resolve.
             * @returns {string} The resolved path.
             */
            function resolve(factory, request, relativeTo) {
                try {
                    return factory.create(
                        { extends: request },
                        { filePath: relativeTo }
                    )[0];
                } catch (error) {

                    // Ignore reading error because this is test for resolving.
                    const m = /^Cannot read config file: (.+)/u.exec(error.message);

                    if (!m) {
                        throw error;
                    }
                    return { filePath: m[1] };
                }
            }

            describe("Relative to CWD", () => {
                leche.withData([
                    ["./.eslintrc", path.resolve(".eslintrc")],
                    ["eslint-config-foo", getProjectModulePath("eslint-config-foo")],
                    ["foo", getProjectModulePath("eslint-config-foo")],
                    ["eslint-configfoo", getProjectModulePath("eslint-config-eslint-configfoo")],
                    ["@foo/eslint-config", getProjectModulePath("@foo/eslint-config")],
                    ["@foo/bar", getProjectModulePath("@foo/eslint-config-bar")],
                    ["plugin:foo/bar", getProjectModulePath("eslint-plugin-foo")]
                ], (input, expected) => {
                    it(`should return ${expected} when passed ${input}`, () => {
                        const factory = createStubbedConfigArrayFactory({
                            "./.eslintrc": path.resolve(".eslintrc"),
                            "eslint-config-foo": getProjectModulePath("eslint-config-foo"),
                            "eslint-config-eslint-configfoo": getProjectModulePath("eslint-config-eslint-configfoo"),
                            "@foo/eslint-config": getProjectModulePath("@foo/eslint-config"),
                            "@foo/eslint-config-bar": getProjectModulePath("@foo/eslint-config-bar"),
                            "eslint-plugin-foo": getProjectModulePath("eslint-plugin-foo"),
                            [path.resolve(".eslintrc")]: {},
                            [getProjectModulePath("eslint-config-foo")]: {},
                            [getProjectModulePath("eslint-config-eslint-configfoo")]: {},
                            [getProjectModulePath("@foo/eslint-config")]: {},
                            [getProjectModulePath("@foo/eslint-config-bar")]: {},
                            [getProjectModulePath("eslint-plugin-foo")]: {
                                configs: { bar: {} }
                            }
                        });
                        const result = resolve(factory, input);

                        assert.strictEqual(result.filePath, expected);
                    });
                });
            });

            describe("Relative to config file", () => {
                const relativePath = path.resolve("./foo/bar");

                leche.withData([
                    ["./.eslintrc", path.resolve("./foo/bar", ".eslintrc"), relativePath],
                    ["eslint-config-foo", getRelativeModulePath("eslint-config-foo", relativePath), relativePath],
                    ["foo", getRelativeModulePath("eslint-config-foo", relativePath), relativePath],
                    ["eslint-configfoo", getRelativeModulePath("eslint-config-eslint-configfoo", relativePath), relativePath],
                    ["@foo/eslint-config", getRelativeModulePath("@foo/eslint-config", relativePath), relativePath],
                    ["@foo/bar", getRelativeModulePath("@foo/eslint-config-bar", relativePath), relativePath],
                    ["plugin:@foo/bar/baz", getProjectModulePath("@foo/eslint-plugin-bar"), relativePath]
                ], (input, expected, relativeTo) => {
                    it(`should return ${expected} when passed ${input}`, () => {
                        const factory = createStubbedConfigArrayFactory({
                            "./.eslintrc": path.resolve("./foo/bar", ".eslintrc"),
                            "eslint-config-foo": getRelativeModulePath("eslint-config-foo", relativePath),
                            "eslint-config-eslint-configfoo": getRelativeModulePath("eslint-config-eslint-configfoo", relativePath),
                            "@foo/eslint-config": getRelativeModulePath("@foo/eslint-config", relativePath),
                            "@foo/eslint-config-bar": getRelativeModulePath("@foo/eslint-config-bar", relativePath),
                            "@foo/eslint-plugin-bar": getProjectModulePath("@foo/eslint-plugin-bar"),
                            [path.resolve("./foo/bar", ".eslintrc")]: {},
                            [getRelativeModulePath("eslint-config-foo", relativePath)]: {},
                            [getRelativeModulePath("eslint-config-eslint-configfoo", relativePath)]: {},
                            [getRelativeModulePath("@foo/eslint-config", relativePath)]: {},
                            [getRelativeModulePath("@foo/eslint-config-bar", relativePath)]: {},
                            [getProjectModulePath("@foo/eslint-plugin-bar")]: {
                                configs: { baz: {} }
                            }
                        });
                        const result = resolve(factory, input, relativeTo);

                        assert.strictEqual(result.filePath, expected);
                    });
                });

                leche.withData([
                    ["eslint-config-foo/bar", path.resolve("./node_modules", "eslint-config-foo/bar", "index.json"), relativePath],
                    ["eslint-config-foo/bar", path.resolve("./node_modules", "eslint-config-foo", "bar.json"), relativePath],
                    ["eslint-config-foo/bar", path.resolve("./node_modules", "eslint-config-foo/bar", "index.js"), relativePath],
                    ["eslint-config-foo/bar", path.resolve("./node_modules", "eslint-config-foo", "bar.js"), relativePath]
                ], (input, expected, relativeTo) => {
                    it(`should return ${expected} when passed ${input}`, () => {
                        const factory = createStubbedConfigArrayFactory({
                            "eslint-config-foo/bar": expected,
                            [expected]: {}
                        });
                        const result = resolve(factory, input, relativeTo);

                        assert.strictEqual(result.filePath, expected);
                    });
                });
            });
        });
    });

    describe("Moved from tests/lib/config/plugins.js", () => {
        describe("load()", () => {
            let stubbedFactory,
                plugin,
                scopedPlugin;

            beforeEach(() => {
                plugin = {};
                scopedPlugin = {};
                stubbedFactory = createStubbedConfigArrayFactory({
                    "eslint-plugin-example": plugin,
                    "@scope/eslint-plugin-example": scopedPlugin,
                    "eslint-plugin-throws-on-load": Error("error thrown while loading this module")
                });
            });

            /**
             * Load a plugin.
             * @param {string} request A request to load a plugin.
             * @returns {Map<string,Object>} The loaded plugins.
             */
            function load(request) {
                const config = stubbedFactory.create({ plugins: [request] });

                return new Map(
                    Object
                        .entries(config[0].plugins)
                        .map(([id, entry]) => {
                            if (entry.error) {
                                throw entry.error;
                            }
                            return [id, entry.definition];
                        })
                );
            }

            it("should load a plugin when referenced by short name", () => {
                const loadedPlugins = load("example");

                assert.strictEqual(loadedPlugins.get("example"), plugin);
            });

            it("should load a plugin when referenced by long name", () => {
                const loadedPlugins = load("eslint-plugin-example");

                assert.strictEqual(loadedPlugins.get("example"), plugin);
            });

            it("should throw an error when a plugin has whitespace", () => {
                assert.throws(() => {
                    load("whitespace ");
                }, /Whitespace found in plugin name 'whitespace '/u);
                assert.throws(() => {
                    load("whitespace\t");
                }, /Whitespace found in plugin name/u);
                assert.throws(() => {
                    load("whitespace\n");
                }, /Whitespace found in plugin name/u);
                assert.throws(() => {
                    load("whitespace\r");
                }, /Whitespace found in plugin name/u);
            });

            it("should throw an error when a plugin doesn't exist", () => {
                assert.throws(() => {
                    load("nonexistentplugin");
                }, /Failed to load plugin/u);
            });

            it("should rethrow an error that a plugin throws on load", () => {
                try {
                    load("throws-on-load");
                } catch (err) {
                    assert.strictEqual(
                        err.message,
                        "error thrown while loading this module",
                        "should rethrow the same error that was thrown on plugin load"
                    );

                    return;
                }
                assert.fail(null, null, "should throw an error if a plugin fails to load");
            });

            it("should load a scoped plugin when referenced by short name", () => {
                const loadedPlugins = load("@scope/example");

                assert.strictEqual(loadedPlugins.get("@scope/example"), scopedPlugin);
            });

            it("should load a scoped plugin when referenced by long name", () => {
                const loadedPlugins = load("@scope/eslint-plugin-example");

                assert.strictEqual(loadedPlugins.get("@scope/example"), scopedPlugin);
            });

            describe("when referencing a scope plugin and omitting @scope/", () => {
                it("should load a scoped plugin when referenced by short name, but should not get the plugin if '@scope/' is omitted", () => {
                    const loadedPlugins = load("@scope/example");

                    assert.strictEqual(loadedPlugins.get("example"), void 0);
                });

                it("should load a scoped plugin when referenced by long name, but should not get the plugin if '@scope/' is omitted", () => {
                    const loadedPlugins = load("@scope/eslint-plugin-example");

                    assert.strictEqual(loadedPlugins.get("example"), void 0);
                });
            });
        });

        describe("loadAll()", () => {
            let stubbedFactory,
                plugin1,
                plugin2;

            beforeEach(() => {
                plugin1 = {};
                plugin2 = {};
                stubbedFactory = createStubbedConfigArrayFactory({
                    "eslint-plugin-example1": plugin1,
                    "eslint-plugin-example2": plugin2
                });
            });

            /**
             * Load a plugin.
             * @param {string[]} request A request to load a plugin.
             * @returns {Map<string,Object>} The loaded plugins.
             */
            function loadAll(request) {
                const config = stubbedFactory.create({ plugins: request });

                return new Map(
                    Object
                        .entries(config[0].plugins)
                        .map(([id, entry]) => {
                            if (entry.error) {
                                throw entry.error;
                            }
                            return [id, entry.definition];
                        })
                );
            }

            it("should load plugins when passed multiple plugins", () => {
                const loadedPlugins = loadAll(["example1", "example2"]);

                assert.strictEqual(loadedPlugins.get("example1"), plugin1);
                assert.strictEqual(loadedPlugins.get("example2"), plugin2);
            });
        });
    });
});
