/**
 * @file background.js
 * This script runs in the background of the extension and handles all major logic,
 * including data storage and orchestrating the parsing of remote content.
 */

// --- Initialization ---
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['kuatoLibrary'], (result) => {
    if (!result.kuatoLibrary) {
      chrome.storage.local.set({ kuatoLibrary: [] });
      console.log('Kuato library initialized.');
    }
  });
});

// --- Library Management Functions ---

async function getLibrary() {
  const result = await chrome.storage.local.get(['kuatoLibrary']);
  return result.kuatoLibrary || [];
}

async function addBook(bookData) {
  const library = await getLibrary();
  bookData.id = `book_${Date.now()}`; 
  library.push(bookData);
  await chrome.storage.local.set({ kuatoLibrary: library });
  return bookData;
}

async function getBook(bookId) {
    const library = await getLibrary();
    return library.find(book => book.id === bookId);
}

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

// --- Offscreen Document Management ---

let creating; // A global promise to avoid race conditions

async function hasOffscreenDocument(path) {
  if (chrome.runtime.getContexts) {
      const contexts = await chrome.runtime.getContexts({
          contextTypes: ['OFFSCREEN_DOCUMENT'],
          documentUrls: [path]
      });
      return !!contexts.length;
  } else {
      // Fallback for older Chrome versions
      const views = chrome.extension.getViews({ type: 'OFFSCREEN_DOCUMENT' });
      return views.some(view => view.location.href === path);
  }
}

async function setupOffscreenDocument(path) {
  if (creating) {
    await creating;
  } else {
    if (!(await hasOffscreenDocument(path))) {
      creating = chrome.offscreen.createDocument({
        url: path,
        reasons: ['DOM_PARSER'],
        justification: 'To parse HTML content from fetched URLs.',
      });
      await creating;
      creating = null;
    }
  }
}

// --- Main Logic ---

async function processAndSaveBook(title, textContent, sourceUrl) {
    const chunkSize = 2000;
    const chunks = [];
    for (let i = 0; i < textContent.length; i += chunkSize) {
        chunks.push({
            chunkIndex: chunks.length,
            content: textContent.substring(i, i + chunkSize),
            status: 'pending'
        });
    }
    
    const newBook = {
        title: title,
        sourceUrl: sourceUrl,
        chunks: chunks,
        lastSentChunk: -1
    };

    return await addBook(newBook);
}

// --- Message Listener ---

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'loadUrl') {
        const url = request.url;
        (async () => {
            try {
                const response = await fetch(url);
                if (!response.ok) {
                    throw new Error(`Network request failed with status ${response.status}`);
                }

                const contentType = response.headers.get('content-type');
                const rawText = await response.text();
                let title, textContent;

                if (contentType && contentType.includes('text/html')) {
                    await setupOffscreenDocument('offscreen.html');
                    const result = await chrome.runtime.sendMessage({
                        action: 'parseHtml',
                        target: 'offscreen',
                        html: rawText
                    });

                    if (!result.success) throw new Error(result.error);
                    title = result.article.title;
                    textContent = result.article.textContent;
                } else {
                    title = new URL(url).pathname.split('/').pop() || 'Untitled Text';
                    textContent = rawText;
                }

                const addedBook = await processAndSaveBook(title, textContent, url);
                sendResponse({ success: true, book: addedBook });

            } catch (error) {
                console.error('[Kuato] Failed to load URL:', error);
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true; // Indicates asynchronous response
    }

    if (request.action === 'loadFile') {
        const { filename, content } = request;
        (async () => {
            try {
                let title, textContent;
                const isHtml = filename.toLowerCase().endsWith('.html') || filename.toLowerCase().endsWith('.htm');

                if (isHtml) {
                    await setupOffscreenDocument('offscreen.html');
                    const result = await chrome.runtime.sendMessage({
                        action: 'parseHtml',
                        target: 'offscreen',
                        html: content
                    });

                    if (!result.success) throw new Error(result.error);
                    title = result.article.title || filename; // Fallback to filename
                    textContent = result.article.textContent;
                } else {
                    // For .txt and other files, treat as plain text
                    title = filename;
                    textContent = content;
                }

                const addedBook = await processAndSaveBook(title, textContent, `file://${filename}`);
                sendResponse({ success: true, book: addedBook });

            } catch (error) {
                console.error('[Kuato] Failed to load file:', error);
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true; // Indicates asynchronous response
    }
    
    // Keep other message handlers
    if (request.action === 'getLibrary') {
        getLibrary().then(library => sendResponse({ success: true, library }));
        return true;
    }
    if (request.action === 'getBook') {
        getBook(request.bookId).then(book => sendResponse({ success: true, book }));
        return true;
    }
    if (request.action === 'updateBook') {
        updateBook(request.bookId, request.data).then(book => sendResponse({ success: true, book }));
        return true;
    }
    if (request.action === 'uploadToPastebin') {
        const formData = new FormData();
        formData.append('c', request.content);
        fetch('https://fars.ee/?u=1', { method: 'POST', body: formData })
            .then(response => response.text())
            .then(url => {
                const trimmedUrl = url.trim();
                if (trimmedUrl.startsWith('http')) {
                    sendResponse({ success: true, url: trimmedUrl });
                } else {
                    throw new Error(`Invalid response from pastebin: ${trimmedUrl}`);
                }
            })
            .catch(error => {
                console.error('Error uploading to pastebin:', error);
                sendResponse({ success: false, error: error.message });
            });
        return true;
    }
});
