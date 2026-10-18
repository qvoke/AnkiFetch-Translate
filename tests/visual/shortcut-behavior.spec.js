import { chromium, expect, test } from "@playwright/test";
import path from "node:path";

const extensionPath = path.resolve(process.cwd());

const openConfiguredPage = async (url = "https://www.deepl.com/en/translator", selector = null, overrides = {}) => {
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: false,
    ignoreDefaultArgs: ["--disable-extensions"],
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  await worker.evaluate(async (testOverrides) => {
    await chrome.storage.local.set({
      shortcutModifier: "Ctrl",
      requireShortcut: true,
      translationTrigger: "selection",
      shortcutHoldDuration: 0,
      translationProvider: "mymemory",
      ...testOverrides
    });
  }, overrides);
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  if (url === "https://example.com/") {
    await page.evaluate(() => {
      document.body.innerHTML = "<div id='selection-test' contenteditable='true' style='font: 24px sans-serif; padding: 40px;'>delayed shortcut selection</div>";
    });
  }
  const field = page.locator(selector || (url === "https://example.com/" ? "#selection-test" : "textarea, [contenteditable='true']")).first();
  await expect(field).toBeVisible();
  return { context, page, field };
};

const selectConfiguredText = async (page, field) => {
  await field.fill("delayed shortcut selection");
  await field.selectText();
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString().trim())).toBe("delayed shortcut selection");
  await page.waitForTimeout(1000);
  await page.keyboard.down("Control");
  await page.keyboard.up("Control");
};

test("opens translation after a delayed Ctrl press on existing selection", async () => {
  const { context, page, field } = await openConfiguredPage("https://example.com/");
  try {
    await field.fill("delayed shortcut selection");
    const bounds = await field.boundingBox();
    if (!bounds) throw new Error("Translation field is not measurable");
    await page.mouse.move(bounds.x + 12, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width - 8, bounds.y + bounds.height / 2, { steps: 10 });
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString().trim())).toBe("delayed shortcut selection");
    await page.waitForTimeout(1000);
    await page.keyboard.down("Control");
    await page.waitForTimeout(100);
    await page.keyboard.up("Control");
    await expect(page.locator(".anki-translator-popup")).toHaveCount(1, { timeout: 10000 });
  } finally {
    await context.close();
  }
});

test("does not recreate an open popup when Ctrl is pressed again", async () => {
  const { context, page, field } = await openConfiguredPage("https://example.com/");
  try {
    await field.fill("delayed shortcut selection");
    await field.selectText();
    await page.waitForTimeout(1000);
    await page.keyboard.down("Control");
    await page.keyboard.up("Control");
    await expect(page.locator(".anki-translator-popup")).toHaveCount(1, { timeout: 10000 });
    const addCheckbox = page.locator(".anki-translator-popup .anki-translator-add");
    await addCheckbox.check();
    await page.keyboard.down("Control");
    await page.keyboard.up("Control");
    await page.waitForTimeout(500);
    await expect(page.locator(".anki-translator-popup")).toHaveCount(1);
    await expect(addCheckbox).toBeChecked();
  } finally {
    await context.close();
  }
});

test("does not open translation after the selection is removed", async () => {
  const { context, page, field } = await openConfiguredPage("https://example.com/");
  try {
    await field.fill("delayed shortcut selection");
    await field.selectText();
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString().trim())).toBe("delayed shortcut selection");
    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    await page.waitForTimeout(300);
    await page.keyboard.down("Control");
    await page.keyboard.up("Control");
    await page.waitForTimeout(500);
    await expect(page.locator(".anki-translator-popup")).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("site filters can be limited to highlighting", async () => {
  const { context, page, field } = await openConfiguredPage("https://example.com/", null, {
    siteWhitelist: ["allowed.example"],
    siteFilteringOnlyHighlight: true
  });
  try {
    await selectConfiguredText(page, field);
    await expect(page.locator(".anki-translator-popup")).toHaveCount(1, { timeout: 10000 });
  } finally {
    await context.close();
  }
});

test("site filters block popups when highlighting-only mode is disabled", async () => {
  const { context, page, field } = await openConfiguredPage("https://example.com/", null, {
    siteWhitelist: ["allowed.example"],
    siteFilteringOnlyHighlight: false
  });
  try {
    await selectConfiguredText(page, field);
    await expect(page.locator(".anki-translator-popup")).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("highlights text added after the page content changes", async () => {
  const { context, page } = await openConfiguredPage("https://example.com/", "body", {
    savedWords: [{ original: "dynamic", translation: "dynamic", deck: "" }],
    highlightDecks: [""]
  });
  try {
    await page.evaluate(() => { document.body.innerHTML = "<p id='dynamic-content'>initial content</p>"; });
    await page.waitForTimeout(1000);
    await expect(page.locator(".anki-translator-highlight")).toHaveCount(0);
    await page.locator("#dynamic-content").evaluate((element) => { element.textContent = "dynamic content"; });
    await expect(page.locator(".anki-translator-highlight")).toHaveCount(1, { timeout: 5000 });
  } finally {
    await context.close();
  }
});

test("does not move the caret in contenteditable source fields during highlighting", async () => {
  const { context, page } = await openConfiguredPage("https://example.com/", "body", {
    savedWords: [{ original: "dynamic", translation: "dynamic", deck: "" }],
    highlightDecks: [""],
    siteWhitelist: ["example.com"]
  });
  try {
    await page.evaluate(() => {
      document.body.innerHTML = "<div id='source-field' contenteditable='true'>dynamic source</div><p id='page-content'>initial content</p>";
    });
    const sourceField = page.locator("#source-field");
    await sourceField.focus();
    await page.evaluate(() => {
      const field = document.querySelector("#source-field");
      const range = document.createRange();
      range.selectNodeContents(field);
      range.collapse(false);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    });
    await page.locator("#page-content").evaluate((element) => { element.textContent = "dynamic content"; });
    await expect(page.locator("#page-content .anki-translator-highlight")).toHaveCount(1, { timeout: 5000 });
    await expect.poll(() => page.evaluate(() => {
      const selection = window.getSelection();
      return selection?.anchorNode?.parentElement?.id === "source-field" && selection.anchorOffset === "dynamic source".length;
    })).toBe(true);
    await expect(sourceField.locator(".anki-translator-highlight")).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("opens translation after a delayed Ctrl press on a double-click selection", async () => {
  const { context, page, field } = await openConfiguredPage("https://example.com/");
  try {
    const wordBounds = await field.evaluate((element) => {
      const range = document.createRange();
      range.setStart(element.firstChild, 8);
      range.setEnd(element.firstChild, 16);
      const rect = range.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });
    await page.mouse.dblclick(wordBounds.x, wordBounds.y);
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString().trim())).toBe("shortcut");
    await page.waitForTimeout(1000);
    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    await page.keyboard.down("Control");
    await page.waitForTimeout(100);
    await page.keyboard.up("Control");
    await expect(page.locator(".anki-translator-popup")).toHaveCount(1, { timeout: 10000 });
  } finally {
    await context.close();
  }
});

test("opens translation after a delayed Ctrl press on the FRA page", async () => {
  const { context, page } = await openConfiguredPage("https://fra.europa.eu/en", "body");
  try {
    const wordBounds = await page.evaluate(() => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        const start = node.nodeValue.indexOf("fundamental");
        if (start < 0) continue;
        if (node.parentElement.closest("a, button, nav, header")) continue;
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, start + "Fundamental".length);
        const rect = range.getBoundingClientRect();
        if (!rect.width || !rect.height) continue;
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      }
      return null;
    });
    if (!wordBounds) throw new Error("FRA page word was not found");
    await page.mouse.dblclick(wordBounds.x, wordBounds.y);
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString().trim().toLowerCase())).toBe("fundamental");
    await page.waitForTimeout(1000);
    await page.keyboard.down("Control");
    await page.waitForTimeout(100);
    await page.keyboard.up("Control");
    await expect(page.locator(".anki-translator-popup")).toHaveCount(1, { timeout: 10000 });
  } finally {
    await context.close();
  }
});

test("opens translation after a delayed Ctrl press on Wikipedia", async () => {
  const { context, page } = await openConfiguredPage("https://en.wikipedia.org/wiki/Liberalism", "body");
  try {
    const wordBounds = await page.evaluate(() => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        const start = node.nodeValue.toLowerCase().indexOf("liberalism");
        if (start < 0 || node.parentElement.closest("a, button, nav, header, script, style")) continue;
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, start + "liberalism".length);
        const rect = range.getBoundingClientRect();
        if (!rect.width || !rect.height || rect.bottom < 0 || rect.top > window.innerHeight) continue;
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      }
      return null;
    });
    if (!wordBounds) throw new Error("Wikipedia word was not found");
    await page.mouse.dblclick(wordBounds.x, wordBounds.y);
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString().trim().toLowerCase())).toBe("liberalism");
    await page.waitForTimeout(1000);
    await page.keyboard.down("Control");
    await page.waitForTimeout(100);
    await page.keyboard.up("Control");
    await expect(page.locator(".anki-translator-popup")).toHaveCount(1, { timeout: 20000 });
  } finally {
    await context.close();
  }
});

test("does not open translation after browser search and Enter", async () => {
  const { context, page, field } = await openConfiguredPage();
  try {
    await field.fill("search target");
    await field.selectText();
    await page.waitForTimeout(300);
    await page.keyboard.press("Control+F");
    await page.keyboard.type("search target");
    await page.keyboard.press("Enter");
    await expect(page.locator(".anki-translator-popup")).toHaveCount(0);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);
    await expect(page.locator(".anki-translator-popup")).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("does not open translation after browser search and Enter on Wikipedia", async () => {
  const { context, page } = await openConfiguredPage("https://en.wikipedia.org/wiki/Liberalism", "body");
  try {
    await page.keyboard.press("Control+F");
    await page.keyboard.type("liberalism");
    await page.keyboard.press("Enter");
    await expect(page.locator(".anki-translator-popup")).toHaveCount(0);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);
    await expect(page.locator(".anki-translator-popup")).toHaveCount(0);
  } finally {
    await context.close();
  }
});
