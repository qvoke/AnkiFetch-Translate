const $ = (id) => document.getElementById(id);
let decks = [];
let models = [];
let russianTranslations = {};
const EN_LABELS = {
  refresh: "Refresh decks and models", translation: "Translation", anki: "Anki", highlight: "Highlighting",
  translationProvider: "Provider", translatorApiKey: "API key", translatorEndpoint: "Custom endpoint", sourceLang: "Source language", targetLang: "Target language",
  translationTrigger: "Translation trigger", shortcutKey: "Shortcut", ankiConnectUrl: "AnkiConnect URL", selectedDeck: "Default deck", modelName: "Card model",
  allDecks: "Select all decks", addOnlyIfUnique: "Add only if the original is not in any deck", highlightMode: "Show", highlightColor: "Highlight color", highlightOpacity: "Background opacity", siteWhitelist: "Whitelist", siteBlacklist: "Blacklist",
  options: { translationProvider: { mymemory: "MyMemory (no key)", deepl: "DeepL", libretranslate: "LibreTranslate" }, translationTrigger: { selection: "Text selection", "double-click": "Double-click selected text", shortcut: "Keyboard shortcut with selected text", icon: "Translation icon near selection" }, highlightMode: { original: "Original only", translation: "Translation only", both: "Original and translation" } }
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
  const labels = language === "ru" ? { ...EN_LABELS, ...russianTranslations, options: { ...EN_LABELS.options, ...russianTranslations.options } } : EN_LABELS;
  $("refreshAnki").textContent = labels.refresh || "Refresh decks and models";
  document.querySelector("h1").textContent = "AnkiFetch Translate";
  document.querySelectorAll("fieldset")[0].querySelector("legend").textContent = labels.translation || "Translation";
  document.querySelectorAll("fieldset")[1].querySelector("legend").textContent = labels.anki || "Anki";
  document.querySelectorAll("fieldset")[2].querySelector("legend").textContent = labels.highlight || "Highlighting";
  ["translationProvider", "translatorApiKey", "translatorEndpoint", "sourceLang", "targetLang", "translationTrigger", "shortcutKey", "ankiConnectUrl", "selectedDeck", "modelName", "addOnlyIfUnique", "allDecks", "highlightMode", "highlightColor", "highlightOpacity", "siteWhitelist", "siteBlacklist"].forEach((id) => {
    const label = document.querySelector(`label:has(#${id})`);
    if (label && labels[id]) label.firstChild.textContent = `${labels[id]} `;
  });
  Object.entries(labels.options || {}).forEach(([id, values]) => {
    const select = $(id);
    if (!select) return;
    [...select.options].forEach((option) => { if (values[option.value]) option.textContent = values[option.value]; });
  });
};

const setThemeIcon = (theme) => { $("themeButton").innerHTML = theme === "dark" ? SUN_ICON : MOON_ICON; };

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
  $("ankiConnectUrl").value = settings.ankiConnectUrl;
  $("addOnlyIfUnique").checked = Boolean(settings.addOnlyIfUnique);
  $("translationTrigger").value = settings.translationTrigger || "selection";
  $("shortcutKey").value = settings.shortcutKey || "Ctrl+Shift+Y";
  $("siteWhitelist").value = (settings.siteWhitelist || []).join("\\n");
  $("siteBlacklist").value = (settings.siteBlacklist || []).join("\\n");
  $("highlightMode").value = settings.highlightMode || "both";
  $("highlightColor").value = settings.highlightColor || "#fff0a8";
  $("highlightOpacity").value = settings.highlightOpacity ?? 0.65;
  $("highlightOpacityValue").textContent = `${Math.round(Number($("highlightOpacity").value) * 100)}%`;
  setThemeIcon(settings.theme || "light");
  document.body.dataset.theme = settings.theme || "light";
  if ((settings.interfaceLanguage || "en") === "ru") russianTranslations = await fetch(chrome.runtime.getURL("src/locales/ru.json")).then((response) => response.json()).catch(() => ({}));
  applyInterface(settings.interfaceLanguage || "en");
  updateApiStatus();
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
$("languageMenuItems").addEventListener("click", async (event) => {
  const language = event.target.closest("[data-language]")?.dataset.language;
  if (!language) return;
  if (language === "ru") russianTranslations = await fetch(chrome.runtime.getURL("src/locales/ru.json")).then((response) => response.json()).catch(() => ({}));
  applyInterface(language);
  saveSettings({ interfaceLanguage: language });
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
bindSave("translationProvider", "translationProvider");
bindSave("translatorApiKey", "translatorApiKey");
bindSave("translatorEndpoint", "translatorEndpoint");
bindSave("ankiConnectUrl", "ankiConnectUrl");
bindSave("selectedDeck", "selectedDeck");
bindSave("modelName", "modelName");
$("addOnlyIfUnique").addEventListener("change", () => saveSettings({ addOnlyIfUnique: $("addOnlyIfUnique").checked }));
bindSave("sourceLang", "sourceLang");
bindSave("targetLang", "targetLang");
bindSave("translationTrigger", "translationTrigger");
bindSave("shortcutKey", "shortcutKey");
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
$("toggleApiKey").addEventListener("click", () => {
  const input = $("translatorApiKey");
  input.type = input.type === "password" ? "text" : "password";
  $("toggleApiKey").textContent = input.type === "password" ? "Show" : "Hide";
});
const updateApiStatus = async () => {
  $("apiStatus").textContent = "Checking API...";
  const result = await request({ type: "check-api" });
  $("apiStatus").textContent = result.status || result.error || "API status unavailable.";
};
$("translatorApiKey").addEventListener("input", () => { saveSettings({ translatorApiKey: $("translatorApiKey").value }); updateApiStatus(); });
$("translationProvider").addEventListener("change", updateApiStatus);
$("checkApi").addEventListener("click", updateApiStatus);

load();
