# AnkiFetch Translate

An unpacked Chrome Manifest V3 extension that translates selected text with DeepL, optionally adds the original and translation to a selected Anki card model through AnkiConnect, and highlights saved vocabulary on web pages.

Translation can be triggered by text selection, double-clicking selected text, the configured keyboard shortcut, or a translation icon shown next to the selection. The translation popup can choose a deck and defer saving until the popup closes. Clicking a highlighted item opens its saved translation.

## Setup

1. Install Anki and the AnkiConnect add-on.
2. Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select this directory.
3. Open the extension settings, enter a DeepL API key, configure the AnkiConnect URL, load decks and models, and choose a save deck and card model.
4. Select text on any page, use the popup or `Ctrl+Shift+Y`, and press **Add to Anki**.

The extension does not embed API credentials in source code. DeepL credentials are stored in Chrome extension storage and sent only to the configured DeepL endpoint.

## AnkiConnect CORS

If AnkiConnect rejects browser requests, add the extension origin to its `webCorsOriginList` setting. The exact origin is shown in the extension details page. The default AnkiConnect URL is `http://127.0.0.1:8765`.
