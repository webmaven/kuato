# Kuato Chrome Extension

Kuato is a Quality-of-Life (QOL) enhancement extension for AI companion services, initially targeting Nomi.ai.

## Features

### Text Pre-processing and Chunking

This feature allows you to take a long piece of text from a URL (like an article or a book from Project Gutenberg), and feed it to your Nomi companion piece by piece. This avoids the AI's tendency to excessively summarize very long texts.

#### How to Use

1.  **Load the Extension:** Follow the installation instructions below.
2.  **Open Nomi.ai:** Navigate to a chat with one of your Nomis.
3.  **Find the Kuato Panel:** A "Kuato Library" panel will appear in the top-right corner of the page.
4.  **Load a New Book:**
    *   Click the "Load New Book from URL" button.
    *   Enter the URL of the article or book you want to load.
    *   The extension will fetch the text, process it, and add it to your local library.
5.  **Select a Book:**
    *   Choose your newly loaded book from the "Select Book:" dropdown.
    *   The panel will display the book's title and a list of all its text chunks.
6.  **Send the Text:**
    *   **Send Next Chapter:** Click this button to send the next available chunk to your Nomi. The button will be disabled until the Nomi responds.
    *   **Send All:** Click this to automatically send all chunks in sequence. The extension will wait for a Nomi response between each chunk. You can use the "Pause" button to stop this process.
    *   **Retry:** If a chunk fails to send, or you want to send it again, you can use the "Retry" button next to that specific chunk.

## Installation

1.  Place all the provided files (`manifest.json`, `background.js`, `content.js`, `README.md`, etc.) together in a new directory.
2.  Create a subdirectory named `lib` and place the `Readability.js` file inside it.
3.  Open Google Chrome and navigate to `chrome://extensions`.
4.  In the top right corner, turn on **"Developer mode"**.
5.  Click the **"Load unpacked"** button that appears on the top left.
6.  In the file selection dialog, choose the directory you created in step 1.

The Kuato extension should now be installed and ready to use on Nomi.ai.
