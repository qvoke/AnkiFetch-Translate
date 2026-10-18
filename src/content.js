let popup;
let pendingSave;
let translationIcon;
let popupRequestId = 0;
let selectionTranslationToken = 0;
let popupInteractionStarted = false;
let doubleClickGuardUntil = 0;
const TRANSLATION_ICON_PATH = "src/assets/icon.ico";
const LANGUAGES = [
  ["", "Auto-detect"], ["AR", "Arabic"], ["BG", "Bulgarian"], ["CS", "Czech"], ["DA", "Danish"],
  ["DE", "German"], ["EL", "Greek"], ["EN", "English"], ["EN-GB", "English (British)"], ["EN-US", "English (American)"], ["ES", "Spanish"], ["ET", "Estonian"],
  ["FI", "Finnish"], ["FR", "French"], ["HU", "Hungarian"], ["ID", "Indonesian"], ["IT", "Italian"], ["JA", "Japanese"], ["KO", "Korean"],
  ["LT", "Lithuanian"], ["LV", "Latvian"], ["NB", "Norwegian"], ["NL", "Dutch"], ["PL", "Polish"], ["PT", "Portuguese"], ["PT-BR", "Portuguese (Brazilian)"], ["PT-PT", "Portuguese (European)"],
  ["RO", "Romanian"], ["RU", "Russian"], ["SK", "Slovak"], ["SL", "Slovenian"], ["SV", "Swedish"], ["TR", "Turkish"], ["UK", "Ukrainian"], ["ZH", "Chinese"]
];

let extensionContextInvalidated = false;
const heldModifierKeys = new Set();
const heldShortcutKeys = new Set();
let selectionModifierSnapshot = null;
let browserFindActive = false;

const send = (message) => new Promise((resolve) => {
  if (extensionContextInvalidated) {
    resolve({ error: "Extension context invalidated" });
    return;
  }
  try {
    chrome.runtime.sendMessage(message, (response) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        if (runtimeError.message?.includes("Extension context invalidated")) extensionContextInvalidated = true;
        resolve({ error: runtimeError.message });
        return;
      }
      resolve(response || {});
    });
  } catch (error) {
    if (error.message?.includes("Extension context invalidated")) extensionContextInvalidated = true;
    resolve({ error: error.message });
  }
});

const flagForLanguage = (code) => {
  const regions = { AR: "SA", BG: "BG", CS: "CZ", DA: "DK", DE: "DE", EL: "GR", EN: "GB", ES: "ES", ET: "EE", FI: "FI", FR: "FR", HU: "HU", ID: "ID", IT: "IT", JA: "JP", KO: "KR", LT: "LT", LV: "LV", NB: "NO", NL: "NL", PL: "PL", PT: "PT", RO: "RO", RU: "RU", SK: "SK", SL: "SI", SV: "SE", TR: "TR", UK: "UA", ZH: "CN" };
  const region = regions[code.split("-")[0]] || "GB";
  return String.fromCodePoint(...[...region].map((letter) => 127397 + letter.charCodeAt(0)));
};

const normalizeTranslations = (translation) => [...new Set((Array.isArray(translation) ? translation : [translation]).filter(Boolean))];

const domainMatches = (hostname, rule) => {
  const normalizedRule = rule.replace(/^[a-z]+:\/\//, "").split("/")[0].replace(/^\*\./, "");
  return hostname === normalizedRule || hostname.endsWith(`.${normalizedRule}`);
};

const highlightingAllowed = (response) => {
  const hostname = window.location.hostname.toLowerCase();
  const whitelist = response.siteWhitelist || [];
  const blacklist = response.siteBlacklist || [];
  if (blacklist.some((rule) => domainMatches(hostname, rule))) return false;
  return !whitelist.length || whitelist.some((rule) => domainMatches(hostname, rule));
};

const translationAllowed = (response) => response.siteFilteringOnlyHighlight !== false || highlightingAllowed(response);

const getSelectedText = () => {
  const activeElement = document.activeElement;
  if (activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement) {
    return activeElement.value.slice(activeElement.selectionStart || 0, activeElement.selectionEnd || 0).trim();
  }
  return window.getSelection()?.toString().trim() || "";
};

const shortcutParts = (shortcut) => shortcut.split("+").map((part) => part.trim().toLowerCase()).filter(Boolean);
const normalizeShortcutKey = (key) => ({ control: "ctrl", ctrl: "ctrl", meta: "meta", command: "meta", cmd: "meta" })[key.toLowerCase()] || (key === " " ? "space" : key.toLowerCase());

document.addEventListener("keydown", (event) => {
  const normalizedKey = normalizeShortcutKey(event.key);
  const isControlKey = normalizedKey === "ctrl";
  const isAltKey = normalizedKey === "alt";
  const isShiftKey = normalizedKey === "shift";
  const isMetaKey = normalizedKey === "meta";
  const controlPressed = event.ctrlKey || event.getModifierState?.("Control") || isControlKey;
  const altPressed = event.altKey || event.getModifierState?.("Alt") || isAltKey;
  const shiftPressed = event.shiftKey || event.getModifierState?.("Shift") || isShiftKey;
  const metaPressed = event.metaKey || event.getModifierState?.("Meta") || isMetaKey;
  heldShortcutKeys.add(normalizedKey);
  if (!controlPressed && !isControlKey) {
    heldModifierKeys.delete("Ctrl");
    heldShortcutKeys.delete("ctrl");
  }
  if (!altPressed && !isAltKey) {
    heldModifierKeys.delete("Alt");
    heldShortcutKeys.delete("alt");
  }
  if (!shiftPressed && !isShiftKey) {
    heldModifierKeys.delete("Shift");
    heldShortcutKeys.delete("shift");
  }
  if (!metaPressed && !isMetaKey) heldShortcutKeys.delete("meta");
  if (controlPressed) heldModifierKeys.add("Ctrl");
  if (altPressed) heldModifierKeys.add("Alt");
  if (shiftPressed) heldModifierKeys.add("Shift");
  if (browserFindActive && normalizedKey !== "f" && normalizedKey !== "enter" && !controlPressed) browserFindActive = false;
  if (normalizedKey === "f" && controlPressed) {
    browserFindActive = true;
    heldModifierKeys.clear();
    heldShortcutKeys.clear();
    selectionModifierSnapshot = null;
    return;
  }
  if (!["Control", "Alt", "Shift", "Meta"].includes(event.key) && (controlPressed || altPressed || shiftPressed || metaPressed)) {
    selectionModifierSnapshot = {
      ctrlKey: controlPressed,
      altKey: altPressed,
      shiftKey: shiftPressed,
      metaKey: metaPressed,
      shortcutKeys: new Set(heldShortcutKeys)
    };
  }
}, true);
document.addEventListener("keyup", (event) => {
  const normalizedKey = normalizeShortcutKey(event.key);
  heldShortcutKeys.delete(normalizedKey);
  if (!event.ctrlKey) heldModifierKeys.delete("Ctrl");
  if (!event.altKey) heldModifierKeys.delete("Alt");
  if (!event.shiftKey) heldModifierKeys.delete("Shift");
}, true);
window.addEventListener("blur", () => {
  if (activeShortcut) return;
  heldModifierKeys.clear();
  heldShortcutKeys.clear();
  selectionModifierSnapshot = null;
}, true);

const commitPendingSave = async () => {
  if (!pendingSave?.addToAnki) return;
  const save = pendingSave;
  pendingSave = null;
  try {
    const response = await send({ type: "save-to-anki", original: save.original, translation: save.translation, deck: save.selectedDeck });
    if (response.error) console.warn(response.error);
  } catch (error) {
    console.warn(error.message);
  }
};

const removePopup = () => {
  popupRequestId += 1;
  const currentPopup = popup;
  popup = null;
  if (currentPopup) {
    currentPopup.classList.add("is-closing");
    setTimeout(() => currentPopup.remove(), 140);
  }
  void commitPendingSave();
};

const getPopupAnchorRect = () => {
  const selection = window.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
  if (range && selection.toString().trim()) return range.getBoundingClientRect();
  if (selectedTextSnapshotContext?.element?.getBoundingClientRect) return selectedTextSnapshotContext.element.getBoundingClientRect();
  const snapshotRect = selectedTextSnapshotContext?.rects?.find((rect) => rect.right > rect.left && rect.bottom > rect.top);
  return snapshotRect || null;
};

const positionPopup = (currentPopup, anchorRect = null) => {
  currentPopup.style.visibility = "hidden";
  const anchor = anchorRect || getPopupAnchorRect();
  const popupRect = currentPopup.getBoundingClientRect();
  const margin = 8;
  const gap = 8;
  if (!anchor) {
    currentPopup.style.left = `${Math.max(margin, (window.innerWidth - popupRect.width) / 2) + window.scrollX}px`;
    currentPopup.style.top = `${Math.max(margin, (window.innerHeight - popupRect.height) / 2) + window.scrollY}px`;
  } else {
    const anchorLeft = Number.isFinite(anchor.left) ? anchor.left : margin;
    const anchorTop = Number.isFinite(anchor.top) ? anchor.top : margin;
    const anchorBottom = Number.isFinite(anchor.bottom) ? anchor.bottom : margin;
    const maxLeft = Math.max(margin, window.innerWidth - popupRect.width - margin);
    const left = Math.min(maxLeft, Math.max(margin, anchorLeft));
    const fitsBelow = anchorBottom + gap + popupRect.height <= window.innerHeight - margin;
    const top = fitsBelow
      ? anchorBottom + gap
      : anchorTop - popupRect.height - gap >= margin
        ? anchorTop - popupRect.height - gap
        : Math.max(margin, window.innerHeight - popupRect.height - margin);
    currentPopup.style.left = `${left + window.scrollX}px`;
    currentPopup.style.top = `${top + window.scrollY}px`;
  }
  currentPopup.style.visibility = "visible";
};

const createPopup = async (original, translation, error = "", savedWord = null, anchorRect = null) => {
  removePopup();
  const requestId = ++popupRequestId;
  pendingSave = null;
  popup = document.createElement("aside");
  popup.className = "anki-translator-popup";
  popupInteractionStarted = false;
  popup.__translation = translation;
  popup.__error = error;
  popup.innerHTML = `<button type="button" class="anki-translator-close" aria-label="Close">×</button><div class="anki-translator-original"></div><div class="anki-translator-result"></div><div class="anki-translator-languages"><select class="anki-translator-source"></select><select class="anki-translator-target"></select></div><div class="anki-translator-anki-row"><label class="anki-translator-option"><input class="anki-translator-add" type="checkbox"> Add to Anki</label><select class="anki-translator-deck"></select></div>`;
  popup.querySelector(".anki-translator-original").textContent = original;
  popup.querySelector(".anki-translator-result").textContent = translation || (error ? "" : "Translating…");
  document.body.appendChild(popup);
  popup.addEventListener("pointerdown", (event) => {
    popupInteractionStarted = true;
    event.stopPropagation();
  });
  suppressEmptySelectionUntil = Date.now() + 500;
  positionPopup(popup, anchorRect);
  const themeSettings = await send({ type: "get-settings" });
  if (requestId !== popupRequestId) return;
  popup.dataset.theme = themeSettings.theme || "light";
  let existingDecks = [];
  const locale = themeSettings.interfaceLanguage === "ru" ? "ru" : "en";
  const [translations, ankiStatus] = await Promise.all([
    fetch(chrome.runtime.getURL(`src/locales/${locale}.json`)).then((response) => response.json()).catch(() => ({})),
    send({ type: "check-anki" })
  ]);
  if (requestId !== popupRequestId) return;
  if (popup.__error) {
    const errorElement = document.createElement("div");
    errorElement.className = "anki-translator-error";
    errorElement.textContent = popup.__error;
    popup.querySelector(".anki-translator-result")?.remove();
    popup.querySelector(".anki-translator-languages")?.remove();
    popup.querySelector(".anki-translator-anki-row")?.remove();
    popup.append(errorElement);
  } else {
    popup.querySelector(".anki-translator-close").setAttribute("aria-label", translations.close || "Close");
    popup.querySelector(".anki-translator-option").lastChild.textContent = ` ${translations.addToAnki || "Add to Anki"}`;
    const resultElement = popup.querySelector(".anki-translator-result");
    const deckSelect = popup.querySelector(".anki-translator-deck");
    const sourceSelect = popup.querySelector(".anki-translator-source");
    const targetSelect = popup.querySelector(".anki-translator-target");
    const languageOptions = LANGUAGES.map(([code, name]) => `<option value="${code}">${name}${code ? ` ${flagForLanguage(code)}` : ""}</option>`).join("");
    sourceSelect.innerHTML = languageOptions;
    targetSelect.innerHTML = languageOptions.replace('<option value="">Auto-detect</option>', "");
    const [decks, existingResult] = await Promise.all([
      send({ type: "get-decks" }),
      send({ type: "find-word-decks", original })
    ]);
    if (requestId !== popupRequestId) return;
    const availableDecks = decks.decks || [];
    existingDecks = existingResult.decks || [];
    const settings = themeSettings;
    const initialDeck = savedWord?.deck || settings.selectedDeck || availableDecks[0] || "";
    deckSelect.innerHTML = availableDecks.length
      ? availableDecks.map((deck) => `<option value="${deck.replaceAll('"', '&quot;')}">${deck}</option>`).join("")
      : `<option value="">${translations.selectDeck || "Select a deck"}</option>`;
    deckSelect.value = initialDeck;
    if (requestId !== popupRequestId) return;
    sourceSelect.value = settings.sourceLang || "";
    targetSelect.value = settings.targetLang || "EN";
    if (!targetSelect.value) targetSelect.value = "EN";
    const translationValue = normalizeTranslations(popup.__translation)[0] || "";
    resultElement.textContent = translationValue;
    const addCheckbox = popup.querySelector(".anki-translator-add");
    addCheckbox.checked = Boolean(savedWord || settings.popupAddToAnki);
    pendingSave = { original, translation: translationValue, selectedDeck: initialDeck, addToAnki: addCheckbox.checked };
    popup.querySelector(".anki-translator-close").addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      removePopup();
    });
    deckSelect.addEventListener("change", () => {
      pendingSave.selectedDeck = deckSelect.value;
      send({ type: "save-settings", settings: { selectedDeck: deckSelect.value } });
    });
    addCheckbox.addEventListener("change", (event) => {
      pendingSave.addToAnki = event.target.checked;
      send({ type: "save-settings", settings: { popupAddToAnki: event.target.checked } });
      if (!event.target.checked && savedWord) {
        send({ type: "remove-word", original, deck: initialDeck, deleteFromAnki: true });
        removePopup();
      }
    });
    const retranslate = async () => {
      const result = await send({ type: "translate", text: original, sourceLang: sourceSelect.value, targetLang: targetSelect.value });
      if (result.translation) {
        const nextTranslation = normalizeTranslations(result.translation)[0] || "";
        resultElement.textContent = nextTranslation;
        pendingSave.translation = nextTranslation;
        send({ type: "save-settings", settings: { sourceLang: sourceSelect.value, targetLang: targetSelect.value } });
      }
    };
    sourceSelect.addEventListener("change", retranslate);
    targetSelect.addEventListener("change", retranslate);
  }
  if (!ankiStatus.running) {
    const warningElement = document.createElement("div");
    warningElement.className = "anki-translator-anki-status";
    warningElement.textContent = translations.ankiNotRunning || "";
    const ankiRow = popup.querySelector(".anki-translator-anki-row");
    if (ankiRow) ankiRow.before(warningElement);
    else popup.append(warningElement);
  }
  if (existingDecks.length) {
    const statusElement = document.createElement("div");
    statusElement.className = "anki-translator-existing-status";
    statusElement.textContent = `${translations.alreadyInDeck || "The selected text is already added to"} "${existingDecks.join('", "')}".`;
    popup.append(statusElement);
  }
  if (requestId !== popupRequestId) return;
  positionPopup(popup, anchorRect);
  popup.addEventListener("click", (event) => {
    if (!event.target.closest(".anki-translator-deck-picker")) popup.querySelector(".anki-translator-deck-picker")?.classList.remove("open");
    event.stopPropagation();
  });
  popup.addEventListener("keydown", () => popup.querySelector(".anki-translator-deck-picker")?.classList.remove("open"), true);
};

const showTranslation = async (original, translation, anchorRect = null) => createPopup(original, translation, "", null, anchorRect);

const requestTranslationPopup = async (text, anchorRect = null, overrides = {}, translationStartedAt = performance.now(), isCurrent = () => true) => {
  const response = await send({ type: "translate", text, ...overrides });
  const providerResponseAt = performance.now();
  if (!isCurrent()) return { response, currentPopup: null };
  const popupPromise = createPopup(text, response.translation || "", response.error || "", null, anchorRect);
  const currentPopup = popup;
  currentPopup.dataset.translationStartedAt = String(translationStartedAt);
  currentPopup.dataset.providerResponseAt = String(providerResponseAt);
  currentPopup.dataset.popupVisibleAt = String(performance.now());
  await popupPromise;
  return { response, currentPopup };
};

const removeTranslationIcon = () => {
  translationIcon?.remove();
  translationIcon = null;
};

const closeContentMenus = () => {
  document.querySelectorAll(".anki-translator-deck-picker.open").forEach((menu) => menu.classList.remove("open"));
};

["keydown", "keypress", "keyup", "input", "beforeinput"].forEach((eventName) => {
  window.addEventListener(eventName, closeContentMenus, true);
});

["input", "beforeinput"].forEach((eventName) => {
  window.addEventListener(eventName, (event) => {
    if (popup && !popup.contains(event.target)) popupInteractionStarted = true;
  }, true);
});

window.addEventListener("keydown", (event) => {
  if (popup && !popup.contains(event.target) && !["Control", "Alt", "Shift", "Meta"].includes(event.key)) popupInteractionStarted = true;
}, true);

const showTranslationIcon = (text, rect) => {
  if (!text || !rect) return;
  removeTranslationIcon();
  translationIcon = document.createElement("button");
  translationIcon.className = "anki-translator-icon";
  translationIcon.type = "button";
  const iconButton = translationIcon;
  const iconImage = document.createElement("img");
  iconImage.src = chrome.runtime.getURL(TRANSLATION_ICON_PATH);
  iconImage.alt = "";
  iconImage.addEventListener("error", () => {
    iconImage.remove();
    iconButton.textContent = "T";
  }, { once: true });
  translationIcon.append(iconImage);
  translationIcon.title = "Translate selection";
  translationIcon.style.left = `${Math.max(8, rect.left + window.scrollX)}px`;
  translationIcon.style.top = `${rect.bottom + window.scrollY + 6}px`;
  translationIcon.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  translationIcon.addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  translationIcon.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const translationStartedAt = performance.now();
    removeTranslationIcon();
    await requestTranslationPopup(text, rect, {}, translationStartedAt);
  });
  document.body.appendChild(translationIcon);
};

const clearHighlights = () => {
  let mark = document.querySelector(".anki-translator-highlight");
  while (mark) {
    mark.replaceWith(...mark.childNodes);
    mark = document.querySelector(".anki-translator-highlight");
  }
};

let highlightObserver;
let highlightObserverTimer;

const observeHighlightChanges = () => {
  if (!document.body) return;
  if (!highlightObserver) {
    highlightObserver = new MutationObserver((mutations) => {
      const contentChanged = mutations.some((mutation) => {
        const target = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
        const targetIgnored = target?.closest(".anki-translator-popup, .anki-translator-highlight, input, textarea, [contenteditable=\"true\"]");
        if (targetIgnored) return false;
        const changedNodes = [...mutation.addedNodes, ...mutation.removedNodes];
        if (!changedNodes.length) return !targetIgnored;
        return changedNodes.some((node) => !(node instanceof Element) || !node.closest(".anki-translator-popup, .anki-translator-highlight, input, textarea, [contenteditable=\"true\"]"));
      });
      if (!contentChanged) return;
      clearTimeout(highlightObserverTimer);
      highlightObserverTimer = setTimeout(() => void highlight(), 100);
    });
  }
  highlightObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
};

const applyHighlights = async () => {
  highlightObserver?.disconnect();
  try {
    const response = await send({ type: "get-highlights" });
    if (response.error) return;
    clearHighlights();
    if (response.highlightEnabled === false) return;
    if (!highlightingAllowed(response)) return;
    document.documentElement.style.setProperty("--anki-translator-highlight-theme", response.theme || "light");
    if (!response?.words?.length) return;
    const selectedDecks = response.decks?.filter(Boolean) || [];
    const words = response.words.filter((word) => !selectedDecks.length || selectedDecks.includes(word.deck));
    const phrases = words.flatMap((word) => response.mode === "original" ? [word.original] : response.mode === "translation" ? [word.translation] : [word.original, word.translation]);
    const pattern = phrases.filter(Boolean).sort((a, b) => b.length - a.length).map((value) => {
      const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const singleWordCharacter = value.length === 1 && /[\p{L}\p{N}]/u.test(value);
      return response.wholeWords || singleWordCharacter ? `\\b${escapedValue}\\b` : escapedValue;
    }).join("|");
    if (!pattern) return;
    const regexSource = response.wholeWords ? `\\b(${pattern})\\b` : `(${pattern})`;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.parentElement.closest(".anki-translator-popup, script, style, textarea, input, [contenteditable=\"true\"]")) continue;
      if (new RegExp(regexSource, "i").test(node.nodeValue)) nodes.push(node);
    }
    nodes.forEach((node) => {
      const fragment = document.createDocumentFragment();
      let last = 0;
      const regex = new RegExp(regexSource, "gi");
      node.nodeValue.replace(regex, (match, _group, offset) => {
        fragment.append(node.nodeValue.slice(last, offset));
        const mark = document.createElement("mark");
        mark.className = "anki-translator-highlight";
        const hex = response.color || "#fff0a8";
        const opacity = Number(response.opacity ?? 0.65);
        const color = hex.replace("#", "");
        const channels = color.length === 3 ? color.split("").map((channel) => channel + channel) : [color.slice(0, 2), color.slice(2, 4), color.slice(4, 6)];
        mark.style.color = "inherit";
        mark.style.webkitTextFillColor = "inherit";
        mark.style.backgroundColor = `rgba(${channels.map((channel) => parseInt(channel, 16)).join(", ")}, ${opacity})`;
        const normalizedMatch = match.toLowerCase();
        const matchedWord = words.find((word) => [word.original, word.translation].some((value) => {
          const normalizedValue = value.toLowerCase();
          return normalizedValue === normalizedMatch || (!response.wholeWords && normalizedValue.includes(normalizedMatch));
        }));
        if (matchedWord) {
          mark.dataset.original = matchedWord.original;
          mark.dataset.translation = matchedWord.translation;
          mark.dataset.deck = matchedWord.deck;
        }
        mark.textContent = match;
        fragment.append(mark);
        last = offset + match.length;
        return match;
      });
      fragment.append(node.nodeValue.slice(last));
      node.parentNode.replaceChild(fragment, node);
    });
  } finally {
    observeHighlightChanges();
  }
};

let highlightRunning = false;
let highlightQueued = false;
const highlight = async () => {
  if (highlightRunning) {
    highlightQueued = true;
    return;
  }
  highlightRunning = true;
  try {
    await applyHighlights();
  } finally {
    highlightRunning = false;
    if (highlightQueued) {
      highlightQueued = false;
      void highlight();
    }
  }
};

let selectionTimer;
let lastTranslatedSelection = "";
let selectedTextSnapshot = "";
let selectedTextSnapshotContext = null;
let lastTranslationTime = 0;
let activeShortcut = null;
let pendingShortcutKeyDown = null;
let suppressEmptySelectionUntil = 0;
let suppressSelectionUntil = 0;
let editablePointerDown = null;
let lastPointerDownAt = 0;
let lastPointerDownTarget = null;

const isEditableTarget = (target) => target instanceof HTMLInputElement
  || target instanceof HTMLTextAreaElement
  || target?.isContentEditable
  || Boolean(target?.closest?.("input, textarea, [contenteditable=\"true\"]"));

const rememberSelectedText = (text) => {
  selectedTextSnapshot = text;
  const activeElement = document.activeElement;
  if (activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement) {
    selectedTextSnapshotContext = { element: activeElement, rects: [] };
    return;
  }
  const selection = window.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
  selectedTextSnapshotContext = {
    element: null,
    rects: range ? [...range.getClientRects()].map((rect) => ({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom })) : []
  };
};

const selectedTextContextContains = (event) => {
  const context = selectedTextSnapshotContext;
  if (!context) return false;
  if (context.element) return context.element.contains(event.target);
  return context.rects.some((rect) => event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom);
};

const translateSelectedText = async (text, event = null, force = false) => {
  const requestToken = ++selectionTranslationToken;
  const translationStartedAt = performance.now();
  if (Date.now() < suppressSelectionUntil) return;
  const eventTarget = event?.target || null;
  if (popup?.contains(eventTarget) || eventTarget?.closest?.(".anki-translator-popup") || popup?.contains(window.getSelection()?.anchorNode)) return;
  if (browserFindActive) return;
  if (!text) {
    if (Date.now() < suppressEmptySelectionUntil) return;
    if (popup && !popupInteractionStarted && !isEditableTarget(document.activeElement)) return;
    lastTranslatedSelection = "";
    removeTranslationIcon();
    if (popup) removePopup();
    return;
  }
  if (text.length > 500) return;
  rememberSelectedText(text);
  const anchorRect = getPopupAnchorRect();
  const now = Date.now();
  if (!force && text === lastTranslatedSelection && now - lastTranslationTime < 500) return;
  lastTranslatedSelection = text;
  lastTranslationTime = now;
  removeTranslationIcon();
  const settings = await send({ type: "get-settings" });
  if (requestToken !== selectionTranslationToken || Date.now() < suppressSelectionUntil) return;
  if (!translationAllowed(settings)) return;
  const iconEnabled = settings.showTranslationIcon || settings.translationTrigger === "icon";
  if (iconEnabled) {
    showTranslationIcon(text, anchorRect);
    return;
  }
  if (settings.requireShortcut && settings.shortcutModifier) {
    if (!shortcutIsHeld(settings, event)) return;
    if (activeShortcut && Date.now() - activeShortcut.startedAt < activeShortcut.holdDuration) return;
    if (activeShortcut) activeShortcut.shown = true;
  }
  if (settings.translationTrigger !== "selection") return;
  const { currentPopup } = await requestTranslationPopup(text, anchorRect, {}, translationStartedAt, () => requestToken === selectionTranslationToken && Date.now() >= suppressSelectionUntil);
  if (requestToken !== selectionTranslationToken || Date.now() < suppressSelectionUntil) {
    if (popup === currentPopup) removePopup();
  }
};

document.addEventListener("pointerup", (event) => {
  const pointerState = editablePointerDown;
  editablePointerDown = null;
  if (pointerState?.suppressClick && !pointerState.moved) return;
  if (isEditableTarget(event.target) && getSelectedText()) suppressSelectionUntil = 0;
  setTimeout(() => {
    if (Date.now() < suppressSelectionUntil) return;
    const text = getSelectedText();
    if (text) {
      rememberSelectedText(text);
      translateSelectedText(text, event);
    }
  }, 0);
}, true);

document.addEventListener("selectionchange", () => {
  clearTimeout(selectionTimer);
  if (Date.now() < suppressSelectionUntil) return;
  const selectionText = getSelectedText();
  if (selectionText) rememberSelectedText(selectionText);
  else {
    selectedTextSnapshot = "";
    selectedTextSnapshotContext = null;
  }
  const modifierSnapshot = selectionModifierSnapshot;
  selectionModifierSnapshot = null;
  selectionTimer = setTimeout(() => translateSelectedText(getSelectedText(), modifierSnapshot), 250);
});

document.addEventListener("click", (event) => {
  if (translationIcon && !translationIcon.contains(event.target)) removeTranslationIcon();
  const mark = event.target.closest?.(".anki-translator-highlight");
  if (mark) {
    event.stopPropagation();
    void send({ type: "get-settings" }).then((settings) => {
      if (translationAllowed(settings)) createPopup(mark.dataset.original, mark.dataset.translation, "", { original: mark.dataset.original, translation: mark.dataset.translation, deck: mark.dataset.deck }, mark.getBoundingClientRect());
    });
    return;
  }
  if (popup && Date.now() >= doubleClickGuardUntil && event.detail < 2 && !event.composedPath().includes(popup)) removePopup();
  if (!event.target.closest?.(".anki-translator-popup")) {
    setTimeout(() => {
      const text = getSelectedText();
      if (text) {
        rememberSelectedText(text);
      } else if (!selectedTextContextContains(event)) {
        selectedTextSnapshot = "";
        selectedTextSnapshotContext = null;
      }
    }, 0);
  }
});

document.addEventListener("pointerdown", (event) => {
  const isDoubleClick = event.detail >= 2
    || (event.target === lastPointerDownTarget && event.timeStamp - lastPointerDownAt < 500);
  lastPointerDownAt = event.timeStamp;
  lastPointerDownTarget = event.target;
  if (isDoubleClick) doubleClickGuardUntil = Date.now() + 500;
  if (isEditableTarget(event.target) && (!popup || !event.composedPath().includes(popup))) {
    editablePointerDown = {
      moved: false,
      suppressClick: Boolean(popup || selectedTextSnapshot)
    };
    suppressSelectionUntil = Date.now() + 800;
    clearTimeout(selectionTimer);
    selectionTranslationToken += 1;
    selectedTextSnapshot = "";
    selectedTextSnapshotContext = null;
    selectionModifierSnapshot = null;
  }
  if (event.target.closest?.(".anki-translator-highlight")) suppressEmptySelectionUntil = Date.now() + 500;
  if (popup && !isDoubleClick && Date.now() >= doubleClickGuardUntil && !event.composedPath().includes(popup)) removePopup();
});

document.addEventListener("pointermove", () => {
  if (editablePointerDown) editablePointerDown.moved = true;
}, true);

document.addEventListener("keydown", (event) => {
  popup?.querySelector(".anki-translator-deck-picker")?.classList.remove("open");
  if (event.key === "Escape" && popup) removePopup();
}, true);

document.addEventListener("dblclick", async (event) => {
  if (popup?.contains(event.target) || event.target.closest?.(".anki-translator-popup")) return;
  const text = getSelectedText();
  if (!text) return;
  const translationStartedAt = performance.now();
  rememberSelectedText(text);
  const anchorRect = getPopupAnchorRect();
  setTimeout(() => {
    const delayedSelectedText = getSelectedText();
    if (delayedSelectedText) rememberSelectedText(delayedSelectedText);
  }, 0);
  const settings = await send({ type: "get-settings" });
  if (settings.showTranslationIcon || settings.translationTrigger === "icon") {
    showTranslationIcon(text, anchorRect);
    return;
  }
  if (settings.translationTrigger === "selection") {
    if (settings.requireShortcut && settings.shortcutModifier && !shortcutIsHeld(settings, event)) return;
    suppressSelectionUntil = 0;
    void requestTranslationPopup(text, anchorRect, {}, translationStartedAt);
    return;
  }
  if (settings.translationTrigger !== "double-click") return;
  if (!translationAllowed(settings)) return;
  if (settings.requireShortcut && settings.shortcutModifier && !shortcutIsHeld(settings, event)) return;
  await requestTranslationPopup(text, anchorRect, {}, translationStartedAt);
}, true);

const getShortcutDefinition = (shortcut) => {
  const parts = shortcutParts(shortcut || "Y");
  const modifierParts = ["ctrl", "control", "alt", "shift", "cmd", "command", "meta"];
  const key = parts.filter((part) => !modifierParts.includes(part)).pop()
    || (parts.some((part) => ["ctrl", "control"].includes(part)) ? "ctrl" : parts.some((part) => ["cmd", "command", "meta"].includes(part)) ? "meta" : parts.includes("alt") ? "alt" : parts.includes("shift") ? "shift" : "y");
  return {
    key,
    wantsControl: parts.includes("ctrl") || parts.includes("control"),
    wantsAlt: parts.includes("alt"),
    wantsShift: parts.includes("shift"),
    wantsMeta: parts.includes("cmd") || parts.includes("command") || parts.includes("meta")
  };
};

const shortcutMatches = (event, definition) => normalizeShortcutKey(event.key) === definition.key
  && (event.ctrlKey || event.getModifierState?.("Control") || normalizeShortcutKey(event.key) === "ctrl") === definition.wantsControl
  && (event.altKey || event.getModifierState?.("Alt") || normalizeShortcutKey(event.key) === "alt") === definition.wantsAlt
  && (event.shiftKey || event.getModifierState?.("Shift") || normalizeShortcutKey(event.key) === "shift") === definition.wantsShift
  && (event.metaKey || event.getModifierState?.("Meta") || normalizeShortcutKey(event.key) === "meta") === definition.wantsMeta;

const shortcutIsHeld = (settings, event = null) => {
  const definition = getShortcutDefinition(settings.shortcutModifier);
  const source = event || {};
  const controlHeld = source.ctrlKey ?? heldModifierKeys.has("Ctrl");
  const altHeld = source.altKey ?? heldModifierKeys.has("Alt");
  const shiftHeld = source.shiftKey ?? heldModifierKeys.has("Shift");
  const metaHeld = source.metaKey ?? heldShortcutKeys.has("meta");
  const shortcutKeys = source.shortcutKeys || heldShortcutKeys;
  const modifierKeyHeld = {
    ctrl: controlHeld,
    control: controlHeld,
    alt: altHeld,
    shift: shiftHeld,
    meta: metaHeld,
    cmd: metaHeld,
    command: metaHeld
  }[definition.key];
  const keyHeld = modifierKeyHeld ?? shortcutKeys.has(definition.key);
  return controlHeld === definition.wantsControl
    && altHeld === definition.wantsAlt
    && shiftHeld === definition.wantsShift
    && metaHeld === definition.wantsMeta
    && keyHeld;
};

const showShortcutTranslation = async (text, shortcutState) => {
  if (!text || shortcutState.shown || popup) return;
  const translationStartedAt = performance.now();
  shortcutState.shown = true;
  if (activeShortcut === shortcutState) activeShortcut = null;
  const anchorRect = getPopupAnchorRect();
  const settings = await send({ type: "get-settings" });
  if (!translationAllowed(settings)) return;
  await requestTranslationPopup(text, anchorRect, {}, translationStartedAt);
};

const shortcutText = (shortcutState) => shortcutState.textAtKeydown || getSelectedText() || selectedTextSnapshot;

const tryShortcutTranslation = (shortcutState) => {
  if (activeShortcut !== shortcutState || shortcutState.shown || Date.now() - shortcutState.startedAt < shortcutState.holdDuration) return;
  showShortcutTranslation(shortcutText(shortcutState), shortcutState);
};

document.addEventListener("keydown", async (event) => {
  if (event.repeat || activeShortcut) return;
  const textAtKeydown = getSelectedText();
  const keyDownState = { key: normalizeShortcutKey(event.key), startedAt: Date.now(), released: false };
  pendingShortcutKeyDown = keyDownState;
  const settings = await send({ type: "get-settings" });
  if (pendingShortcutKeyDown !== keyDownState) return;
  const definition = getShortcutDefinition(settings.shortcutModifier);
  if (!shortcutMatches(event, definition)) {
    pendingShortcutKeyDown = null;
    return;
  }
  browserFindActive = false;
  event.preventDefault();
  const shortcutState = { ...definition, startedAt: keyDownState.startedAt, textAtKeydown, holdDuration: Number(settings.shortcutHoldDuration) || 0, shown: false, timer: null };
  pendingShortcutKeyDown = null;
  activeShortcut = shortcutState;
  if (keyDownState.released) {
    activeShortcut = null;
    if (Date.now() - shortcutState.startedAt >= shortcutState.holdDuration) showShortcutTranslation(shortcutText(shortcutState), shortcutState);
    return;
  }
  if (shortcutState.holdDuration) shortcutState.timer = setTimeout(() => tryShortcutTranslation(shortcutState), shortcutState.holdDuration);
  else tryShortcutTranslation(shortcutState);
});

document.addEventListener("keyup", (event) => {
  const shortcutState = activeShortcut;
  if (!shortcutState) {
    if (pendingShortcutKeyDown && normalizeShortcutKey(event.key) === pendingShortcutKeyDown.key) pendingShortcutKeyDown.released = true;
    if (browserFindActive) return;
    void (async () => {
      const settings = await send({ type: "get-settings" });
      const definition = getShortcutDefinition(settings.shortcutModifier);
      const modifierOnly = ["ctrl", "alt", "shift", "meta"].includes(definition.key);
      if (!modifierOnly || !shortcutMatches(event, definition)) return;
      const text = getSelectedText() || selectedTextSnapshot;
      if (!text) return;
      showShortcutTranslation(text, { ...definition, shown: false });
    })();
    return;
  }
  if (normalizeShortcutKey(event.key) !== shortcutState.key) return;
  clearTimeout(shortcutState.timer);
  activeShortcut = null;
  if (Date.now() - shortcutState.startedAt >= shortcutState.holdDuration) {
    showShortcutTranslation(shortcutText(shortcutState), shortcutState);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "get-selection") {
    sendResponse({ text: window.getSelection()?.toString().trim() });
  } else if (message.type === "show-error") {
    createPopup("", "", message.message);
  } else if (message.type === "refresh-highlights") {
    highlight();
  } else if (message.type === "show-translation") {
    void send({ type: "get-settings" }).then((settings) => {
      if (translationAllowed(settings)) showTranslation(message.original, message.translation);
    });
  }
  return true;
});

observeHighlightChanges();
highlight();
setTimeout(highlight, 800);
chrome.storage?.onChanged?.addListener(() => highlight());
