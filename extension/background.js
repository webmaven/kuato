/**
 * @file background.js
 * This script runs in the background of the extension and handles all major logic,
 * including data storage and orchestrating the parsing of remote content.
 */

// --- Initialization ---
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['kuatoLibrary', 'kuatoSettings'], (result) => {
    if (!result.kuatoLibrary) {
      chrome.storage.local.set({ kuatoLibrary: [] });
      console.log('Kuato library initialized.');
    }
    if (!result.kuatoSettings) {
      chrome.storage.local.set({
        kuatoSettings: {
          chunkSize: 2000,
          pastebinService: 'fars.ee',
          messageFormat: '[From "{title}", Part {chunkIndex}/{chunkCount}] Please read this: {url}'
        }
      });
      console.log('Kuato settings initialized.');
    }
  });
});

// --- Settings Management ---
async function getSettings() {
    const result = await chrome.storage.local.get('kuatoSettings');
    return result.kuatoSettings;
}

async function saveSettings(settings) {
    await chrome.storage.local.set({ kuatoSettings: settings });
    return settings;
}


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

const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';
let readyPromise = null;
let resolveReadyPromise = null;

async function setupOffscreenDocument() {
    if (readyPromise) {
        return readyPromise;
    }

    readyPromise = new Promise((resolve) => {
        resolveReadyPromise = resolve;
    });

    const existingContexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT']
    });

    if (existingContexts.length > 0) {
        // If a document exists, we assume it's ready. If not, the subsequent
        // message send will fail, and the document will be cleaned up.
        resolveReadyPromise();
    } else {
        await chrome.offscreen.createDocument({
            url: OFFSCREEN_DOCUMENT_PATH,
            reasons: ['DOM_PARSER'],
            justification: 'To parse HTML and PDF content.',
        });
    }

    return readyPromise;
}

async function closeOffscreenDocument() {
    const existingContexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT']
    });
    if (existingContexts.length > 0) {
        await chrome.offscreen.closeDocument();
    }
    readyPromise = null;
    resolveReadyPromise = null;
}

// --- Main Logic ---

async function processAndSaveBook(title, textContent, sourceUrl) {
    const settings = await getSettings();
    const chunkSize = settings.chunkSize || 2000;
    const allChunks = [];

    // Regex to find chapter headings
    const chapterRegex = /(?:^|\n\n)(Chapter\s+\d+|Part\s+\d+|Book\s+\d+)/gi;
    const chapters = textContent.split(chapterRegex);

    let chapterTitle = "Introduction";
    let chapterIndex = 0;

    for (let i = 0; i < chapters.length; i++) {
        let text = chapters[i];
        if (i % 2 === 1) { // This is a chapter title match
            chapterTitle = text.trim();
            chapterIndex++;
            continue; // The next item in the array is the content of this chapter
        }

        let remainingText = text.trim();
        if (!remainingText) continue;

        let chunkIndexInChapter = 0;
        while (remainingText.length > 0) {
            let chunkContent;
            if (remainingText.length <= chunkSize) {
                chunkContent = remainingText;
                remainingText = '';
            } else {
                let splitAt = -1;
                splitAt = remainingText.lastIndexOf('\n\n', chunkSize);
                if (splitAt === -1) {
                    const sentenceEnders = ['.', '!', '?'];
                    for (const ender of sentenceEnders) {
                        const potentialSplit = remainingText.lastIndexOf(ender + ' ', chunkSize);
                        if (potentialSplit > splitAt) splitAt = potentialSplit;
                    }
                }
                if (splitAt === -1) splitAt = remainingText.lastIndexOf(' ', chunkSize);
                if (splitAt === -1) splitAt = chunkSize;

                chunkContent = remainingText.substring(0, splitAt + 1);
                remainingText = remainingText.substring(splitAt + 1);
            }

            allChunks.push({
                chunkIndex: allChunks.length,
                chapter: chapterTitle,
                chapterChunkIndex: chunkIndexInChapter++,
                content: chunkContent.trim(),
                status: 'pending'
            });
        }
    }

    const newBook = {
        title: title,
        sourceUrl: sourceUrl,
        chunks: allChunks,
        lastSentChunk: -1
    };

    return await addBook(newBook);
}

// --- Message Listener ---

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Handle the readiness signal from the offscreen document.
    if (request.action === 'offscreenReady') {
        if (resolveReadyPromise) {
            resolveReadyPromise();
        }
        return false; // No need to keep the channel open.
    }

    if (request.action === 'loadUrl') {
        const url = request.url;
        (async () => {
            let needsOffscreen = false;
            try {
                const response = await fetch(url);
                if (!response.ok) throw new Error(`Network request failed: ${response.status}`);

                const contentType = response.headers.get('content-type') || '';
                let title, textContent;

                if (contentType.includes('text/html') || contentType.includes('application/pdf')) {
                    needsOffscreen = true;
                    await setupOffscreenDocument();

                    if (contentType.includes('text/html')) {
                        const rawText = await response.text();
                        const result = await chrome.runtime.sendMessage({ action: 'parseHtml', target: 'offscreen', html: rawText });
                        if (!result.success) throw new Error(result.error);
                        title = result.article.title;
                        textContent = result.article.textContent;
                    } else { // PDF
                        const pdfData = await response.arrayBuffer();
                        const result = await chrome.runtime.sendMessage({ action: 'parsePdf', target: 'offscreen', pdfData: pdfData });
                        if (!result.success) throw new Error(result.error);
                        title = new URL(url).pathname.split('/').pop() || 'Untitled PDF';
                        textContent = result.textContent;
                    }
                } else {
                    // Plain text
                    textContent = await response.text();
                    title = new URL(url).pathname.split('/').pop() || 'Untitled Text';
                }

                const addedBook = await processAndSaveBook(title, textContent, url);
                sendResponse({ success: true, book: addedBook });

            } catch (error) {
                console.error('[Kuato] Failed to load URL:', error);
                sendResponse({ success: false, error: error.message });
            } finally {
                if (needsOffscreen) {
                    await closeOffscreenDocument();
                }
            }
        })();
        return true;
    }

    if (request.action === 'loadFile') {
        const { filename, encoding, content } = request;
        (async () => {
            let needsOffscreen = false;
            try {
                let title, textContent;
                const isPdf = filename.toLowerCase().endsWith('.pdf');
                const isHtml = filename.toLowerCase().endsWith('.html') || filename.toLowerCase().endsWith('.htm');

                if (isPdf || isHtml) {
                    needsOffscreen = true;
                    await setupOffscreenDocument();

                    if (isPdf) {
                        // Manually decode the base64 data URL. The fetch() API in service workers
                        // does not reliably handle data URLs.
                        const base64Data = content.split(',')[1];
                        const binaryStr = atob(base64Data);
                        const len = binaryStr.length;
                        const pdfData = new Uint8Array(len);
                        for (let i = 0; i < len; i++) {
                            pdfData[i] = binaryStr.charCodeAt(i);
                        }

                        const result = await chrome.runtime.sendMessage({ action: 'parsePdf', target: 'offscreen', pdfData: pdfData });
                        if (!result.success) throw new Error(result.error);
                        title = filename;
                        textContent = result.textContent;
                    } else { // HTML
                        const result = await chrome.runtime.sendMessage({ action: 'parseHtml', target: 'offscreen', html: content });
                        if (!result.success) throw new Error(result.error);
                        title = result.article.title || filename;
                        textContent = result.article.textContent;
                    }
                } else {
                    // Plain text
                    title = filename;
                    textContent = content;
                }

                const addedBook = await processAndSaveBook(title, textContent, `file://${filename}`);
                sendResponse({ success: true, book: addedBook });

            } catch (error) {
                console.error('[Kuato] Failed to load file:', error);
                sendResponse({ success: false, error: error.message });
            } finally {
                if (needsOffscreen) {
                    await closeOffscreenDocument();
                }
            }
        })();
        return true;
    }
    
    // Keep other message handlers...
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
    if (request.action === 'getSettings') {
        getSettings().then(settings => sendResponse({ success: true, settings }));
        return true;
    }
    if (request.action === 'saveSettings') {
        saveSettings(request.settings).then(settings => sendResponse({ success: true, settings }));
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
