/**
 * @file background.js
 * This script runs in the background of the extension and handles all major logic,
 * including data storage, fetching remote content, and processing text.
 */

// Note: This script depends on Readability.js, which we will need to add
// to a 'lib' directory in the project.
// --- Initialization ---

/**
 * Initializes the extension's local storage on installation.
 * Checks for the existence of 'kuatoLibrary' and creates an empty array if it doesn't exist.
 */
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['kuatoLibrary'], (result) => {
    if (!result.kuatoLibrary) {
      chrome.storage.local.set({ kuatoLibrary: [] });
      console.log('Kuato library initialized.');
    }
  });
});

// --- Library Management Functions ---

/**
 * Retrieves the entire book library from Chrome's local storage.
 * @returns {Promise<Array>} A promise that resolves to the array of book objects.
 */
async function getLibrary() {
  const result = await chrome.storage.local.get(['kuatoLibrary']);
  return result.kuatoLibrary || [];
}

/**
 * Adds a new book object to the library.
 * @param {object} bookData - The book object to add.
 * @returns {Promise<object>} A promise that resolves to the added book object, now with an ID.
 */
async function addBook(bookData) {
  const library = await getLibrary();
  bookData.id = `book_${Date.now()}`; 
  library.push(bookData);
  await chrome.storage.local.set({ kuatoLibrary: library });
  return bookData;
}

/**
 * Retrieves a single book from the library by its ID.
 * @param {string} bookId - The ID of the book to retrieve.
 * @returns {Promise<object|undefined>} A promise that resolves to the book object, or undefined if not found.
 */
async function getBook(bookId) {
    const library = await getLibrary();
    return library.find(book => book.id === bookId);
}

/**
 * Updates an existing book in the library.
 * @param {string} bookId - The ID of the book to update.
 * @param {object} updatedData - An object containing the properties to update.
 * @returns {Promise<object|null>} A promise that resolves to the updated book object, or null if not found.
 */
async function updateBook(bookId, updatedData) {
    const library = await getLibrary();
    const bookIndex = library.findIndex(book => book.id === bookId);
    if (bookIndex !== -1) {
        library[bookIndex] = { ...library[bookIndex], ...updatedData };
        await chrome.storage.local.set({ kuatoLibrary: library });
        return library[bookIndex];
    }
    return null;
}

// --- Message Listener ---

/**
 * Listens for messages from other parts of the extension (like content scripts).
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'addBookFromText') {
        const { title, text, sourceUrl } = request;

        const chunkSize = 2000;
        const chunks = [];
        for (let i = 0; i < text.length; i += chunkSize) {
            chunks.push({
                chunkIndex: chunks.length,
                content: text.substring(i, i + chunkSize),
                status: 'pending'
            });
        }

        const newBook = {
            title: title,
            sourceUrl: sourceUrl,
            chunks: chunks,
            lastSentChunk: -1
        };

        addBook(newBook).then(addedBook => {
            sendResponse({ success: true, book: addedBook });
        }).catch(error => {
            console.error('[Kuato] Failed to add book:', error);
            sendResponse({ success: false, error: error.message });
        });

        return true; // Indicates asynchronous response
    }

    if (request.action === 'getLibrary') {
        getLibrary().then(library => {
            sendResponse({ success: true, library: library });
        });
        return true;
    } else if (request.action === 'getBook') {
        getBook(request.bookId).then(book => {
            sendResponse({ success: true, book: book });
        });
        return true;
    } else if (request.action === 'uploadToPastebin') {
        const formData = new FormData();
        formData.append('c', request.content);

        fetch('https://fars.ee/?u=1', {
            method: 'POST',
            body: formData
        })
        .then(response => response.text())
        .then(url => {
            sendResponse({ success: true, url: url.trim() });
        })
        .catch(error => {
            console.error('Error uploading to pastebin:', error);
            sendResponse({ success: false, error: error.message });
        });
        return true;
    } else if (request.action === 'updateBook') {
        updateBook(request.bookId, request.data).then(book => {
            sendResponse({ success: true, book: book });
        });
        return true;
    }
});
