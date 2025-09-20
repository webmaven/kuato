# Kuato Extension Agent Notes

This document provides a high-level overview of the Kuato Chrome Extension project for other AI agents.

## Project Architecture

The extension is designed to extract text from web pages and feed it to an AI companion in manageable chunks. The architecture is composed of three main parts to handle Chrome's security and environment constraints (Manifest V3):

1.  **Content Script (`extension/content.js`)**: This is the user-facing component.
    *   Injects the UI panel into the Nomi.ai web page.
    *   Handles all user interactions (loading books, sending chunks, renaming, etc.).
    *   Sends messages to the background script to request actions.
    *   **Note**: This script uses specific CSS selectors to interact with the Nomi.ai page. These are stored in the `nomiSelectors` object and may need updating if the site changes.

2.  **Background Script (`extension/background.js`)**: This is the central orchestrator and data manager.
    *   It has no direct access to the DOM.
    *   It listens for messages from the content script.
    *   It handles all interactions with `chrome.storage.local` (saving, retrieving, and updating books).
    *   It uses its elevated permissions to `fetch` content from external URLs, bypassing CORS restrictions.
    *   It orchestrates the use of the Offscreen Document for parsing.
    *   It handles uploading content to the `fars.ee` pastebin service.

3.  **Offscreen Document (`extension/offscreen.html`, `extension/offscreen.js`)**: This is a specialized, hidden document.
    *   Its sole purpose is to provide a DOM environment for parsing HTML.
    *   The background script sends raw HTML to it, and it uses `Readability.js` to parse the content and send the result back.
    *   This is the standard Manifest V3 workaround for background scripts needing DOM access.

## Data Flow for Loading a Book

1.  `content.js` sends a `loadUrl` message to `background.js`.
2.  `background.js` fetches the URL.
3.  If the content is HTML, `background.js` passes the HTML string to the `offscreen.js` document for parsing.
4.  `offscreen.js` parses the HTML and returns the clean text and title to `background.js`.
5.  `background.js` chunks the final text and saves the book object to storage.
6.  `background.js` sends a confirmation back to `content.js`.
Excellent.
