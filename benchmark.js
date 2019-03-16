"use strict";

/* eslint no-console: off */

const { CLIEngine } = require(".");

const files = ["bin", "conf", "lib", "tests", "tools", "*.js", ".*.js"];
const medians = [];

console.log(`Run engine.executeOnFiles(${JSON.stringify(files)})`);
console.log();

const times = [];

for (let i = 1; i <= 5; ++i) {
    const startTime = Date.now();
    const engine = new CLIEngine();
    const { results } = engine.executeOnFiles(files);
    const endTime = Date.now();

    times.push(endTime - startTime);
    console.log(`Time[${i}]: ${endTime - startTime} ms per ${results.length} files`);
}

const median = times.sort()[times.length / 2 | 0];

medians.push(median);
console.log();
console.log(`Median Time: ${median} ms`);
console.log();
