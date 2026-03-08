const { test, expect, waitForActiveTabInfo } = require("./fixtures");

const SAMPLE_VIDEO_URL =
  process.env.SCRIPTLENS_TEST_VIDEO_URL ||
  "https://www.youtube.com/watch?v=vWQk67meYUA";

test.describe("ScriptLens YouTube workspace", () => {
  test("loads YouTube context and produces an analysis path for the sample video", async ({
    context,
    extensionId,
    serviceWorker
  }) => {
    const videoPage = await context.newPage();
    await videoPage.goto(SAMPLE_VIDEO_URL, { waitUntil: "domcontentloaded" });
    await videoPage.bringToFront();
    await videoPage.waitForTimeout(2500);

    const targetTab = await waitForActiveTabInfo(
      serviceWorker,
      (tab) => Boolean(tab?.url && /^https:\/\/www\.youtube\.com\/watch\?/.test(tab.url))
    );

    const workspacePage = await context.newPage();
    await workspacePage.goto(
      `chrome-extension://${extensionId}/sidepanel.html?targetTabId=${targetTab.id}&targetWindowId=${targetTab.windowId}`,
      { waitUntil: "domcontentloaded" }
    );

    await expect(workspacePage.locator("#pageBadges")).toContainText("YouTube video");
    await expect(workspacePage.locator("#youtubeControls")).toBeVisible();
    await expect(workspacePage.locator("#videoSourceChips")).toContainText("Transcript");
    await expect(workspacePage.locator("#trackSelect")).not.toHaveText("");
    await expect(workspacePage.locator("#recommendedActionButton")).toBeVisible();

    await workspacePage.locator("#recommendedActionButton").click();

    if (!(await waitForAnalysisResult(workspacePage, 15000))) {
      const statusText = (await workspacePage.locator("#statusBanner").textContent()) || "";
      throw new Error(`ScriptLens never produced a report. Last status: ${statusText.trim()}`);
    }

    await expect(workspacePage.locator("#scoreValue")).toHaveText(/^\d+$/);
    await expect(workspacePage.locator("#verdictBadge")).not.toHaveText("");
    await expect(workspacePage.locator("#reportSource")).not.toHaveText("");
  });
});

async function waitForAnalysisResult(page, timeoutMs) {
  try {
    await expect(page.locator("#resultContent")).toBeVisible({ timeout: timeoutMs });
    return true;
  } catch (error) {
    return false;
  }
}
