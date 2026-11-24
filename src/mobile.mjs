import "./app.mjs";
import { App as NativeApp } from "@capacitor/app";

const DISMISS_TARGETS = [
  [".full-card-modal", "close-full-card"],
  [".intel-panel", "close-intel"],
  [".banished-panel", "close-banished"],
  [".graveyard-panel", "close-graveyard"],
  [".payment-panel", "cancel-payment"],
  [".game-exit-modal", "cancel-game-exit"],
  [".coach-screen", "coach-back"],
  [".layout.inspector-open .inspector", "toggle-inspector"],
  [".log-drawer", "toggle-log"],
  [".hand-drawer.open", "toggle-hand"]
];

function visibleAction(action) {
  return [...document.querySelectorAll(`[data-action="${action}"]`)].find((element) => {
    const style = getComputedStyle(element);
    return !element.disabled && style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
  });
}

function clickFirst(actions) {
  for (const action of actions) {
    const element = visibleAction(action);
    if (element) {
      element.click();
      return true;
    }
  }
  return false;
}

NativeApp.addListener("backButton", () => {
  for (const [containerSelector, action] of DISMISS_TARGETS) {
    if (document.querySelector(containerSelector) && clickFirst([action])) return;
  }

  const deckBack = visibleAction("deck-mobile-list");
  if (deckBack && document.querySelector(".deck-builder-screen.mobile-view-edit")) {
    deckBack.click();
    return;
  }

  if (clickFirst(["tutorial-menu-back", "menu-home"])) return;

  const surrender = visibleAction("surrender");
  if (surrender) {
    surrender.click();
    return;
  }

  void NativeApp.exitApp();
});
