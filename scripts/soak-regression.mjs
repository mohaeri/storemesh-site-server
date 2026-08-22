#!/usr/bin/env node
import { makeConfig, runSoak } from '../src/soak-runner.js';

try {
  const config = makeConfig();
  const result = await runSoak(config);
  const passed = result.records.filter(x => x.passed).length;
  console.log(JSON.stringify({ passed: result.passed, iterations: result.records.length, successfulIterations: passed, logPath: config.logPath }));
  if (!result.passed) process.exitCode = 1;
} catch (error) {
  console.error(error.stack || error.message);
  process.exitCode = 1;
}
