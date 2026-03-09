const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { test, expect } = require("@playwright/test");

const ROOT_DIR = path.join(__dirname, "..");
const SERVICE_WORKER_PATH = path.join(ROOT_DIR, "service-worker.js");

test.describe("ScriptLens inline runtime routing", () => {
  test("inline init prefers sender.tab over an explicit tabId", async () => {
    const { sandbox, calls } = loadServiceWorkerSandbox();

    const response = await sandbox.buildInlineInitResponse(
      {
        tabId: 999,
        windowId: 4
      },
      {
        tab: {
          id: 321,
          windowId: 7,
          url: "https://www.youtube.com/watch?v=sender123"
        }
      }
    );

    expect(calls.tabQueries).toBe(0);
    expect(calls.tabGets).toBe(0);
    expect(calls.tabMessages).toEqual([
      {
        tabId: 321,
        message: {
          type: "page:context"
        }
      }
    ]);
    expect(response.ok).toBeTruthy();
    expect(response.inlineSettings.allowBackendTranscriptFallback).toBeTruthy();
    expect(response.pageContext.tabId).toBe(321);
    expect(response.pageContext.windowId).toBe(7);
  });

  test("resolveContextTab falls back to the explicit tabId when no sender tab is available", async () => {
    const { sandbox, calls } = loadServiceWorkerSandbox();

    const tab = await sandbox.resolveContextTab(
      {
        tabId: 777,
        windowId: 12
      },
      {},
      true
    );

    expect(calls.tabGets).toBe(1);
    expect(calls.tabQueries).toBe(0);
    expect(tab.id).toBe(777);
    expect(tab.windowId).toBe(12);
  });
});

function loadServiceWorkerSandbox() {
  const calls = {
    tabQueries: 0,
    tabGets: 0,
    tabMessages: []
  };
  const localStorageState = {
    settings: {
      sensitivity: "medium",
      maxTextLength: 18000,
      minCharacters: 180,
      minWords: 40,
      recentReportsLimit: 5,
      debugMode: false,
      allowBackendTranscriptFallback: true,
      backendTranscriptEndpoint: "http://127.0.0.1:4317/transcript/resolve"
    }
  };

  const sandbox = {
    console,
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    fetch: async () => {
      throw new Error("fetch not stubbed");
    },
    importScripts() {},
    chrome: {
      runtime: {
        lastError: null,
        onInstalled: {
          addListener() {}
        },
        onMessage: {
          addListener() {}
        },
        getManifest() {
          return { version: "0.1.0" };
        }
      },
      storage: {
        local: {
          get(_keys, callback) {
            callback(localStorageState);
          },
          set(value, callback) {
            Object.assign(localStorageState, value);
            callback();
          }
        },
        session: {
          get(_keys, callback) {
            callback({});
          },
          set(_value, callback) {
            callback();
          },
          remove(_keys, callback) {
            callback();
          }
        }
      },
      tabs: {
        query(_queryInfo, callback) {
          calls.tabQueries += 1;
          callback([
            {
              id: 111,
              windowId: 2,
              url: "https://www.youtube.com/watch?v=active999"
            }
          ]);
        },
        get(tabId, callback) {
          calls.tabGets += 1;
          callback({
            id: tabId,
            windowId: 12,
            url: `https://www.youtube.com/watch?v=${tabId}`
          });
        },
        sendMessage(tabId, message, callback) {
          calls.tabMessages.push({ tabId, message });
          callback({
            ok: true,
            context: {
              supported: true,
              hostname: "youtube.com",
              isYouTubeVideo: true,
              video: {
                availableSources: {
                  transcript: true,
                  description: true,
                  title: true
                },
                defaultTrackBaseUrl: "",
                transcriptTracks: []
              }
            }
          });
        }
      },
      sidePanel: {
        open(_options, callback) {
          callback();
        }
      }
    },
    globalThis: {}
  };

  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(SERVICE_WORKER_PATH, "utf8"), sandbox, {
    filename: SERVICE_WORKER_PATH
  });

  return { sandbox, calls };
}
