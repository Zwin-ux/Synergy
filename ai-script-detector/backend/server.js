const http = require("http");
const { resolveTranscriptRequest, DEFAULT_TOTAL_TIMEOUT_MS } = require("./resolve");

const DEFAULT_PORT = 4317;
const DEFAULT_HOST = "127.0.0.1";

module.exports = {
  DEFAULT_HOST,
  DEFAULT_PORT,
  createBackendServer,
  startBackendServer
};

function createBackendServer(options = {}) {
  return http.createServer(async (request, response) => {
    applyCorsHeaders(response);

    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
    if (request.method !== "POST" || url.pathname !== "/transcript/resolve") {
      writeJson(response, 404, {
        ok: false,
        errorCode: "not_found",
        errorMessage: "Unsupported route."
      });
      return;
    }

    const controller = new AbortController();
    const timeoutMs = clampNumber(
      options.totalTimeoutMs,
      1000,
      20000,
      DEFAULT_TOTAL_TIMEOUT_MS
    );
    const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
    request.on("aborted", () => controller.abort(new Error("client_closed")));
    response.on("close", () => {
      if (!response.writableEnded) {
        controller.abort(new Error("client_closed"));
      }
    });

    try {
      const body = await readJsonBody(request);
      const result = await resolveTranscriptRequest(body, {
        ...options,
        signal: controller.signal
      });
      writeJson(response, 200, result);
    } catch (error) {
      const statusCode = /invalid json/i.test(String(error?.message || "")) ? 400 : 500;
      writeJson(response, statusCode, {
        ok: false,
        providerClass: "backend",
        sourceLabel: "Backend transcript unavailable",
        sourceConfidence: "low",
        quality: "enhanced-extraction-unavailable",
        languageCode: null,
        originalLanguageCode: null,
        isGenerated: null,
        coverageRatio: null,
        transcriptSpanSeconds: null,
        videoDurationSeconds: null,
        warnings: ["backend_server_error"],
        errorCode: statusCode === 400 ? "invalid_json" : "backend_server_error",
        errorMessage:
          statusCode === 400
            ? "The request body was not valid JSON."
            : error?.message || "The backend transcript server failed.",
        segments: [],
        text: ""
      });
    } finally {
      clearTimeout(timer);
    }
  });
}

async function startBackendServer(options = {}) {
  const server = createBackendServer(options);
  const host = options.host || DEFAULT_HOST;
  const port = clampNumber(options.port, 1, 65535, DEFAULT_PORT);

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  return {
    server,
    host,
    port,
    url: `http://${host}:${port}/transcript/resolve`
  };
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        reject(new Error("Request body too large."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });

    request.on("end", () => {
      const source = Buffer.concat(chunks).toString("utf8").trim();
      if (!source) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(source));
      } catch (error) {
        reject(new Error("invalid json"));
      }
    });

    request.on("error", reject);
  });
}

function applyCorsHeaders(response) {
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-methods", "POST, OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type");
  response.setHeader("cache-control", "no-store");
  response.setHeader("content-type", "application/json; charset=utf-8");
}

function writeJson(response, statusCode, payload) {
  response.writeHead(statusCode);
  response.end(JSON.stringify(payload));
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, number));
}

if (require.main === module) {
  startBackendServer({
    host: process.env.SCRIPTLENS_BACKEND_HOST || DEFAULT_HOST,
    port: process.env.SCRIPTLENS_BACKEND_PORT || DEFAULT_PORT,
    totalTimeoutMs: process.env.SCRIPTLENS_BACKEND_TIMEOUT_MS || DEFAULT_TOTAL_TIMEOUT_MS
  })
    .then((info) => {
      process.stdout.write(`ScriptLens backend listening on ${info.url}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
      process.exitCode = 1;
    });
}
