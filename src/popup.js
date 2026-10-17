const $ = (id) => document.getElementById(id);
let decks = [];
let models = [];
let englishTranslations = {};
let russianTranslations = {};
const EN_LABELS = {
  refresh: "Refresh decks and models", translation: "Translation", anki: "Anki", highlight: "Highlighting",
  translationProvider: "Provider", translatorApiKey: "API key", translatorEndpoint: "Provider endpoint", translatorRegion: "Provider region", translatorFolderId: "Yandex Cloud folder ID", sourceLang: "Source language", targetLang: "Target language",
  translationTrigger: "Translation trigger", showTranslationIcon: "Show translation icon near selected text", requireShortcut: "Require shortcut to translate selected text", shortcutModifier: "Shortcut", shortcutHoldDuration: "Hold duration", ankiConnectUrl: "AnkiConnect URL", selectedDeck: "Default deck", modelName: "Card model", alreadyInDeck: "The selected text is already added to",
  allDecks: "Select all decks", addOnlyIfUnique: "Add only if the original is not in any deck", highlightEnabled: "Enable highlighting", highlightWholeWords: "Highlight whole words only", highlightMode: "Show", highlightColor: "Highlight color", highlightOpacity: "Background opacity", siteWhitelist: "Whitelist", siteBlacklist: "Blacklist", siteFilteringOnlyHighlight: "Apply site filters only to highlighting (when disabled, block highlighting and translation windows)", decksToHighlight: "Decks to highlight", siteFiltering: "Site filtering",
  options: { translationProvider: { mymemory: "MyMemory (no key)", deepl: "DeepL", google: "Google Cloud Translation", azure: "Microsoft Translator", yandex: "Yandex Translate", libretranslate: "LibreTranslate" }, translationTrigger: { selection: "Text selection", "double-click": "Double-click selected text", shortcut: "Keyboard shortcut with selected text" }, highlightMode: { original: "Original only", translation: "Only translation", both: "Both" } }
};
const SUN_ICON = "\u{1F31E}";
const MOON_ICON = "\u{1F319}";

const LANGUAGES = [
  ["", "Auto-detect"], ["AR", "Arabic"], ["BG", "Bulgarian"], ["CS", "Czech"], ["DA", "Danish"], ["DE", "German"], ["EL", "Greek"],
  ["EN", "English"], ["EN-GB", "English (British)"], ["EN-US", "English (American)"], ["ES", "Spanish"], ["ET", "Estonian"], ["FI", "Finnish"], ["FR", "French"],
  ["HU", "Hungarian"], ["ID", "Indonesian"], ["IT", "Italian"], ["JA", "Japanese"], ["KO", "Korean"], ["LT", "Lithuanian"], ["LV", "Latvian"], ["NB", "Norwegian"],
  ["NL", "Dutch"], ["PL", "Polish"], ["PT", "Portuguese"], ["PT-BR", "Portuguese (Brazilian)"], ["PT-PT", "Portuguese (European)"], ["RO", "Romanian"], ["RU", "Russian"],
  ["SK", "Slovak"], ["SL", "Slovenian"], ["SV", "Swedish"], ["TR", "Turkish"], ["UK", "Ukrainian"], ["ZH", "Chinese"]
];

const request = (message) => new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));

const flagForLanguage = (code) => {
  const regions = { AR: "SA", BG: "BG", CS: "CZ", DA: "DK", DE: "DE", EL: "GR", EN: "GB", ES: "ES", ET: "EE", FI: "FI", FR: "FR", HU: "HU", ID: "ID", IT: "IT", JA: "JP", KO: "KR", LT: "LT", LV: "LV", NB: "NO", NL: "NL", PL: "PL", PT: "PT", RO: "RO", RU: "RU", SK: "SK", SL: "SI", SV: "SE", TR: "TR", UK: "UA", ZH: "CN" };
  const region = regions[code.split("-")[0]] || "GB";
  return String.fromCodePoint(...[...region].map((letter) => 127397 + letter.charCodeAt(0)));
};

const applyInterface = (language) => {
  const labels = language === "ru"
    ? { ...EN_LABELS, ...englishTranslations, ...russianTranslations, options: { ...EN_LABELS.options, ...russianTranslations.options } }
    : { ...EN_LABELS, ...englishTranslations, options: { ...EN_LABELS.options, ...englishTranslations.options } };
  $("refreshAnki").textContent = labels.refresh || "Refresh decks and models";
  document.querySelector("h1").textContent = "AnkiFetch Translate";
  document.querySelectorAll("fieldset")[0].querySelector("legend").textContent = labels.translation || "Translation";
  document.querySelectorAll("fieldset")[1].querySelector("legend").textContent = labels.anki || "Anki";
  document.querySelectorAll("fieldset")[2].querySelector("legend").textContent = labels.highlight || "Highlighting";
  document.querySelectorAll("fieldset")[3].querySelector("legend").textContent = labels.siteFiltering || "Site filtering";
  ["translationProvider", "translatorApiKey", "translatorEndpoint", "translatorRegion", "translatorFolderId", "sourceLang", "targetLang", "translationTrigger", "showTranslationIcon", "requireShortcut", "shortcutModifier", "shortcutHoldDuration", "ankiConnectUrl", "selectedDeck", "modelName", "addOnlyIfUnique", "highlightEnabled", "highlightWholeWords", "allDecks", "highlightMode", "highlightColor", "highlightOpacity", "siteWhitelist", "siteBlacklist", "siteFilteringOnlyHighlight"].forEach((id) => {
    const label = document.querySelector(`label:has(#${id})`);
    if (label && labels[id]) label.firstChild.textContent = `${labels[id]} `;
  });
  Object.entries(labels.options || {}).forEach(([id, values]) => {
    const select = $(id);
    if (!select) return;
    [...select.options].forEach((option) => { if (values[option.value]) option.textContent = values[option.value]; });
  });
  const textTranslations = {
    decksToHighlightLabel: labels.decksToHighlight,
    siteFilteringHint: labels.siteFilteringHint,
    addOnlyIfUnique: labels.addOnlyIfUnique,
    highlightEnabled: labels.highlightEnabled,
    highlightWholeWords: labels.highlightWholeWords,
    allDecks: labels.allDecks,
    showTranslationIcon: labels.showTranslationIcon,
    requireShortcut: labels.requireShortcut,
    siteFilteringOnlyHighlight: labels.siteFilteringOnlyHighlight
  };
  Object.entries(textTranslations).forEach(([id, text]) => {
    const element = $(id);
    if (!element || !text) return;
    if (element.matches("input")) {
      const label = element.closest("label");
      if (label) label.lastChild.textContent = ` ${text}`;
    } else {
      element.textContent = text;
    }
  });
  $("decksToHighlightLabel").textContent = labels.decksToHighlight || "Decks to highlight";
  $("siteFilteringHint").textContent = labels.siteFilteringHint || "";
  $("translatorApiKey").placeholder = labels.pasteApiKey || "";
  $("translatorEndpoint").placeholder = labels.libreTranslateEndpoint || "";
  $("siteWhitelist").placeholder = labels.whitelistPlaceholder || "";
  $("siteBlacklist").placeholder = labels.blacklistPlaceholder || "";
  $("toggleApiKey").textContent = $("translatorApiKey").type === "password" ? (labels.show || "Show") : (labels.hide || "Hide");
};

const setThemeIcon = (theme) => { $("themeButton").innerHTML = theme === "dark" ? SUN_ICON : MOON_ICON; };

const PROVIDER_ENDPOINT_DEFAULTS = {
  libretranslate: "https://libretranslate.com/translate",
  azure: "https://api.cognitive.microsofttranslator.com"
};

const updateProviderFields = () => {
  const provider = $("translationProvider").value;
  document.querySelectorAll("[data-provider-field]").forEach((field) => {
    const fieldType = field.dataset.providerField;
    const hidden = (fieldType === "endpoint" && !["libretranslate", "azure"].includes(provider))
      || (fieldType === "region" && provider !== "azure")
      || (fieldType === "folder" && provider !== "yandex");
    field.hidden = hidden;
    field.classList.toggle("provider-field-hidden", hidden);
  });
  const endpointDefault = PROVIDER_ENDPOINT_DEFAULTS[provider];
  if (endpointDefault && (!$("translatorEndpoint").value || Object.values(PROVIDER_ENDPOINT_DEFAULTS).includes($("translatorEndpoint").value))) {
    $("translatorEndpoint").value = endpointDefault;
  }
};

const renderLanguages = (settings) => {
  const options = LANGUAGES.map(([code, name]) => `<option value="${code}">${name}${code ? ` ${flagForLanguage(code)}` : ""}</option>`).join("");
  $("sourceLang").innerHTML = options;
  $("targetLang").innerHTML = options.replace('<option value="">Auto-detect</option>', "");
  $("sourceLang").value = settings.sourceLang || "";
  $("targetLang").value = settings.targetLang || "EN";
};

const renderAnki = (settings) => {
  $("selectedDeck").innerHTML = `<option value="">Select a deck</option>${decks.map((deck) => `<option value="${deck.replaceAll('"', '&quot;')}">${deck}</option>`).join("")}`;
  $("selectedDeck").value = settings.selectedDeck || "";
  const highlightAll = settings.highlightDecks?.includes("");
  $("allDecks").checked = Boolean(highlightAll);
  $("deckChecklist").innerHTML = decks.map((deck, index) => `<label class="deck-check"><input type="checkbox" data-deck-index="${index}" value="${deck.replaceAll('"', '&quot;')}" ${highlightAll || settings.highlightDecks?.includes(deck) ? "checked" : ""}>${deck}</label>`).join("");
  $("modelName").innerHTML = `<option value="">Select a model</option>${models.map((model) => `<option value="${model.replaceAll('"', '&quot;')}">${model}</option>`).join("")}`;
  $("modelName").value = settings.modelName || models[0] || "";
};

const saveSettings = async (partial) => {
  const result = await request({ type: "save-settings", settings: partial });
  $("status").textContent = result.error || "Changes are saved automatically.";
};

const parseDomainList = (value) => value.split("\\n").map((item) => item.trim().toLowerCase()).filter(Boolean);

const load = async () => {
  const settings = await request({ type: "get-settings" });
  $("translationProvider").value = settings.translationProvider || "mymemory";
  $("translatorApiKey").value = settings.translatorApiKey || "";
  $("translatorEndpoint").value = settings.translatorEndpoint || "";
  $("translatorRegion").value = settings.translatorRegion || "";
  $("translatorFolderId").value = settings.translatorFolderId || "";
  updateProviderFields();
  $("ankiConnectUrl").value = settings.ankiConnectUrl;
  $("addOnlyIfUnique").checked = Boolean(settings.addOnlyIfUnique);
  $("highlightEnabled").checked = settings.highlightEnabled !== false;
  $("highlightWholeWords").checked = settings.highlightWholeWords === true;
  $("translationTrigger").value = settings.translationTrigger === "icon" ? "selection" : settings.translationTrigger || "selection";
  $("showTranslationIcon").checked = Boolean(settings.showTranslationIcon || settings.translationTrigger === "icon");
  $("requireShortcut").checked = Boolean(settings.requireShortcut || settings.translationTrigger === "shortcut");
  setShortcutButton(settings.shortcutModifier || "Y");
  $("shortcutHoldDuration").value = Number(settings.shortcutHoldDuration) || 0;
  $("shortcutHoldDurationValue").textContent = `${$("shortcutHoldDuration").value} ms`;
  $("siteWhitelist").value = (settings.siteWhitelist || []).join("\\n");
  $("siteBlacklist").value = (settings.siteBlacklist || []).join("\\n");
  $("siteFilteringOnlyHighlight").checked = settings.siteFilteringOnlyHighlight !== false;
  $("highlightMode").value = settings.highlightMode || "both";
  $("highlightColor").value = settings.highlightColor || "#fff0a8";
  $("highlightOpacity").value = settings.highlightOpacity ?? 0.65;
  $("highlightOpacityValue").textContent = `${Math.round(Number($("highlightOpacity").value) * 100)}%`;
  setThemeIcon(settings.theme || "light");
  document.body.dataset.theme = settings.theme || "light";
  englishTranslations = await fetch(chrome.runtime.getURL("src/locales/en.json")).then((response) => response.json()).catch(() => ({}));
  if ((settings.interfaceLanguage || "en") === "ru") russianTranslations = await fetch(chrome.runtime.getURL("src/locales/ru.json")).then((response) => response.json()).catch(() => ({}));
  document.body.dataset.interfaceLanguage = settings.interfaceLanguage || "en";
  applyInterface(settings.interfaceLanguage || "en");
  updateApiStatus();
  updateAnkiStatus();
  decks = await request({ type: "get-decks" }).then((result) => result.decks || []).catch(() => []);
  models = await request({ type: "get-models" }).then((result) => result.models || []).catch(() => []);
  renderLanguages(settings);
  renderAnki(settings);
};

$("refreshAnki").addEventListener("click", async () => {
  const [deckResult, modelResult] = await Promise.all([request({ type: "get-decks" }), request({ type: "get-models" })]);
  if (deckResult.error || modelResult.error) $("status").textContent = deckResult.error || modelResult.error;
  else { decks = deckResult.decks; models = modelResult.models; renderAnki({ selectedDeck: $("selectedDeck").value, modelName: $("modelName").value, highlightDecks: [...document.querySelectorAll("#deckChecklist input:checked")].map((input) => input.value) }); }
});

$("languageButton").addEventListener("click", () => $("languageButton").parentElement.classList.toggle("open"));
document.addEventListener("click", (event) => {
  if (!event.target.closest(".language-menu")) $("languageButton").parentElement.classList.remove("open");
});
window.addEventListener("keydown", () => $("languageButton").parentElement.classList.remove("open"), true);
["keydown", "keypress", "keyup", "input", "beforeinput"].forEach((eventName) => {
  window.addEventListener(eventName, () => $("languageButton").parentElement.classList.remove("open"), true);
});
$("languageMenuItems").addEventListener("click", async (event) => {
  const language = event.target.closest("[data-language]")?.dataset.language;
  if (!language) return;
  if (language === "ru") russianTranslations = await fetch(chrome.runtime.getURL("src/locales/ru.json")).then((response) => response.json()).catch(() => ({}));
  document.body.dataset.interfaceLanguage = language;
  applyInterface(language);
  saveSettings({ interfaceLanguage: language });
  updateApiStatus();
  updateAnkiStatus();
  $("languageButton").parentElement.classList.remove("open");
});
$("themeButton").addEventListener("click", () => {
  const theme = document.body.dataset.theme === "dark" ? "light" : "dark";
  document.body.dataset.theme = theme;
  setThemeIcon(theme);
  saveSettings({ theme });
});
$("highlightOpacity").addEventListener("input", () => {
  $("highlightOpacityValue").textContent = `${Math.round(Number($("highlightOpacity").value) * 100)}%`;
  saveSettings({ highlightOpacity: Number($("highlightOpacity").value) });
});

const bindSave = (id, key, transform = (value) => value) => $(id).addEventListener("change", () => saveSettings({ [key]: transform($(id).value) }));
$("translationProvider").addEventListener("change", () => {
  updateProviderFields();
  const labels = document.body.dataset.interfaceLanguage === "ru" ? russianTranslations : englishTranslations;
  $("apiStatus").textContent = labels.apiChecking || "";
  const settings = {
    translationProvider: $("translationProvider").value,
    translatorApiKey: $("translatorApiKey").value,
    translatorEndpoint: $("translatorEndpoint").value,
    translatorRegion: $("translatorRegion").value,
    translatorFolderId: $("translatorFolderId").value
  };
  void saveSettings(settings);
  void updateApiStatus(settings);
});
bindSave("translatorApiKey", "translatorApiKey");
bindSave("translatorEndpoint", "translatorEndpoint");
bindSave("translatorRegion", "translatorRegion");
bindSave("translatorFolderId", "translatorFolderId");
bindSave("ankiConnectUrl", "ankiConnectUrl");
bindSave("selectedDeck", "selectedDeck");
bindSave("modelName", "modelName");
$("addOnlyIfUnique").addEventListener("change", () => saveSettings({ addOnlyIfUnique: $("addOnlyIfUnique").checked }));
bindSave("sourceLang", "sourceLang");
bindSave("targetLang", "targetLang");
bindSave("translationTrigger", "translationTrigger");
$("showTranslationIcon").addEventListener("change", () => saveSettings({ showTranslationIcon: $("showTranslationIcon").checked }));
$('shortcutModifier').addEventListener("click", () => {
  const button = $("shortcutModifier");
  const originalText = button.textContent;
  const modifierKeys = new Set();
  button.classList.add("recording");
  button.textContent = "Press a shortcut...";
  const stopRecording = () => {
    button.classList.remove("recording");
    window.removeEventListener("keydown", recordShortcut, true);
    window.removeEventListener("keyup", recordModifier, true);
    if (button.textContent === "Press a shortcut...") button.textContent = originalText;
  };
  const saveShortcut = (shortcut) => {
    setShortcutButton(shortcut);
    saveSettings({ shortcutModifier: shortcut });
    stopRecording();
  };
  const modifierName = (key) => ({ Control: "Ctrl", Alt: "Alt", Shift: "Shift", Meta: "Meta" })[key];
  const recordShortcut = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      stopRecording();
      return;
    }
    const currentModifier = modifierName(event.key);
    if (currentModifier) {
      modifierKeys.add(currentModifier);
      return;
    }
    if (!event.key || event.key === "Unidentified") return;
    const modifiers = [
      event.ctrlKey ? "Ctrl" : "",
      event.altKey ? "Alt" : "",
      event.shiftKey ? "Shift" : "",
      event.metaKey ? "Meta" : "",
      ...modifierKeys
    ].filter(Boolean);
    const key = event.key === " " ? "Space" : event.key.length === 1 ? event.key.toUpperCase() : event.key;
    saveShortcut([...new Set(modifiers), key].join("+"));
  };
  const recordModifier = (event) => {
    const currentModifier = modifierName(event.key);
    if (!currentModifier || !modifierKeys.has(currentModifier)) return;
    saveShortcut([...modifierKeys].join("+"));
  };
  window.addEventListener("keydown", recordShortcut, true);
  window.addEventListener("keyup", recordModifier, true);
});
$("requireShortcut").addEventListener("change", () => saveSettings({ requireShortcut: $("requireShortcut").checked }));
$("shortcutHoldDuration").addEventListener("input", () => {
  const value = Number($("shortcutHoldDuration").value);
  $("shortcutHoldDurationValue").textContent = `${value} ms`;
  saveSettings({ shortcutHoldDuration: value });
});
$("highlightEnabled").addEventListener("change", () => saveSettings({ highlightEnabled: $("highlightEnabled").checked }));
$("highlightWholeWords").addEventListener("change", () => saveSettings({ highlightWholeWords: $("highlightWholeWords").checked }));
bindSave("highlightMode", "highlightMode");
bindSave("highlightColor", "highlightColor");
const saveHighlightDecks = () => saveSettings({ highlightDecks: $("allDecks").checked ? [""] : [...document.querySelectorAll("#deckChecklist input:checked")].map((input) => input.value) });
$("allDecks").addEventListener("change", () => {
  document.querySelectorAll("#deckChecklist input").forEach((input) => { input.checked = $("allDecks").checked; });
  saveHighlightDecks();
});
$("deckChecklist").addEventListener("change", (event) => {
  if (event.target.matches("input")) {
    $("allDecks").checked = [...document.querySelectorAll("#deckChecklist input")].every((input) => input.checked);
    saveHighlightDecks();
  }
});
$("siteWhitelist").addEventListener("change", () => saveSettings({ siteWhitelist: parseDomainList($("siteWhitelist").value) }));
$("siteBlacklist").addEventListener("change", () => saveSettings({ siteBlacklist: parseDomainList($("siteBlacklist").value) }));
$("siteFilteringOnlyHighlight").addEventListener("change", () => saveSettings({ siteFilteringOnlyHighlight: $("siteFilteringOnlyHighlight").checked }));
$("toggleApiKey").addEventListener("click", () => {
  const input = $("translatorApiKey");
  input.type = input.type === "password" ? "text" : "password";
  const labels = document.body.dataset.interfaceLanguage === "ru" ? russianTranslations : englishTranslations;
  $("toggleApiKey").textContent = input.type === "password" ? (labels.show || "Show") : (labels.hide || "Hide");
});
const updateApiStatus = async (settings = {}) => {
  const requestId = (updateApiStatus.requestId || 0) + 1;
  updateApiStatus.requestId = requestId;
  const labels = document.body.dataset.interfaceLanguage === "ru" ? russianTranslations : englishTranslations;
  $("apiStatus").textContent = labels.apiChecking || "";
  const result = await request({ type: "check-api", settings });
  if (requestId !== updateApiStatus.requestId) return;
  const status = result.status || result.error || "";
  const localizedStatus = status === "API key is valid."
    ? labels.apiValid
    : status === "MyMemory does not require an API key."
      ? labels.apiNoKey
      : status.startsWith("An API key is required for ")
        ? `${labels.apiKeyRequired} ${status.replace("An API key is required for ", "")}`
        : status || labels.apiUnavailable;
  $("apiStatus").textContent = localizedStatus || "";
};

const updateAnkiStatus = async () => {
  const labels = document.body.dataset.interfaceLanguage === "ru" ? russianTranslations : englishTranslations;
  const statusButton = $("ankiStatusButton");
  statusButton.classList.remove("is-running", "is-stopped");
  statusButton.classList.add("is-checking");
  statusButton.title = labels.ankiChecking;
  statusButton.setAttribute("aria-label", labels.ankiChecking);
  $("ankiStatus").textContent = labels.ankiChecking;
  const result = await request({ type: "check-anki" });
  const statusText = result.running ? labels.ankiRunning : labels.ankiNotRunning;
  statusButton.classList.remove("is-checking");
  statusButton.classList.add(result.running ? "is-running" : "is-stopped");
  statusButton.title = statusText;
  statusButton.setAttribute("aria-label", statusText);
  $("ankiStatus").textContent = result.running ? "" : statusText;
};
$("translatorApiKey").addEventListener("input", () => { void saveSettings({ translatorApiKey: $("translatorApiKey").value }).then(updateApiStatus); });
$("checkApi").addEventListener("click", updateApiStatus);
$("ankiConnectUrl").addEventListener("change", updateAnkiStatus);

const setShortcutButton = (key) => {
  const button = $("shortcutModifier");
  button.dataset.key = key;
  button.textContent = key;
};

load();
