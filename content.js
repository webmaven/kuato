/**
 * @file content.js
 * This script is injected into the Nomi.ai web page. It creates the Kuato Panel UI,
 * handles user interactions, and communicates with the background script to manage
 * the book library and send text chunks.
 */

// --- Configuration ---

/**
 * @description CSS selectors for the Nomi.ai UI elements.
 * These are prone to changing, so they're centralized here for easy maintenance.
 */
const nomiSelectors = {
  chatInput: 'textarea[aria-label="Chat Input"]',
  sendButton: 'button[aria-label="Send message"]',
  chatLog: 'div[role="log"].css-13ow6bz',
  nomiMessage: 'div[type="Nomi"]'
};

// --- Global State ---

/** @type {object|null} - Holds the book object currently selected by the user. */
let currentBook = null;
/** @type {boolean} - Flag to control the "Send All" auto-sending process. */
let isSendingAll = false;


// --- UI Creation ---

/**
 * Creates the main HTML structure for the Kuato Panel and injects it into the page.
 */
function createKuatoPanel() {
  const panel = document.createElement('div');
  panel.id = 'kuato-panel';

  panel.innerHTML = `
    <h3>"Open your mind..." - Kuato</h3>
    
    <div class="kuato-section">
      <label for="kuato-library-select">Select Book:</label>
      <select id="kuato-library-select">
        <option value="">-- No book selected --</option>
      </select>
    </div>

    <div class="kuato-section">
      <button id="kuato-load-new">Load New Book from URL</button>
    </div>

    <div id="kuato-book-info" style="display: none;">
      <hr>
      <h4 id="kuato-book-title"></h4>
      <div id="kuato-chunks-status"></div>
      <div class="kuato-controls">
          <button id="kuato-send-next">Send Next Chapter</button>
          <button id="kuato-send-all">Send All</button>
          <button id="kuato-pause" style="display: none;">Pause</button>
      </div>
    </div>
  `;

  document.body.appendChild(panel);
}

/**
 * Creates a <style> tag and injects the CSS for the Kuato Panel into the page's <head>.
 */
function addKuatoPanelStyles() {
    const style = document.createElement('style');
    style.textContent = `
        #kuato-panel { position: fixed; top: 20px; right: 20px; width: 300px; background-color: #f0f0f0; border: 1px solid #ccc; border-radius: 5px; padding: 15px; z-index: 9999; font-family: sans-serif; font-size: 14px; color: #333; }
        #kuato-panel h3, #kuato-panel h4 { margin-top: 0; margin-bottom: 10px; color: #111; }
        .kuato-section { margin-bottom: 15px; }
        #kuato-panel button { width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 3px; background-color: #fff; cursor: pointer; }
        #kuato-panel button:hover { background-color: #e9e9e9; }
        #kuato-panel select { width: 100%; padding: 8px; }
        #kuato-chunks-status { max-height: 150px; overflow-y: auto; border: 1px solid #ddd; padding: 5px; margin-bottom: 10px; }
        .kuato-controls button { margin-top: 5px; }
    `;
    document.head.appendChild(style);
}


// --- UI Logic and Rendering ---

/**
 * Fetches the library from the background script and populates the book selection dropdown.
 */
function populateLibraryDropdown() {
    chrome.runtime.sendMessage({ action: 'getLibrary' }, (response) => {
        if (response && response.success) {
            const select = document.getElementById('kuato-library-select');
            const currentSelection = select.value;
            select.innerHTML = '<option value="">-- No book selected --</option>';
            response.library.forEach(book => {
                const option = document.createElement('option');
                option.value = book.id;
                option.textContent = book.title;
                select.appendChild(option);
            });
            if (currentSelection) {
                select.value = currentSelection;
            }
        }
    });
}

/**
 * Renders the details of the currently selected book (`currentBook`) in the panel.
 * Displays the title and the status of each chunk, including a "Retry" button for unsent chunks.
 */
function renderBookInfo() {
    if (!currentBook) return;

    document.getElementById('kuato-book-title').textContent = currentBook.title;
    const chunksStatusDiv = document.getElementById('kuato-chunks-status');
    chunksStatusDiv.innerHTML = '';

    currentBook.chunks.forEach(chunk => {
        const chunkDiv = document.createElement('div');
        const status = chunk.status || 'pending';
        chunkDiv.textContent = `Chunk ${chunk.chunkIndex + 1}: ${status}`;
        
        if (status !== 'sent') {
            const retryButton = document.createElement('button');
            retryButton.textContent = 'Retry';
            retryButton.style.width = 'auto';
            retryButton.style.marginLeft = '10px';
            retryButton.onclick = () => sendChunk(chunk);
            chunkDiv.appendChild(retryButton);
        }
        chunksStatusDiv.appendChild(chunkDiv);
    });

    document.getElementById('kuato-book-info').style.display = 'block';
}


// --- Core Functionality ---

/**
 * Handles the entire process of sending a single text chunk.
 * It uploads the chunk content to a pastebin, formats a message for the Nomi,
 * and injects and sends the message through the Nomi chat interface.
 * @param {object} chunk - The chunk object to send.
 */
function sendChunk(chunk) {
    if (!chunk || !currentBook) {
        alert('No chunk or book selected.');
        return;
    }

    const sendNextButton = document.getElementById('kuato-send-next');
    sendNextButton.disabled = true;
    sendNextButton.textContent = 'Waiting for Nomi...';
    
    const fullContent = `This is part ${chunk.chunkIndex + 1} of ${currentBook.chunks.length} of the text "${currentBook.title}".

---

${chunk.content}`;

    chrome.runtime.sendMessage({ action: 'uploadToPastebin', content: fullContent }, (response) => {
        if (response && response.success) {
            const message = `(Kuato) Here is part ${chunk.chunkIndex + 1} of ${currentBook.chunks.length} of "${currentBook.title}": ${response.url}`;
            const chatInput = document.querySelector(nomiSelectors.chatInput);
            const sendButton = document.querySelector(nomiSelectors.sendButton);

            if (chatInput && sendButton) {
                if (sendButton.disabled) {
                    alert("Kuato: Cannot send message. The Nomi send button is currently disabled.");
                    sendNextButton.disabled = false;
                    sendNextButton.textContent = 'Send Next Chapter';
                    return;
                }
                // Use the native setter to bypass React's input handling
                const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
                nativeInputValueSetter.call(chatInput, message);

                // Dispatch an event to notify the framework of the change
                const inputEvent = new Event('input', { bubbles: true });
                chatInput.dispatchEvent(inputEvent);
                sendButton.click();
                
                chunk.status = 'sent';
                currentBook.lastSentChunk = Math.max(currentBook.lastSentChunk, chunk.chunkIndex);
                
                chrome.runtime.sendMessage({ 
                    action: 'updateBook', 
                    bookId: currentBook.id, 
                    data: { chunks: currentBook.chunks, lastSentChunk: currentBook.lastSentChunk } 
                }, () => {
                    renderBookInfo();
                });

            } else {
                alert("Kuato: Could not find the chat input or send button. The extension may be out of date.");
                sendNextButton.disabled = false;
                sendNextButton.textContent = 'Send Next Chapter';
            }
        } else {
            sendNextButton.disabled = false;
            sendNextButton.textContent = 'Send Next Chapter';
        }
    });
}

/**
 * Sends the next unsent chunk in the sequence for the current book.
 * This is the main function for the "Send All" feature.
 */
function sendNextChunkInSequence() {
    if (!isSendingAll || !currentBook) {
        isSendingAll = false;
        return;
    }
    const nextChunk = currentBook.chunks.find(c => c.status !== 'sent');
    if (nextChunk) {
        sendChunk(nextChunk);
    } else {
        alert('All chunks have been sent.');
        isSendingAll = false;
        document.getElementById('kuato-send-all').style.display = 'block';
        document.getElementById('kuato-pause').style.display = 'none';
    }
}


// --- Initialization ---

/**
 * Main function to initialize the Kuato extension on the page.
 * Creates the UI, sets up event listeners, and starts the MutationObserver.
 */
function initializeKuato() {
    // --- Diagnostic Check ---
    const missingElements = [];
    for (const key in nomiSelectors) {
        if (!document.querySelector(nomiSelectors[key])) {
            missingElements.push(key);
        }
    }

    if (missingElements.length > 0) {
        alert(`Kuato Initialization Error:\nCould not find the following required UI elements on the page: \n\n- ${missingElements.join('\n- ')}\n\nThe extension may be incompatible with the current version of Nomi.ai.`);
        return; // Stop initialization
    }
    
    addKuatoPanelStyles();
    createKuatoPanel();
    populateLibraryDropdown();

    const loadNewButton = document.getElementById('kuato-load-new');
    loadNewButton.addEventListener('click', async () => {
        const url = prompt('Please enter the URL of the book to load:');
        if (!url) return;

        loadNewButton.textContent = 'Loading...';
        loadNewButton.disabled = true;

        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Network request failed with status ${response.status}`);
            }

            const contentType = response.headers.get('content-type');
            const rawText = await response.text();

            let title = 'Untitled';
            let textContent = '';

            if (contentType && contentType.includes('text/html')) {
                const doc = new DOMParser().parseFromString(rawText, "text/html");
                const article = new Readability(doc).parse();
                if (!article || !article.textContent) {
                    console.warn('[Kuato] Readability failed. Falling back to body text.');
                    title = doc.title || new URL(url).pathname.split('/').pop();
                    textContent = doc.body.textContent || '';
                } else {
                    title = article.title;
                    textContent = article.textContent;
                }
            } else {
                // Assume plain text
                title = new URL(url).pathname.split('/').pop();
                textContent = rawText;
            }

            chrome.runtime.sendMessage({
                action: 'addBookFromText',
                title: title,
                text: textContent,
                sourceUrl: url
            }, (response) => {
                if (response && response.success) {
                    alert(`Book \"${response.book.title}\" loaded successfully!`);
                    populateLibraryDropdown();
                } else {
                    const errorMessage = response ? response.error : 'An unknown error occurred.';
                    alert(`Failed to save book.\n\nReason: ${errorMessage}`);
                }
            });

        } catch (error) {
            alert(`Failed to load and process URL.\n\nReason: ${error.message}`);
            console.error('[Kuato] Error in content script processing:', error);
        } finally {
            loadNewButton.textContent = 'Load New Book from URL';
            loadNewButton.disabled = false;
        }
    });

    const librarySelect = document.getElementById('kuato-library-select');
    librarySelect.addEventListener('change', () => {
        const bookId = librarySelect.value;
        const bookInfoDiv = document.getElementById('kuato-book-info');
        if (bookId) {
            chrome.runtime.sendMessage({ action: 'getBook', bookId: bookId }, (response) => {
                if (response && response.success && response.book) {
                    currentBook = response.book;
                    renderBookInfo();
                } else {
                    currentBook = null;
                    bookInfoDiv.style.display = 'none';
                }
            });
        } else {
            currentBook = null;
            bookInfoDiv.style.display = 'none';
        }
    });

    const sendNextButton = document.getElementById('kuato-send-next');
    sendNextButton.addEventListener('click', () => {
        if (currentBook) {
            const nextChunk = currentBook.chunks.find(c => c.status !== 'sent');
            if (nextChunk) {
                sendChunk(nextChunk);
            } else {
                alert('All chunks have been sent.');
            }
        } else {
            alert('Please select a book first.');
        }
    });
    
    const sendAllButton = document.getElementById('kuato-send-all');
    const pauseButton = document.getElementById('kuato-pause');

    sendAllButton.addEventListener('click', () => {
        if (!currentBook) { alert('Please select a book first.'); return; }
        isSendingAll = true;
        sendAllButton.style.display = 'none';
        pauseButton.style.display = 'block';
        sendNextChunkInSequence();
    });

    pauseButton.addEventListener('click', () => {
        isSendingAll = false;
        sendAllButton.style.display = 'block';
        pauseButton.style.display = 'none';
    });

    const chatLog = document.querySelector(nomiSelectors.chatLog);
    if (chatLog) {
        const observer = new MutationObserver((mutationsList) => {
            for(const mutation of mutationsList) {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    mutation.addedNodes.forEach(node => {
                        if (node.querySelector && node.querySelector(nomiSelectors.nomiMessage)) {
                            document.getElementById('kuato-send-next').disabled = false;
                            document.getElementById('kuato-send-next').textContent = 'Send Next Chapter';
                            if (isSendingAll) {
                                sendNextChunkInSequence();
                            }
                        }
                    });
                }
            }
        });
        observer.observe(chatLog, { childList: true, subtree: true });
    }
}

// --- Self-Executing Initialization ---

// A brief delay to ensure the Nomi page has finished rendering its UI.
setTimeout(initializeKuato, 2000);
