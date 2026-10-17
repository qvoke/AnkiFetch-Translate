import { chromium, expect, test } from "@playwright/test";
import path from "node:path";

const extensionPath = path.resolve(process.cwd());
const testText = "This is a visual popup test.";

const editableField = (page) => page.locator("textarea, [contenteditable='true']").first();

const fieldText = async (field) => {
  const tagName = await field.evaluate((element) => element.tagName);
  const value = tagName === "TEXTAREA" || tagName === "INPUT" ? await field.inputValue() : await field.innerText();
  return value.trim();
};

const openDeepL = async (testInfo) => {
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: false,
    ignoreDefaultArgs: ["--disable-extensions"],
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
  });
  const page = await context.newPage();
  await page.goto("https://www.deepl.com/en/translator", { waitUntil: "domcontentloaded" });
  const field = editableField(page);
  await expect(field).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("01-deepl-empty.png"), fullPage: true });
  return { context, page, field };
};

test("closes the translation popup after Ctrl+A and deleting DeepL input", async ({}, testInfo) => {
  const { context, page, field } = await openDeepL(testInfo);
  try {
    await field.fill(testText);
    await field.press("Control+A");
    await page.screenshot({ path: testInfo.outputPath("02-after-ctrl-a.png"), fullPage: true });
    await expect.poll(() => page.locator(".anki-translator-popup").count()).toBe(1);

    await field.press("Backspace");
    await expect.poll(() => fieldText(field)).toBe("");
    await expect(page.locator(".anki-translator-popup")).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("03-after-delete.png"), fullPage: true });
  } finally {
    await context.close();
  }
});

test("closes the translation popup after Ctrl+Shift+Arrow selection is deleted", async ({}, testInfo) => {
  const { context, page, field } = await openDeepL(testInfo);
  try {
    await field.fill("alpha beta gamma");
    await field.press("End");
    await field.press("Control+Shift+ArrowLeft");
    await expect.poll(() => page.locator(".anki-translator-popup").count()).toBe(1);
    await page.screenshot({ path: testInfo.outputPath("04-after-shift-arrow.png"), fullPage: true });

    await field.press("Backspace");
    await expect.poll(() => fieldText(field)).toBe("alpha beta");
    await expect(page.locator(".anki-translator-popup")).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("05-after-shift-arrow-delete.png"), fullPage: true });
  } finally {
    await context.close();
  }
});
