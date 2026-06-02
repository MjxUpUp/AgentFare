// ISSUE-064: re-export from headers.ts (single implementation)
// Kept as a re-export shim for backward compatibility with existing imports.
export { isInternalRequest, makeInternalHeaders } from "./headers.js";
