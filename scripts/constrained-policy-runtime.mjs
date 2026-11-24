import assert from 'node:assert/strict';

// Used only to construct a private experiment runtime. Live/frozen runtimes
// are never edited, and the default training path remains byte-for-byte equal.
export function extendConstrainedPolicyRuntime(relative, original) {
  let source = original;
  const replace = (from, to) => {
    assert.equal(source.split(from).length, 2, `Unexpected source: ${relative}`);
    source = source.replace(from, to);
  };
  if (relative === 'src/ai/neural/model.mjs') {
    // trainPpoBatch and another training function share this statement.
    const start = source.indexOf('export function trainPpoBatch(');
    const end = source.indexOf('\nfunction teacherPpoLosses', start);
    const piece = source.slice(start, end);
    assert.equal(piece.split('if (options.applyGradients !== false) optimizer.applyGradients(grads);').length, 2);
    source = source.slice(0, start) + piece
      .replace('const { value: loss, grads } = tf.variableGrads(lossFunction, variableList);',
        'const { value: loss, grads } = options.evaluateOnly === true\n    ? {value: tf.tidy(lossFunction), grads: {}}\n    : tf.variableGrads(lossFunction, variableList);')
      .replace('if (options.applyGradients !== false) optimizer.applyGradients(grads);',
        'if (!options.evaluateOnly && options.applyGradients !== false) optimizer.applyGradients(grads);')
      .replace('optimizerStepApplied: options.applyGradients !== false,',
        'optimizerStepApplied: !options.evaluateOnly && options.applyGradients !== false,') + source.slice(end);
    replace('const anchorOutput = forwardNeuralPolicy(anchorModel, tensors.states, tensors.actions, tensors.initialMemories);',
      'const anchorMemory = options.anchorInitialMemories?.get(anchorModel);\n        const anchorOutput = forwardNeuralPolicy(anchorModel, tensors.states, tensors.actions,\n          anchorMemory ? tf.tensor2d(anchorMemory, tensors.initialMemories.shape) : tensors.initialMemories);');
  }
  if (relative === 'src/ai/neural/trainer.mjs') {
    replace('const metrics = {\n        epoch: epoch + 1,\n        phase: "ppo",\n        ...trainPpoBatch(model, batch, optimizer, {',
      'const batchUpdateOptions = {');
    replace('teacherActionValueCoefficient: 0\n        })\n      };\n      history.push(metrics);',
      'teacherActionValueCoefficient: 0\n        };\n      const updated = options.ppoBatchUpdate\n        ? await options.ppoBatchUpdate({model, batch, optimizer, options: batchUpdateOptions,\n            chunks: epochChunks.slice(start, start + batchSize), epoch: epoch + 1, batchIndex: Math.floor(start / batchSize)})\n        : {metrics: trainPpoBatch(model, batch, optimizer, batchUpdateOptions), optimizer};\n      optimizer = updated.optimizer;\n      const metrics = {epoch: epoch + 1, phase: "ppo", ...updated.metrics};\n      history.push(metrics);');
  }
  return source;
}
