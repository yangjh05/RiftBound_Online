import test from "node:test";
import assert from "node:assert/strict";
import { canonicalTrainingFingerprint } from "../scripts/training-safety.mjs";

test('retention repair compatibility requires pinned evaluation and unchanged saved targets and encoding',()=>{
 const raw=`sha256:${'1'.repeat(64)}`,prior=`sha256:${'2'.repeat(64)}`;
 const entry={kind:'cycle-safe-payment-key-and-training-retention-v1',rawFingerprint:raw,compatibleFingerprint:prior,
  auditReport:'docs/audits/ai-lesson-replay-fix-2026-09-30.md',previouslyCompletedGameBehaviorPreserved:true,
  frozenEvaluationRuntimePinned:true,savedTargetsPreserved:true,encodingsPreserved:true};
 const manifest=e=>({version:1,entries:[e]});
 assert.equal(canonicalTrainingFingerprint(raw,manifest(entry)),prior);
 for(const key of ['previouslyCompletedGameBehaviorPreserved','frozenEvaluationRuntimePinned','savedTargetsPreserved','encodingsPreserved'])
  assert.equal(canonicalTrainingFingerprint(raw,manifest({...entry,[key]:false})),raw);
 assert.equal(canonicalTrainingFingerprint(`sha256:${'3'.repeat(64)}`,manifest(entry)),`sha256:${'3'.repeat(64)}`);
});

test("archive I/O compatibility requires an exact digest and unchanged payload and behavior", () => {
  const raw = `sha256:${"3".repeat(64)}`, prior = `sha256:${"4".repeat(64)}`;
  const entry = { kind: "equivalent-archive-io-v1", rawFingerprint: raw,
    compatibleFingerprint: prior, auditReport: "docs/audits/ai-archive-recovery-2026-09-17.md",
    policyActionsPreserved: true, evaluationBehaviorPreserved: true,
    savedTargetsPreserved: true, archivePayloadPreserved: true };
  const manifest = value => ({ version: 1, entries: [value] });
  assert.equal(canonicalTrainingFingerprint(raw, manifest(entry)), prior);
  for (const key of ["policyActionsPreserved", "evaluationBehaviorPreserved", "savedTargetsPreserved", "archivePayloadPreserved"]) {
    assert.equal(canonicalTrainingFingerprint(raw, manifest({ ...entry, [key]: false })), raw);
  }
  const other = `sha256:${"5".repeat(64)}`;
  assert.equal(canonicalTrainingFingerprint(other, manifest(entry)), other);
  assert.equal(canonicalTrainingFingerprint(raw, manifest({ ...entry, auditReport: "" })), raw);
});

test("compatibility accepts only an exact reviewed complete digest", () => {
  const raw = `sha256:${"a".repeat(64)}`, previous = `sha256:${"b".repeat(64)}`;
  const manifest = { version: 1, entries: [{ rawFingerprint: raw,
    compatibleFingerprint: previous, kind: "additive-natural-audit-sampling-v3",
    auditReport: "docs/audits/ai-natural-phase-sampling-2026-09-13.md" }] };
  assert.equal(canonicalTrainingFingerprint(raw, manifest), previous);
  assert.equal(canonicalTrainingFingerprint(`sha256:${"c".repeat(64)}`, manifest), `sha256:${"c".repeat(64)}`);
  assert.equal(canonicalTrainingFingerprint(raw, { ...manifest, version: 2 }), raw);
  assert.equal(canonicalTrainingFingerprint(raw, { version: 1, entries: [{ ...manifest.entries[0], auditReport: null }] }), raw);
  assert.equal(canonicalTrainingFingerprint(raw, { version: 1, entries: [{ ...manifest.entries[0], rawFingerprint: "*" }] }), raw);
});

test('training-only tactical preview compatibility requires explicit inference and target preservation',()=>{
 const raw=`sha256:${'c'.repeat(64)}`,prior=`sha256:${'d'.repeat(64)}`;
 const entry={kind:'training-only-tactical-demonstration-v1',rawFingerprint:raw,compatibleFingerprint:prior,
   auditReport:'docs/audits/ai-tactical-preview-repair-2026-09-15.md',policyActionsPreserved:true,
   evaluationBehaviorPreserved:true,savedTargetsPreserved:true};
 const manifest=entry=>({version:1,entries:[entry]});
 assert.equal(canonicalTrainingFingerprint(raw,manifest(entry)),prior);
 for(const key of ['policyActionsPreserved','evaluationBehaviorPreserved','savedTargetsPreserved']){
   assert.equal(canonicalTrainingFingerprint(raw,manifest({...entry,[key]:false})),raw);
 }
});

test('evaluation inference compatibility requires exact source digest and every preservation assertion',()=>{
 const raw=`sha256:${'1'.repeat(64)}`,prior=`sha256:${'2'.repeat(64)}`;
 const entry={kind:'equivalent-evaluation-inference-v1',rawFingerprint:raw,compatibleFingerprint:prior,
   auditReport:'docs/audits/ai-throughput-2026-09-16.md',policyActionsPreserved:true,
   evaluationBehaviorPreserved:true,savedTargetsPreserved:true,recurrentMemoryPreserved:true};
 const manifest=entry=>({version:1,entries:[entry]});
 assert.equal(canonicalTrainingFingerprint(raw,manifest(entry)),prior);
 for(const key of ['policyActionsPreserved','evaluationBehaviorPreserved','savedTargetsPreserved','recurrentMemoryPreserved']){
   assert.equal(canonicalTrainingFingerprint(raw,manifest({...entry,[key]:false})),raw);
 }
 assert.equal(canonicalTrainingFingerprint(prior,manifest(entry)),prior);
});
