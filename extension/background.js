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
    if (request.action === 'loadUrl') {
        const url = request.url;
        (async () => {
            try {
                const response = await fetch(url);
                if (!response.ok) {
                    throw new Error(`Network request failed with status ${response.status}`);
                }

                const contentType = response.headers.get('content-type') || '';
                let title, textContent;

                if (contentType.includes('text/html')) {
                    const rawText = await response.text();
                    await setupOffscreenDocument('offscreen.html');
                    const result = await chrome.runtime.sendMessage({
                        action: 'parseHtml',
                        target: 'offscreen',
                        html: rawText
                    });

                    if (!result.success) throw new Error(result.error);
                    title = result.article.title;
                    textContent = result.article.textContent;
                } else if (contentType.includes('application/pdf')) {
                    const pdfData = await response.arrayBuffer();
                    await setupOffscreenDocument('offscreen.html');
                    const result = await chrome.runtime.sendMessage({
                        action: 'parsePdf',
                        target: 'offscreen',
                        pdfData: pdfData
                    });

                    if (!result.success) throw new Error(result.error);
                    title = new URL(url).pathname.split('/').pop() || 'Untitled PDF';
                    textContent = result.textContent;
                } else {
                    const rawText = await response.text();
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
        const { filename, encoding, content } = request;
        (async () => {
            try {
                let title, textContent;

                if (encoding === 'dataURL') {
                    // It's a PDF file
                    const response = await fetch(content);
                    const pdfData = await response.arrayBuffer();

                    await setupOffscreenDocument('offscreen.html');
                    const result = await chrome.runtime.sendMessage({
                        action: 'parsePdf',
                        target: 'offscreen',
                        pdfData: pdfData
                    });

                    if (!result.success) throw new Error(result.error);
                    title = filename;
                    textContent = result.textContent;

                } else {
                    // It's a text-based file (HTML or TXT)
                    const isHtml = filename.toLowerCase().endsWith('.html') || filename.toLowerCase().endsWith('.htm');
                    if (isHtml) {
                        await setupOffscreenDocument('offscreen.html');
                        const result = await chrome.runtime.sendMessage({
                            action: 'parseHtml',
                            target: 'offscreen',
                            html: content
                        });

                        if (!result.success) throw new Error(result.error);
                        title = result.article.title || filename;
                        textContent = result.article.textContent;
                    } else {
                        title = filename;
                        textContent = content;
                    }
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
