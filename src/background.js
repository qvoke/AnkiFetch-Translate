const DEFAULTS = {
  deeplApiKey: "",
  deeplEndpoint: "https://api-free.deepl.com/v2/translate",
  translationProvider: "mymemory",
  translatorApiKey: "",
  translatorEndpoint: "",
  ankiConnectUrl: "http://127.0.0.1:8765",
  modelName: "",
  addOnlyIfUnique: false,
  sourceLang: "",
  targetLang: "EN",
  selectedDeck: "",
  highlightDecks: [""],
  highlightMode: "both",
  highlightColor: "#fff0a8",
  highlightOpacity: 0.65,
  translationTrigger: "selection",
  shortcutKey: "Ctrl+Shift+Y",
  siteWhitelist: [],
  siteBlacklist: [],
  popupAddToAnki: false,
  theme: "light",
  interfaceLanguage: "en",
  savedWords: []
};

const getSettings = async () => {
  const settings = await chrome.storage.local.get(DEFAULTS);
  return { ...DEFAULTS, ...settings };
};

const ankiRequest = async (action, params = {}) => {
  const { ankiConnectUrl } = await getSettings();
  const response = await fetch(ankiConnectUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, version: 6, params })
  });
  if (!response.ok) throw new Error(`AnkiConnect HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.error) throw new Error(payload.error);
  return payload.result;
};

const translate = async (text, overrides = {}) => {
  const settings = await getSettings();
  const provider = settings.translationProvider || "deepl";
  const targetLang = overrides.targetLang || settings.targetLang;
  const sourceLang = overrides.sourceLang ?? settings.sourceLang;
  const apiKey = settings.translatorApiKey || settings.deeplApiKey;
  if (provider === "mymemory") {
    const pair = `${sourceLang || "en"}|${targetLang}`;
    const response = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(pair)}`);
    if (!response.ok) throw new Error(`MyMemory HTTP ${response.status}`);
    return [(await response.json()).responseData?.translatedText || ""];
  }
  if (provider === "libretranslate") {
    const response = await fetch(settings.translatorEndpoint || "https://libretranslate.com/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q: text, source: sourceLang || "auto", target: targetLang.toLowerCase(), format: "text", ...(apiKey ? { api_key: apiKey } : {}) })
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new Error("An API key is required for LibreTranslate. Add it in the extension settings.");
      throw new Error(`LibreTranslate HTTP ${response.status}`);
    }
    return [(await response.json()).translatedText || ""];
  }
  if (!apiKey) throw new Error("An API key is required for DeepL. Add it in the extension settings.");
  const body = new URLSearchParams({ text, target_lang: targetLang });
  if (sourceLang) body.set("source_lang", sourceLang);
  const response = await fetch(settings.deeplEndpoint, { method: "POST", headers: { Authorization: `DeepL-Auth-Key ${apiKey}` }, body });
  if (!response.ok) throw new Error(`DeepL HTTP ${response.status}`);
  return (await response.json()).translations?.map((item) => item.text).filter(Boolean) || [];
};

const refreshDecks = async () => ankiRequest("deckNames");
const refreshModels = async () => ankiRequest("modelNames");

const findWordNotesInDeck = async (original, deck, translation = "") => {
  const searchText = original.replaceAll('"', '\\"');
  const noteIds = await ankiRequest("findNotes", { query: `deck:\"${deck}\" \"${searchText}\"` });
  if (!noteIds.length) return [];
  const notes = await ankiRequest("notesInfo", { notes: noteIds });
  const normalized = original.replace(/<[^>]*>/g, "").trim().toLowerCase();
  return notes.filter((note) => {
    const values = Object.values(note.fields || {}).map((field) => field.value.replace(/<[^>]*>/g, "").trim().toLowerCase());
    return values.includes(normalized) && (!translation || values.includes(translation.replace(/<[^>]*>/g, "").trim().toLowerCase()));
  });
};

const findWordDecks = async (original) => {
  const decks = await refreshDecks();
  const matches = await Promise.all(decks.map(async (deck) => (await findWordNotesInDeck(original, deck)).length ? deck : null));
  return matches.filter(Boolean);
};

const checkApi = async () => {
  const settings = await getSettings();
  const provider = settings.translationProvider || "mymemory";
  const apiKey = settings.translatorApiKey || settings.deeplApiKey;
  if (provider === "mymemory") return "MyMemory does not require an API key.";
  if (!apiKey) return `An API key is required for ${provider}.`;
  try {
    await translate("test", { sourceLang: "", targetLang: "EN" });
    return "API key is valid.";
  } catch (error) {
    return error.message;
  }
};

const rememberWord = async (original, translation, deck) => {
  const settings = await getSettings();
  const normalized = original.trim();
  const savedWords = settings.savedWords.filter((word) =>
    !(word.original.toLowerCase() === normalized.toLowerCase() && word.deck === deck)
  );
  savedWords.push({ original: normalized, translation, deck });
  await chrome.storage.local.set({ savedWords });
};

const removeWord = async ({ original, deck, deleteFromAnki }) => {
  const settings = await getSettings();
  const savedWords = settings.savedWords.filter((word) => !(word.original.toLowerCase() === original.toLowerCase() && word.deck === deck));
  await chrome.storage.local.set({ savedWords });
  if (!deleteFromAnki) return;
  const noteIds = await ankiRequest("findNotes", { query: `deck:\"${deck}\"` });
  if (!noteIds.length) return;
  const notes = await ankiRequest("notesInfo", { notes: noteIds });
  const matchingIds = notes.filter((note) => Object.values(note.fields || {}).some((field) => field.value === original)).map((note) => note.noteId);
  if (matchingIds.length) await ankiRequest("deleteNotes", { notes: matchingIds });
};

const syncWordsFromAnki = async (settings) => {
  const selectedDecks = settings.highlightDecks?.filter(Boolean) || [];
  const query = selectedDecks.length ? selectedDecks.map((deck) => `deck:\"${deck}\"`).join(" OR ") : "tag:anki-translator";
  try {
    const noteIds = await ankiRequest("findNotes", { query });
    if (!noteIds.length) return settings.savedWords;
    const notes = await ankiRequest("notesInfo", { notes: noteIds });
    const synced = notes.flatMap((note) => {
      const values = Object.values(note.fields || {}).map((field) => field.value).filter(Boolean);
      const deck = note.cards?.[0]?.deckName || selectedDecks[0];
      return values.length >= 2 ? [{ original: values[0], translation: values[1], deck }] : [];
    });
    return [...settings.savedWords, ...synced].filter((word, index, all) => all.findIndex((item) => item.original === word.original && item.translation === word.translation && item.deck === word.deck) === index);
  } catch {
    return settings.savedWords;
  }
};

const saveToAnki = async ({ original, translation, deck }) => {
  const settings = await getSettings();
  const deckName = deck || settings.selectedDeck;
  if (!deckName) throw new Error("Select an Anki deck in the translation popup or extension settings.");
  if (!settings.modelName) throw new Error("Select an Anki card model in the extension settings.");
  if (settings.addOnlyIfUnique) {
    const searchText = original.replaceAll('"', '\\"');
    const noteIds = await ankiRequest("findNotes", { query: `"${searchText}"` });
    if (noteIds.length) {
      const notes = await ankiRequest("notesInfo", { notes: noteIds });
      const normalizedOriginal = original.replace(/<[^>]*>/g, "").trim().toLowerCase();
      const alreadyExists = notes.some((note) => Object.values(note.fields || {}).some((field) => field.value.replace(/<[^>]*>/g, "").trim().toLowerCase() === normalizedOriginal));
      if (alreadyExists) return { skipped: true, reason: "The original already exists in an Anki deck." };
    }
  }
  const fieldNames = await ankiRequest("modelFieldNames", { modelName: settings.modelName });
  if (fieldNames.length < 2) throw new Error("The selected Anki model must have at least two fields.");
  const frontField = fieldNames.includes("Front") ? "Front" : fieldNames[0];
  const backField = fieldNames.includes("Back") ? "Back" : fieldNames[1];
  const noteId = await ankiRequest("addNote", {
    note: {
      deckName,
      modelName: settings.modelName,
      fields: { [frontField]: original, [backField]: translation },
      tags: ["anki-translator"]
    }
  });
  if (noteId === null) throw new Error("Anki did not add the note. It may already exist.");
  await rememberWord(original, translation, deckName);
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(tabs.filter((tab) => tab.id).map((tab) => chrome.tabs.sendMessage(tab.id, { type: "refresh-highlights" })));
  return { noteId, deck: deckName };
};

const syncWordDecks = async ({ original, translations, translation, selectedDecks, existingDecks }) => {
  const settings = await getSettings();
  if (!settings.modelName) throw new Error("Select an Anki card model in the extension settings.");
  const desired = [...new Set(selectedDecks || [])];
  const translationValues = [...new Set((translations || [translation]).filter(Boolean))];
  const existing = [...new Set(existingDecks || [])];
  const decksToRemove = existing.filter((deck) => !desired.includes(deck));
  const added = [];
  for (const deck of desired) for (const value of translationValues) {
    if (!(await findWordNotesInDeck(original, deck, value)).length) {
      await saveToAnki({ original, translation: value, deck });
      added.push({ deck, translation: value });
    }
  }
  for (const deck of decksToRemove) {
    const notes = await findWordNotesInDeck(original, deck);
    if (notes.length) await ankiRequest("deleteNotes", { notes: notes.map((note) => note.noteId) });
  }
  for (const deck of existing.filter((value) => desired.includes(value))) {
    const notes = await findWordNotesInDeck(original, deck);
    const desiredValues = translationValues.map((value) => value.replace(/<[^>]*>/g, "").trim().toLowerCase());
    const obsoleteIds = notes.filter((note) => {
      const values = Object.values(note.fields || {}).map((field) => field.value.replace(/<[^>]*>/g, "").trim().toLowerCase());
      return !desiredValues.some((value) => values.includes(value));
    }).map((note) => note.noteId);
    if (obsoleteIds.length) await ankiRequest("deleteNotes", { notes: obsoleteIds });
  }
  const updatedSettings = await getSettings();
  const savedWords = updatedSettings.savedWords.filter((word) => !(word.original.toLowerCase() === original.toLowerCase()));
  for (const deck of desired) for (const value of translationValues) savedWords.push({ original, translation: value, deck });
  await chrome.storage.local.set({ savedWords });
  return { added, removed: decksToRemove };
};

const openTranslation = async (tabId, text) => {
  try {
    const translation = await translate(text);
    await chrome.tabs.sendMessage(tabId, { type: "show-translation", original: text, translation });
  } catch (error) {
    await chrome.tabs.sendMessage(tabId, { type: "show-error", message: error.message });
  }
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "translate-selection",
    title: "Translate and add to Anki",
    contexts: ["selection"]
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "translate-selection" && tab?.id && info.selectionText) {
    openTranslation(tab.id, info.selectionText.trim());
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (message.type === "translate") {
        sendResponse({ translation: await translate(message.text, message) });
      } else if (message.type === "save-to-anki") {
        sendResponse({ result: await saveToAnki(message) });
      } else if (message.type === "sync-word-decks") {
        sendResponse({ result: await syncWordDecks(message) });
      } else if (message.type === "find-word-decks") {
        sendResponse({ decks: await findWordDecks(message.original) });
      } else if (message.type === "remove-word") {
        await removeWord(message);
        const tabs = await chrome.tabs.query({});
        await Promise.allSettled(tabs.filter((tab) => tab.id).map((tab) => chrome.tabs.sendMessage(tab.id, { type: "refresh-highlights" })));
        sendResponse({ ok: true });
      } else if (message.type === "get-decks") {
        sendResponse({ decks: await refreshDecks() });
      } else if (message.type === "get-models") {
        sendResponse({ models: await refreshModels() });
      } else if (message.type === "check-api") {
        sendResponse({ status: await checkApi() });
      } else if (message.type === "get-settings") {
        const settings = await getSettings();
        sendResponse({ ...settings, translatorApiKey: settings.translatorApiKey || settings.deeplApiKey || "", deeplApiKey: settings.deeplApiKey || "" });
      } else if (message.type === "save-settings") {
        await chrome.storage.local.set(message.settings);
        const tabs = await chrome.tabs.query({});
        await Promise.allSettled(tabs.filter((tab) => tab.id).map((tab) => chrome.tabs.sendMessage(tab.id, { type: "refresh-highlights" })));
        sendResponse({ ok: true });
      } else if (message.type === "get-highlights") {
        const settings = await getSettings();
        sendResponse({ words: await syncWordsFromAnki(settings), decks: settings.highlightDecks, mode: settings.highlightMode, color: settings.highlightColor, opacity: settings.highlightOpacity, theme: settings.theme, siteWhitelist: settings.siteWhitelist, siteBlacklist: settings.siteBlacklist });
      }
    } catch (error) {
      sendResponse({ error: error.message });
    }
  })();
  return true;
});
