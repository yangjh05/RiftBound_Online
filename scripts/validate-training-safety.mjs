import { inspectTrainingPreflight } from "./training-safety.mjs";

const result = inspectTrainingPreflight();
console.log(JSON.stringify(result, null, 2));
if (!result.passed) process.exitCode = 1;
