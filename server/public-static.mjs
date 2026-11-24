import path from "node:path";

const PUBLIC_ROOT_FILES = new Set(["index.html", "build-info.json"]);
const PUBLIC_DIRECTORIES = new Set(["src", "assets"]);

/**
 * Resolve only files that are part of the browser application. The server root
 * also contains credentials, source-control metadata and private report data,
 * so a generic "file below root" check is intentionally insufficient here.
 */
export function resolvePublicStaticPath(root, requestUrl) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(requestUrl, "http://localhost").pathname);
  } catch {
    return null;
  }

  if (pathname === "/") pathname = "/index.html";
  if (pathname.includes("\0") || pathname.includes("\\")) return null;

  const segments = pathname.replace(/^\/+/, "").split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) return null;

  const [topLevel] = segments;
  const isRootFile = segments.length === 1 && PUBLIC_ROOT_FILES.has(topLevel);
  const isPublicDirectory = segments.length > 1 && PUBLIC_DIRECTORIES.has(topLevel);
  if (!isRootFile && !isPublicDirectory) return null;

  const resolvedRoot = path.resolve(root);
  const filePath = path.resolve(resolvedRoot, ...segments);
  const relative = path.relative(resolvedRoot, filePath);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) return null;
  return filePath;
}

