/**
 * The message an agency owner can act on. "Missing or invalid dashboard token" is what
 * the server says and it is accurate; it is also meaningless to the person reading it,
 * and it looked identical to a network error in the same banner.
 *
 * It lives in its OWN module rather than in `api.ts` because several places compare
 * against it — `App.tsx` branches on this exact string to choose the amber instruction
 * banner over the red error one — and `api.ts` reads `import.meta.env` at module load.
 * Importing the constant therefore dragged in Vite's build-time environment, which is
 * absent under plain node, so any check of the logic that depends on it could not run
 * outside a browser. A shared constant should not need a bundler to be readable.
 *
 * `api.ts` re-exports it, so every existing import keeps working.
 */
export const SESSION_EXPIRED_MESSAGE =
  "Your Mosaic session has expired. Click Mosaic in your GoHighLevel sidebar to open it again — any unsaved changes on this screen will be lost.";
