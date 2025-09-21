# Testing the Kuato Extension

This document outlines how to run the automated tests for the Kuato Chrome Extension and provides an overview of their scope and design.

## How to Run the Tests

The test suite is designed to be run directly in a web browser. No special test runner or command-line tool is required.

1.  **Open the Test Runner:**
    *   Navigate to the `extension/tests/` directory within the project.
    *   Open the `test-runner.html` file in your web browser (e.g., Chrome, Firefox).

2.  **View the Results:**
    *   The page will load and automatically execute all the tests.
    *   The results are displayed directly on the page, showing a summary of passed and failed tests, along with details for each assertion.

## Test Coverage and Philosophy

The tests are focused on the core logic contained within the **background script (`background.js`)**. They are designed as **unit tests** to ensure the reliability of data processing and storage, independent of the live extension environment.

### What is Covered:

*   **Text Processing:** Splitting text into chunks, handling chapters, and processing different file formats (`.txt`, `.pdf`, `.html`).
*   **Library Management:** Adding, retrieving, and saving books to `chrome.storage.local`.
*   **Settings Management:** Saving and retrieving user settings.
*   **Message Handling:** Logic for responding to messages from other parts of the extension, such as `loadFile`.

### What is NOT Covered:

*   **UI Interactions:** The tests do not cover the content script (`content.js`) or any of the UI components injected into the web page.
*   **Live Environment:** These are not end-to-end tests. They do not run inside a live Chrome extension instance.

### Mocks

To achieve this isolated testing, the test suite uses mocks for:

*   **Chrome APIs:** `chrome.runtime`, `chrome.storage`, etc., are mocked to simulate their behavior without needing to be in a real extension.
*   **External Libraries:** `Readability.js` and `pdf.js` are replaced with mock versions that return predictable data, allowing the tests to focus on how that data is handled rather than the parsing itself.
