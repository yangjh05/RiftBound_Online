import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

export const ADAPTIVE_CHECKPOINT_TRANSFER = 'changed-action-set-checkpoint-transfer-v1';

// A changed action mask cannot relabel old on-policy trajectories or frozen
// matches. Transfer weights with exact provenance into a separate run instead.
export async function verifyAdaptiveCheckpointTransfer(config) {
  const transfer = config.checkpointTransfer;
  if (!transfer) return null;
  if (transfer.contract !== ADAPTIVE_CHECKPOINT_TRANSFER
    || !/^sha256:[0-9a-f]{64}$/.test(transfer.sourceEngineFingerprint || '')
    || transfer.sourceEngineFingerprint === config.engineFingerprint
    || !/^[0-9a-f]{64}$/.test(transfer.sourceCheckpointSha256 || '')
    || !Number.isInteger(transfer.evaluationOrdinal) || transfer.evaluationOrdinal < 0
    || !transfer.sourceCheckpointPath || !transfer.sourceRunDirectory) {
    throw new Error('Invalid changed-action-set checkpoint transfer.');
  }
  const hash = file => readFile(file).then(bytes=>createHash('sha256').update(bytes).digest('hex'));
  const [source, input] = await Promise.all([hash(transfer.sourceCheckpointPath),hash(config.learnerPath)]);
  if (source !== transfer.sourceCheckpointSha256 || input !== source) {
    throw new Error('Transferred checkpoint contents changed.');
  }
  return {version:1,contract:ADAPTIVE_CHECKPOINT_TRANSFER,training:[],validation:[],fixedAnchorKeys:[],
    sourceSplitHash:transfer.sourceCheckpointSha256,engineFingerprint:config.engineFingerprint,
    sourceEngineFingerprint:transfer.sourceEngineFingerprint,sourceRunDirectory:transfer.sourceRunDirectory,
    oldTrajectoriesRelabeled:false,validationStatus:'awaiting-new-contract-evidence'};
}
