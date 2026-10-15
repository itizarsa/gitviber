// GitViber runs on macOS only.

/** ⌘: the key a click is held with to add a row, or follow a link. */
export const primaryKey = (e: { metaKey: boolean }) => e.metaKey;

/** What macOS calls showing a file in its file manager. */
export const REVEAL_LABEL = "Reveal in Finder";
export const REVEAL_FAILED = "Could not reveal in Finder";
