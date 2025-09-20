/**
 * @file content.js
 * This script is injected into the Nomi.ai web page. It creates the Kuato Panel UI,
 * handles user interactions, and communicates with the background script to manage
 * the book library and send text chunks.
 */

// --- Configuration ---
const nomiSelectors = {
  chatInput: 'textarea[aria-label="Chat Input"]',
  sendButton: 'button[aria-label="Send message"]',
  chatLog: 'div[role="log"].css-13ow6bz',
  nomiMessage: 'div[type="Nomi"]'
};

// --- Global State ---
let currentBook = null;
let isSendingAll = false;

// --- UI Creation ---
function createKuatoPanel() {
  const panel = document.createElement('div');
  panel.id = 'kuato-panel';
  panel.innerHTML = `
    <h3>"Open your mind..." - Kuato</h3>
    <div class="kuato-section">
      <label for="kuato-library-select">Select Book:</label>
      <div style="display: flex; gap: 5px;">
        <select id="kuato-library-select" style="width: 100%;">
          <option value="">-- No book selected --</option>
        </select>
        <button id="kuato-rename-book" style="width: auto;">Rename</button>
      </div>
    </div>
    <div class="kuato-section">
      <div style="display: flex; gap: 5px;">
        <button id="kuato-load-url">From URL</button>
        <button id="kuato-load-file">From File</button>
      </div>
      <input type="file" id="kuato-file-input" style="display: none;" />
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
function sendChunk(chunk) {
    if (!chunk || !currentBook) {
        alert('No chunk or book selected.');
        return;
    }

    const sendNextButton = document.getElementById('kuato-send-next');
    sendNextButton.disabled = true;
    sendNextButton.textContent = 'Waiting for Nomi...';
    
    const fullContent = `This is part ${chunk.chunkIndex + 1} of ${currentBook.chunks.length} of the text "${currentBook.title}".\n\n---\n\n${chunk.content}`;

    chrome.runtime.sendMessage({ action: 'uploadToPastebin', content: fullContent }, (response) => {
        if (response && response.success) {
            const message = `[From "${currentBook.title}", Part ${chunk.chunkIndex + 1}/${currentBook.chunks.length}] Please read this: ${response.url}`;
            const chatInput = document.querySelector(nomiSelectors.chatInput);
            const sendButton = document.querySelector(nomiSelectors.sendButton);

            if (chatInput && sendButton) {
                const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
                nativeInputValueSetter.call(chatInput, message);
                chatInput.dispatchEvent(new Event('input', { bubbles: true }));
                chatInput.dispatchEvent(new Event('change', { bubbles: true }));

                setTimeout(() => {
                    if (sendButton.disabled) {
                        alert("Kuato Error: Failed to enable the send button. The website might have changed. Please try typing a character into the chat box manually to enable it.");
                        sendNextButton.disabled = false;
                        sendNextButton.textContent = 'Send Next Chapter';
                    } else {
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
                    }
                }, 100);
            } else {
                alert("Kuato Error: Could not find the chat input or send button. The extension may be out of date.");
                sendNextButton.disabled = false;
                sendNextButton.textContent = 'Send Next Chapter';
            }
        } else {
            sendNextButton.disabled = false;
            sendNextButton.textContent = 'Send Next Chapter';
        }
    });
}

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
function initializeKuato() {
    const missingElements = [];
    for (const key in nomiSelectors) {
        if (!document.querySelector(nomiSelectors[key])) {
            missingElements.push(key);
        }
    }
    if (missingElements.length > 0) {
        alert(`Kuato Initialization Error:\nCould not find the following required UI elements on the page: \n\n- ${missingElements.join('\n- ')}\n\nThe extension may be incompatible with the current version of Nomi.ai.`);
        return;
    }
    
    addKuatoPanelStyles();
    createKuatoPanel();
    populateLibraryDropdown();

    const loadUrlButton = document.getElementById('kuato-load-url');
    loadUrlButton.addEventListener('click', () => {
        const url = prompt('Please enter the URL of the book to load:');
        if (url) {
            loadUrlButton.textContent = 'Loading...';
            loadUrlButton.disabled = true;
            chrome.runtime.sendMessage({ action: 'loadUrl', url: url }, (response) => {
                loadUrlButton.textContent = 'From URL';
                loadUrlButton.disabled = false;
                if (response && response.success) {
                    alert(`Book "${response.book.title}" loaded successfully!`);
                    populateLibraryDropdown();
                } else {
                    const errorMessage = response ? response.error : 'An unknown error occurred.';
                    alert(`Failed to load book.\n\nReason: ${errorMessage}`);
                    console.error('Kuato - Failed to load book. Full response:', response);
                }
            });
        }
    });

    const loadFileButton = document.getElementById('kuato-load-file');
    const fileInput = document.getElementById('kuato-file-input');
    loadFileButton.addEventListener('click', () => {
        fileInput.click();
    });

    fileInput.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (!file) {
            return;
        }

        const reader = new FileReader();
        const isPdf = file.name.toLowerCase().endsWith('.pdf');

        reader.onload = (e) => {
            const content = e.target.result;
            loadFileButton.textContent = 'Loading...';
            loadFileButton.disabled = true;

            chrome.runtime.sendMessage({
                action: 'loadFile',
                filename: file.name,
                encoding: isPdf ? 'dataURL' : 'text',
                content: content
            }, (response) => {
                loadFileButton.textContent = 'From File';
                loadFileButton.disabled = false;
                if (response && response.success) {
                    alert(`Book "${response.book.title}" loaded successfully!`);
                    populateLibraryDropdown();
                } else {
                    const errorMessage = response ? response.error : 'An unknown error occurred.';
                    alert(`Failed to load book from file.\n\nReason: ${errorMessage}`);
                    console.error('Kuato - Failed to load file. Full response:', response);
                }
            });
        };

        reader.onerror = (e) => {
            alert('Error reading file.');
            console.error('Kuato - FileReader error:', e);
        };

        if (isPdf) {
            reader.readAsDataURL(file);
        } else {
            reader.readAsText(file);
        }

        // Reset the input value to allow loading the same file again
        fileInput.value = '';
    });

    const renameButton = document.getElementById('kuato-rename-book');
    renameButton.addEventListener('click', () => {
        if (!currentBook) {
            alert('Please select a book to rename.');
            return;
        }
        const newTitle = prompt('Enter the new title for the book:', currentBook.title);
        if (newTitle && newTitle.trim() !== '') {
            chrome.runtime.sendMessage({
                action: 'updateBook',
                bookId: currentBook.id,
                data: { title: newTitle.trim() }
            }, (response) => {
                if (response && response.success) {
                    alert('Book renamed successfully.');
                    populateLibraryDropdown();
                    currentBook.title = newTitle.trim();
                    renderBookInfo();
                } else {
                    alert('Failed to rename book.');
                }
            });
        }
    });

    const librarySelect = document.getElementById('kuato-library-select');
    librarySelect.addEventListener('change', () => {
        const bookId = librarySelect.value;
        if (bookId) {
            chrome.runtime.sendMessage({ action: 'getBook', bookId: bookId }, (response) => {
                if (response && response.success && response.book) {
                    currentBook = response.book;
                    renderBookInfo();
                } else {
                    currentBook = null;
                    document.getElementById('kuato-book-info').style.display = 'none';
                }
            });
        } else {
            currentBook = null;
            document.getElementById('kuato-book-info').style.display = 'none';
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

// A brief delay to ensure the Nomi page has finished rendering its UI.
setTimeout(initializeKuato, 2000);
