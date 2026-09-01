import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appSource = await readFile(new URL("../src/app.mjs", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
const tabletopStyles = await readFile(new URL("../src/tabletop.css", import.meta.url), "utf8");

test("processing queue cards render only their title and declared targets", () => {
  const renderer = appSource.slice(
    appSource.indexOf("function chainZoneItem("),
    appSource.indexOf("function chainItemEffectText(")
  );
  assert.match(renderer, /<strong>\$\{escapeHtml\(chainItemTitle\(item\)\)\}<\/strong>/);
  assert.match(renderer, /class="chain-zone-target"/);
  assert.match(renderer, /chainItemTargetIds\(item\)/);
  assert.doesNotMatch(renderer, /chain-zone-source/);
  assert.doesNotMatch(renderer, /chain-zone-effect/);
  assert.doesNotMatch(renderer, /chain-active-effect-text/);
  assert.doesNotMatch(renderer, /chain-selected-ability/);
});

test("processing queue uses a compact horizontal scrolling card track", () => {
  assert.match(tabletopStyles, /\.tabletop-layout \.chain-stack\s*\{[\s\S]*display:\s*flex !important;[\s\S]*flex-flow:\s*row nowrap !important;[\s\S]*overflow-x:\s*auto !important;[\s\S]*overflow-y:\s*hidden !important;/);
  assert.match(tabletopStyles, /\.tabletop-layout \.chain-zone-item\s*\{[\s\S]*flex:\s*0 0 clamp\(232px, 22vw, 280px\) !important;[\s\S]*grid-template-columns:\s*54px minmax\(0, 1fr\) !important;[\s\S]*min-height:\s*96px !important;[\s\S]*max-height:\s*none !important;/);
  assert.match(tabletopStyles, /\.tabletop-layout \.chain-card-motion-anchor\[data-motion-anchor\]\s*\{[\s\S]*width:\s*54px;[\s\S]*height:\s*76px;/);
  assert.match(tabletopStyles, /\.tabletop-layout \.chain-context-panel\s*\{[\s\S]*overflow-y:\s*auto !important;/);
});

test("Pending hand plays are visible only to their player until Finalize", () => {
  assert.match(appSource, /function chainItemVisibleInTree\(item\)/);
  assert.match(appSource, /return chainItemVisibleToViewer\(item, viewerPlayerId\(\)\);/);
  assert.match(appSource, /item\?\.destination/);
});

test("private opponent resolutions never expose an enabled duplicate response control", () => {
  assert.match(appSource, /function responsePromptInfo\(\)/);
  assert.match(appSource, /!viewerCanAct\(\)/);
  assert.match(appSource, /function passControlButton\(\{ disabled = false \} = \{\}\)/);
  assert.match(appSource, /game\?\.pendingChoice \|\| game\?\.pendingPayment \|\| !viewerCanAct\(\)/);
  assert.equal((appSource.match(/data-action="pass-showdown"/g) || []).length, 1);
});

test("repeated damage choices display their progress and whether targets can repeat", () => {
  assert.match(appSource, /function repeatedDamageProgress\(choice\)/);
  assert.match(appSource, /choice\.data\?\.repeatTotal/);
  assert.match(appSource, /selectRepeatedTargetsOnPlay/);
  assert.match(appSource, /selectedForCurrentStep/);
  assert.match(appSource, /choice\.data\?\.allowRepeatedTargets/);
  assert.match(appSource, /class="choice-repeat-progress"/);
  assert.match(styles, /\.choice-repeat-progress\s*\{/);
});

test("processing queue can collapse so the battlefield remains visible", () => {
  assert.match(appSource, /let chainZoneCollapsed = false/);
  assert.match(appSource, /data-action="toggle-chain-zone"/);
  assert.match(appSource, /aria-expanded="\$\{chainZoneCollapsed \? "false" : "true"\}"/);
  assert.match(appSource, /data-scroll-key="chain-stack"/);
  assert.match(appSource, /button\[data-action='toggle-chain-zone'\]/);
  assert.match(appSource, /"toggle-chain-zone",(?:\s*"toggle-inspector",)?\s*\n\s*"inspect-chain-effect"/);
  assert.match(tabletopStyles, /\.tabletop-layout \.chain-zone-content\[hidden\]\s*\{\s*display:\s*none !important;\s*\}/);
  assert.match(tabletopStyles, /\.tabletop-layout \.chain-pod\.is-collapsed,[\s\S]*width:\s*clamp\(208px, 16vw, 248px\) !important;[\s\S]*height:\s*42px !important;/);
});

test("a resolving Chain item remains visible once and reuses its owning Chain item id", () => {
  assert.match(appSource, /let chainTreePresentationItems = \[\]/);
  assert.match(appSource, /function pendingResolutionChainItem\(\)/);
  assert.match(appSource, /pending\.gameEffectResolution\?\.context\?\.chainKind/);
  assert.match(appSource, /function pendingResolutionOwnerChainItemId\(pending\)/);
  assert.match(appSource, /pending\.playProcess\?\.chainItemId/);
  assert.match(appSource, /presentationChainItemId:\s*pendingResolutionOwnerChainItemId\(pending\)/);
  assert.match(appSource, /liveItems\.findIndex\(\(item\) => chainPresentationItemsMatch\(resolvingItem, item\)\)/);
  assert.match(appSource, /chainTreePresentationItems = uniqueLiveItems\.map\(snapshotChainPresentationItem\)/);
  assert.match(appSource, /resolutionStillOpen && chainTreePresentationItems\.length/);
  assert.match(appSource, /chainTreePresentationItems = \[\];\s*return \[\];/);
});

test("priority response controls contain only the selected reaction actions and pass", () => {
  const renderer = appSource.slice(
    appSource.indexOf("function priorityResponseControls("),
    appSource.indexOf("function actionUseWindowAvailable(")
  );
  assert.match(renderer, /priority-card-actions/);
  assert.match(renderer, /\$\{actionMarkup/);
  assert.match(renderer, /\$\{passControlButton\(\)\}/);
  assert.doesNotMatch(renderer, /data-action="toggle-hand"/);
});

test("large resolving card choices expose a stable card-grid contract and filter their wrappers", () => {
  assert.match(appSource, /choice-card-selection-panel has-card-options/);
  assert.match(appSource, /data-choice-layout="\$\{choiceLayout\}"/);
  assert.match(appSource, /\.choice-grid > \.choice-option, \.choice-grid > \.choice-option-wrap/);
});
