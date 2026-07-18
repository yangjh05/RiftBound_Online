import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";

export async function handleUpdateRequest(req, res, { root }) {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  if (!url.pathname.startsWith("/api/update")) return false;

  if (req.method === "OPTIONS") {
    res.writeHead(204, updateHeaders({
      "access-control-allow-methods": "GET, HEAD, OPTIONS",
      "access-control-allow-headers": "content-type",
      "access-control-max-age": "86400"
    }));
    res.end();
    return true;
  }

  try {
    const published = await readPublishedUpdate(root);
    if (req.method === "GET" && url.pathname === "/api/update/latest") {
      return json(res, 200, published.manifest);
    }

    const match = url.pathname.match(/^\/api\/update\/download\/([^/]+)$/u);
    if ((req.method === "GET" || req.method === "HEAD") && match) {
      const requestedBuildId = decodeURIComponent(match[1]);
      if (requestedBuildId !== published.manifest.buildId) {
        return json(res, 404, { ok: false, message: "Update build is no longer available." });
      }
      const headers = updateHeaders({
        "accept-ranges": "none",
        "cache-control": "public, max-age=31536000, immutable",
        "content-disposition": "attachment; filename*=UTF-8''Riftbound%20Online.exe",
        "content-length": String(published.file.size),
        "content-type": "application/vnd.microsoft.portable-executable",
        "x-content-type-options": "nosniff"
      });
      res.writeHead(200, headers);
      if (req.method === "HEAD") {
        res.end();
        return true;
      }
      await pipeline(createReadStream(published.filePath), res);
      return true;
    }

    return json(res, 404, { ok: false, message: "Unknown update route." });
  } catch (error) {
    if (responseIsCommitted(res)) {
      if (!res.writableEnded && !res.destroyed) res.destroy?.();
      return true;
    }
    if (error?.code === "ENOENT") {
      return json(res, 404, { ok: false, message: "No desktop update has been published yet." });
    }
    return json(res, 500, { ok: false, message: error?.message || "Update server error." });
  }
}

export async function readPublishedUpdate(root) {
  const manifestPath = path.join(root, "dist", "update.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  validateManifest(manifest);
  const filePath = path.join(root, "dist", "updates", manifest.buildId, "Riftbound Online.exe");
  const file = await stat(filePath);
  if (!file.isFile() || file.size !== manifest.size) throw new Error("Published update file does not match its manifest.");
  return { manifest, filePath, file };
}

export function validateManifest(manifest) {
  if (!manifest || manifest.ok !== true) throw new Error("Invalid update manifest.");
  if (!/^[A-Za-z0-9._-]+$/u.test(manifest.buildId || "")) throw new Error("Invalid update build ID.");
  if (!Number.isSafeInteger(manifest.size) || manifest.size <= 0) throw new Error("Invalid update size.");
  if (!/^[a-f0-9]{64}$/u.test(manifest.sha256 || "")) throw new Error("Invalid update checksum.");
  if (typeof manifest.signature !== "string" || !/^[A-Za-z0-9+/]{86}==$/u.test(manifest.signature)) {
    throw new Error("Invalid update signature.");
  }
  if (typeof manifest.downloadUrl !== "string" || !manifest.downloadUrl.startsWith("/api/update/download/")) {
    throw new Error("Invalid update download URL.");
  }
  return manifest;
}

function json(res, status, payload) {
  if (responseIsCommitted(res)) return true;
  res.writeHead(status, updateHeaders({
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8"
  }));
  res.end(JSON.stringify(payload));
  return true;
}

function responseIsCommitted(res) {
  return Boolean(res.headersSent || res.writableEnded || res.destroyed);
}

function updateHeaders(extra = {}) {
  return {
    "access-control-allow-origin": "*",
    ...extra
  };
}
