let popup;
let pendingSave;
let translationIcon;
let popupRequestId = 0;
const LANGUAGES = [
  ["", "Auto-detect"], ["AR", "Arabic"], ["BG", "Bulgarian"], ["CS", "Czech"], ["DA", "Danish"],
  ["DE", "German"], ["EL", "Greek"], ["EN", "English"], ["EN-GB", "English (British)"], ["EN-US", "English (American)"], ["ES", "Spanish"], ["ET", "Estonian"],
  ["FI", "Finnish"], ["FR", "French"], ["HU", "Hungarian"], ["ID", "Indonesian"], ["IT", "Italian"], ["JA", "Japanese"], ["KO", "Korean"],
  ["LT", "Lithuanian"], ["LV", "Latvian"], ["NB", "Norwegian"], ["NL", "Dutch"], ["PL", "Polish"], ["PT", "Portuguese"], ["PT-BR", "Portuguese (Brazilian)"], ["PT-PT", "Portuguese (European)"],
  ["RO", "Romanian"], ["RU", "Russian"], ["SK", "Slovak"], ["SL", "Slovenian"], ["SV", "Swedish"], ["TR", "Turkish"], ["UK", "Ukrainian"], ["ZH", "Chinese"]
];

const send = (message) => new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));

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
  currentPopup?.remove();
  void commitPendingSave();
};

const createPopup = async (original, translation, error = "", savedWord = null) => {
  removePopup();
  const requestId = ++popupRequestId;
  pendingSave = null;
  popup = document.createElement("aside");
  popup.className = "anki-translator-popup";
  const themeSettings = await send({ type: "get-settings" });
  popup.dataset.theme = themeSettings.theme || "light";
  if (error) {
    const errorElement = document.createElement("div");
    errorElement.className = "anki-translator-error";
    errorElement.textContent = error;
    popup.append(errorElement);
  } else {
    popup.innerHTML = `<button type="button" class="anki-translator-close" aria-label="Close">×</button><div class="anki-translator-original"></div><div class="anki-translator-result"></div><div class="anki-translator-languages"><select class="anki-translator-source"></select><select class="anki-translator-target"></select></div><label class="anki-translator-option"><input class="anki-translator-add" type="checkbox"> Add to Anki</label><select class="anki-translator-deck"></select>`;
    popup.querySelector(".anki-translator-original").textContent = original;
    const resultElement = popup.querySelector(".anki-translator-result");
    const deckSelect = popup.querySelector(".anki-translator-deck");
    const sourceSelect = popup.querySelector(".anki-translator-source");
    const targetSelect = popup.querySelector(".anki-translator-target");
    const languageOptions = LANGUAGES.map(([code, name]) => `<option value="${code}">${name}${code ? ` ${flagForLanguage(code)}` : ""}</option>`).join("");
    sourceSelect.innerHTML = languageOptions;
    targetSelect.innerHTML = languageOptions.replace('<option value="">Auto-detect</option>', "");
    const decks = await send({ type: "get-decks" });
    if (requestId !== popupRequestId) return;
    const availableDecks = decks.decks || [];
    const existingResult = await send({ type: "find-word-decks", original });
    if (requestId !== popupRequestId) return;
    const existingDecks = existingResult.decks || [];
    const settings = themeSettings;
    const initialDeck = existingDecks[0] || settings.selectedDeck || availableDecks[0] || "";
    deckSelect.innerHTML = availableDecks.map((deck) => `<option value="${deck.replaceAll('"', '&quot;')}">${deck}</option>`).join("");
    deckSelect.value = initialDeck;
    if (requestId !== popupRequestId) return;
    sourceSelect.value = settings.sourceLang || "";
    targetSelect.value = settings.targetLang || "EN";
    const translationValue = normalizeTranslations(translation)[0] || "";
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
  const selection = window.getSelection()?.getRangeAt(0);
  const rect = selection?.getBoundingClientRect();
  popup.style.left = `${Math.min(window.innerWidth - 330, Math.max(8, (rect?.left || 20) + window.scrollX))}px`;
  popup.style.top = `${(rect?.bottom || 30) + window.scrollY + 8}px`;
  document.body.appendChild(popup);
  popup.addEventListener("click", (event) => event.stopPropagation());
  popup.addEventListener("pointerdown", (event) => event.stopPropagation());
};

const showTranslation = async (original, translation) => createPopup(original, translation);

const removeTranslationIcon = () => {
  translationIcon?.remove();
  translationIcon = null;
};

const showTranslationIcon = (text, rect) => {
  removeTranslationIcon();
  translationIcon = document.createElement("button");
  translationIcon.className = "anki-translator-icon";
  translationIcon.type = "button";
  translationIcon.textContent = "T";
  translationIcon.title = "Translate selection";
  translationIcon.style.left = `${Math.max(8, rect.left + window.scrollX)}px`;
  translationIcon.style.top = `${rect.bottom + window.scrollY + 6}px`;
  translationIcon.addEventListener("mousedown", (event) => event.preventDefault());
  translationIcon.addEventListener("click", async () => {
    removeTranslationIcon();
    const response = await send({ type: "translate", text });
    if (response.error) createPopup(text, "", response.error);
    else showTranslation(text, response.translation);
  });
  document.body.appendChild(translationIcon);
};

const clearHighlights = () => {
  document.querySelectorAll(".anki-translator-highlight").forEach((mark) => mark.replaceWith(document.createTextNode(mark.textContent)));
};

const highlight = async () => {
  clearHighlights();
  const response = await send({ type: "get-highlights" });
  if (!highlightingAllowed(response)) return;
  document.documentElement.style.setProperty("--anki-translator-highlight-theme", response.theme || "light");
  if (!response?.words?.length) return;
  const selectedDecks = response.decks?.filter(Boolean) || [];
  const words = response.words.filter((word) => !selectedDecks.length || selectedDecks.includes(word.deck));
  const phrases = words.flatMap((word) => response.mode === "original" ? [word.original] : response.mode === "translation" ? [word.translation] : [word.original, word.translation]);
  const pattern = phrases.filter(Boolean).sort((a, b) => b.length - a.length).map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  if (!pattern) return;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.parentElement.closest(".anki-translator-popup, script, style, textarea, input")) continue;
    if (new RegExp(`\\b(${pattern})\\b`, "i").test(node.nodeValue)) nodes.push(node);
  }
  nodes.forEach((node) => {
    const fragment = document.createDocumentFragment();
    let last = 0;
    const regex = new RegExp(`\\b(${pattern})\\b`, "gi");
    node.nodeValue.replace(regex, (match, _group, offset) => {
      fragment.append(node.nodeValue.slice(last, offset));
      const mark = document.createElement("mark");
      mark.className = "anki-translator-highlight";
      const hex = response.color || "#fff0a8";
      const opacity = Number(response.opacity ?? 0.65);
      const color = hex.replace("#", "");
      const channels = color.length === 3 ? color.split("").map((channel) => channel + channel) : [color.slice(0, 2), color.slice(2, 4), color.slice(4, 6)];
      mark.style.backgroundColor = `rgba(${channels.map((channel) => parseInt(channel, 16)).join(", ")}, ${opacity})`;
      const matchedWord = words.find((word) => word.original.toLowerCase() === match.toLowerCase() || word.translation.toLowerCase() === match.toLowerCase());
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
};

document.addEventListener("mouseup", async (event) => {
  if (popup?.contains(event.target) || event.target.closest?.(".anki-translator-popup") || translationIcon?.contains(event.target)) return;
  removeTranslationIcon();
  const text = window.getSelection()?.toString().trim();
  if (!text || text.length > 500) return;
  const settings = await send({ type: "get-settings" });
  if (settings.translationTrigger === "icon") {
    const range = window.getSelection()?.getRangeAt(0);
    if (range) showTranslationIcon(text, range.getBoundingClientRect());
    return;
  }
  if (settings.translationTrigger !== "selection") return;
  const response = await send({ type: "translate", text });
  if (response.error) createPopup(text, "", response.error);
  else showTranslation(text, response.translation);
});

document.addEventListener("click", (event) => {
  if (translationIcon && !translationIcon.contains(event.target)) removeTranslationIcon();
  const mark = event.target.closest?.(".anki-translator-highlight");
  if (mark) {
    event.stopPropagation();
    createPopup(mark.dataset.original, mark.dataset.translation, "", { original: mark.dataset.original, translation: mark.dataset.translation, deck: mark.dataset.deck });
    return;
  }
  if (popup && !event.composedPath().includes(popup)) removePopup();
});

document.addEventListener("pointerdown", (event) => {
  if (popup && !event.composedPath().includes(popup)) removePopup();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && popup) removePopup();
});

document.addEventListener("dblclick", async (event) => {
  if (popup?.contains(event.target) || event.target.closest?.(".anki-translator-popup")) return;
  const settings = await send({ type: "get-settings" });
  if (settings.translationTrigger !== "double-click") return;
  const text = window.getSelection()?.toString().trim();
  if (!text) return;
  const response = await send({ type: "translate", text });
  if (response.error) createPopup(text, "", response.error);
  else showTranslation(text, response.translation);
});

document.addEventListener("keydown", async (event) => {
  const settings = await send({ type: "get-settings" });
  if (settings.translationTrigger !== "shortcut") return;
  const shortcut = settings.shortcutKey || "Ctrl+Shift+Y";
  const parts = shortcut.split("+").map((part) => part.trim().toLowerCase()).filter(Boolean);
  const key = parts[parts.length - 1];
  const wantsControl = parts.includes("ctrl") || parts.includes("control");
  const wantsAlt = parts.includes("alt");
  const wantsShift = parts.includes("shift");
  const wantsMeta = parts.includes("cmd") || parts.includes("command") || parts.includes("meta");
  const pressedKey = event.key.toLowerCase() === " " ? "space" : event.key.toLowerCase();
  if (pressedKey !== key || event.ctrlKey !== wantsControl || event.altKey !== wantsAlt || event.shiftKey !== wantsShift || event.metaKey !== wantsMeta) return;
  const text = window.getSelection()?.toString().trim();
  if (!text) return;
  event.preventDefault();
  const response = await send({ type: "translate", text });
  if (response.error) createPopup(text, "", response.error);
  else showTranslation(text, response.translation);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "get-selection") {
    sendResponse({ text: window.getSelection()?.toString().trim() });
  } else if (message.type === "show-error") {
    createPopup("", "", message.message);
  } else if (message.type === "refresh-highlights") {
    highlight();
  } else if (message.type === "show-translation") {
    showTranslation(message.original, message.translation);
  }
  return true;
});

highlight();
setTimeout(highlight, 800);
chrome.storage?.onChanged?.addListener(() => highlight());
