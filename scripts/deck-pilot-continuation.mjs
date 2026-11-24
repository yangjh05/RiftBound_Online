import assert from 'node:assert/strict';
import { digest } from './adaptive-policy-q-contract.mjs';

export const CONTINUOUS_PILOT_CONTRACT = 'isolated-deck-continuous-training-v1';

// An additive protocol preserves the original experiment's config and evidence.
export function validatePilotContinuation(config, protocol, state = {}) {
  if (!protocol) {
    assert.ok(!state.continuationHash && (state.iteration || 0) <= config.iterations,
      'Continuous pilot protocol is missing; refusing to revert to the finite experiment.');
    return null;
  }
  assert.equal(protocol.contract, CONTINUOUS_PILOT_CONTRACT);
  assert.equal(protocol.configHash, digest(config));
  assert.equal(protocol.afterIteration, config.iterations);
  assert.equal(protocol.evaluationEveryIterations, 16);
  assert.equal(protocol.crossEvaluationEveryIterations, 64);
  assert.equal(protocol.automaticPromotion, false);
  if (state.continuationHash) assert.equal(state.continuationHash, digest(protocol));
  else assert.ok((state.iteration || 0) <= protocol.afterIteration,
    'Cannot adopt a new protocol after continuous training has begun.');
  return protocol;
}

export function pilotEvaluationSpec(config, iteration, protocol = null) {
  if (iteration === config.iterations) return { directory: 'evaluation', full: true,
    evaluationSeed: config.evaluationSeed, initial: true };
  if (!protocol || iteration <= protocol.afterIteration
    || (iteration - protocol.afterIteration) % protocol.evaluationEveryIterations !== 0) return null;
  return { directory: `evaluations/${String(iteration).padStart(6, '0')}`,
    full: (iteration - protocol.afterIteration) % protocol.crossEvaluationEveryIterations === 0,
    evaluationSeed: (config.evaluationSeed + iteration * 1000003) >>> 0, initial: false };
}
