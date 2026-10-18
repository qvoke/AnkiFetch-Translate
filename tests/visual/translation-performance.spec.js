import { chromium, expect, test } from "@playwright/test";
import path from "node:path";

const extensionPath = path.resolve(process.cwd());
const browserOptions = process.env.ANKI_TRANSLATOR_BROWSER === "chrome"
  ? { executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" }
  : { channel: "chromium" };

test("measures provider response and popup render time separately", async () => {
  const context = await chromium.launchPersistentContext("", {
    ...browserOptions,
    headless: false,
    ignoreDefaultArgs: ["--disable-extensions"],
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
  });

  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    await worker.evaluate(async () => {
      await chrome.storage.local.set({
        translationProvider: "mymemory",
        translationTrigger: "selection",
        requireShortcut: false,
        showTranslationIcon: false,
        siteFilteringOnlyHighlight: true
      });
    });

    await context.route("https://api.mymemory.translated.net/get?*", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ responseData: { translatedText: "delayed translation" } })
      });
    });

    const page = await context.newPage();
    await page.goto("https://example.com/", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      document.body.innerHTML = "<div id='selection-test' contenteditable='true' style='font: 24px sans-serif; padding: 40px;'>performance translation</div>";
    });

    const field = page.locator("#selection-test");
    await field.selectText();
    const popup = page.locator(".anki-translator-popup");
    await expect(popup).toHaveCount(1, { timeout: 5000 });
    await expect.poll(async () => popup.getAttribute("data-provider-response-at")).not.toBeNull();

    const metrics = await popup.evaluate((element) => ({
      providerMs: Number(element.dataset.providerResponseAt) - Number(element.dataset.translationStartedAt),
      popupRenderMs: Number(element.dataset.popupVisibleAt) - Number(element.dataset.providerResponseAt),
      totalMs: Number(element.dataset.providerResponseAt) - Number(element.dataset.translationStartedAt)
    }));

    console.log(`Translation performance: ${JSON.stringify(metrics)}`);
    expect(metrics.providerMs).toBeGreaterThanOrEqual(100);
    expect(metrics.popupRenderMs).toBeGreaterThanOrEqual(0);
    expect(metrics.popupRenderMs).toBeLessThan(250);
    expect(metrics.totalMs).toBe(metrics.providerMs);
  } finally {
    await context.close();
  }
});

test("keeps the translation popup open after a double-click selection", async () => {
  const context = await chromium.launchPersistentContext("", {
    ...browserOptions,
    headless: false,
    ignoreDefaultArgs: ["--disable-extensions"],
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
  });

  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    await worker.evaluate(async () => {
      await chrome.storage.local.set({
        translationProvider: "mymemory",
        translationTrigger: "selection",
        requireShortcut: false,
        showTranslationIcon: false,
        siteFilteringOnlyHighlight: true
      });
    });
    await context.route("https://api.mymemory.translated.net/get?*", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ responseData: { translatedText: "double click translation" } })
      });
    });

    const page = await context.newPage();
    await page.goto("https://example.com/", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      document.body.innerHTML = "<p id='selection-test' style='font: 24px sans-serif; padding: 40px;'>double click translation</p>";
      window.__popupLifecycle = [];
      new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains("anki-translator-popup")) {
              window.__popupLifecycle.push({ type: "added", time: performance.now() });
            }
          });
          mutation.removedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains("anki-translator-popup")) {
              window.__popupLifecycle.push({ type: "removed", time: performance.now(), closing: node.classList.contains("is-closing") });
            }
          });
        });
      }).observe(document.body, { childList: true });
    });
    const field = page.locator("#selection-test");
    await expect(field).not.toHaveAttribute("contenteditable");
    expect(await field.evaluate((element) => element.isContentEditable)).toBe(false);
    const bounds = await field.boundingBox();
    if (!bounds) throw new Error("Double-click target is not measurable");
    await page.mouse.dblclick(bounds.x + 30, bounds.y + bounds.height / 2);

    const popup = page.locator(".anki-translator-popup");
    await expect(popup).toHaveCount(1, { timeout: 5000 });
    await page.waitForTimeout(1000);
    const getPopupState = () => popup.evaluate((element) => {
      const styles = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return {
        display: styles.display,
        visibility: styles.visibility,
        opacity: Number(styles.opacity),
        width: rect.width,
        height: rect.height,
        lifecycle: window.__popupLifecycle
      };
    });
    const initialState = await getPopupState();
    const settledState = await getPopupState();
    console.log(`Double-click popup state: ${JSON.stringify({ initialState, settledState })}`);
    await expect(popup).toHaveCount(1);
    expect(settledState.display).not.toBe("none");
    expect(settledState.visibility).toBe("visible");
    expect(settledState.opacity).toBeGreaterThan(0);
    expect(settledState.width).toBeGreaterThan(0);
    expect(settledState.height).toBeGreaterThan(0);
  } finally {
    await context.close();
  }
});

test("keeps the translation popup open one second after drag selection", async () => {
  const context = await chromium.launchPersistentContext("", {
    ...browserOptions,
    headless: false,
    ignoreDefaultArgs: ["--disable-extensions"],
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
  });

  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    await worker.evaluate(async () => {
      await chrome.storage.local.set({
        translationProvider: "mymemory",
        translationTrigger: "selection",
        requireShortcut: false,
        showTranslationIcon: false,
        siteFilteringOnlyHighlight: true
      });
    });
    await context.route("https://api.mymemory.translated.net/get?*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ responseData: { translatedText: "drag translation" } })
      });
    });

    const page = await context.newPage();
    await page.goto("https://example.com/", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      document.body.innerHTML = "<div id='selection-test' style='font: 24px sans-serif; padding: 40px;'>drag selection translation</div>";
    });
    const field = page.locator("#selection-test");
    const bounds = await field.boundingBox();
    if (!bounds) throw new Error("Drag-selection target is not measurable");
    await page.mouse.move(bounds.x + 10, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width - 10, bounds.y + bounds.height / 2, { steps: 12 });
    await page.mouse.up();

    await page.waitForTimeout(1000);
    const popup = page.locator(".anki-translator-popup");
    await expect(popup).toHaveCount(1, { timeout: 5000 });
    const state = await popup.evaluate((element) => {
      const styles = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return { display: styles.display, visibility: styles.visibility, opacity: Number(styles.opacity), width: rect.width, height: rect.height };
    });
    expect(state.display).not.toBe("none");
    expect(state.visibility).toBe("visible");
    expect(state.opacity).toBeGreaterThan(0);
    expect(state.width).toBeGreaterThan(0);
    expect(state.height).toBeGreaterThan(0);
  } finally {
    await context.close();
  }
});
