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
let kuatoSettings = {
    chunkSize: 2000,
    pastebinService: 'fars.ee',
    messageFormat: '[From "{title}", Part {chunkIndex}/{chunkCount}] Please read this: {url}'
};

// --- UI Creation ---
function createKuatoPanel() {
  const panel = document.createElement('div');
  panel.id = 'kuato-panel';
  panel.innerHTML = `
    <div class="kuato-header">
      <h3>"Open your mind..." - Kuato</h3>
      <button id="kuato-toggle-collapse" title="Collapse Panel">[-]</button>
    </div>
    <div id="kuato-collapsible-content">
        <div class="kuato-section">
          <div style="display: flex; gap: 5px; align-items: center;">
            <label for="kuato-library-select" style="flex-shrink: 0;">Select Book:</label>
            <select id="kuato-library-select" style="width: 100%;">
              <option value="">-- No book selected --</option>
            </select>
            <button id="kuato-rename-book" style="width: auto;">Rename</button>
          </div>
        </div>
        <div class="kuato-section">
          <p style="margin-top: 0; margin-bottom: 5px; font-weight: bold;">Load New Book</p>
          <div style="display: flex; gap: 5px;">
            <button id="kuato-load-url">From URL</button>
            <button id="kuato-load-file">From File</button>
          </div>
          <input type="file" id="kuato-file-input" style="display: none;" />
        </div>
        <div class="kuato-section">
            <button id="kuato-open-settings" style="margin-top: 5px;">Settings</button>
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
    </div>
  `;
  document.body.appendChild(panel);
}

function addKuatoPanelStyles() {
    const style = document.createElement('style');
    style.textContent = `
        #kuato-panel {
            position: fixed; top: 20px; right: 20px; width: 300px;
            background-color: #f0f0f0; border: 1px solid #ccc;
            border-radius: 5px; padding: 15px; z-index: 9999;
            font-family: sans-serif; font-size: 14px; color: #333;
            transition: width 0.3s ease-in-out;
        }
        #kuato-panel.kuato-collapsed {
            width: 180px; /* Smaller width when collapsed */
        }
        #kuato-panel.kuato-collapsed #kuato-collapsible-content {
            display: none;
        }
        .kuato-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; gap: 10px; }
        #kuato-panel h3, #kuato-panel h4 { margin: 0; color: #111; }
        #kuato-toggle-collapse {
            width: 24px; height: 24px; padding: 0;
            font-size: 16px; line-height: 24px; text-align: center;
            border: 1px solid #ccc; border-radius: 3px; background-color: #fff; cursor: pointer;
        }
        .kuato-section { margin-bottom: 15px; }
        #kuato-panel button { width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 3px; background-color: #fff; cursor: pointer; }
        #kuato-panel button:hover { background-color: #e9e9e9; }
        #kuato-panel select { width: 100%; padding: 8px; }
        #kuato-chunks-status { max-height: 150px; overflow-y: auto; border: 1px solid #ddd; padding: 5px; margin-bottom: 10px; }
        .kuato-controls button { margin-top: 5px; }
        #kuato-settings-modal { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background-color: rgba(0,0,0,0.5); z-index: 10000; display: flex; align-items: center; justify-content: center; }
        #kuato-settings-content { background-color: #f0f0f0; padding: 20px; border-radius: 5px; width: 400px; }
        .kuato-setting { margin-bottom: 15px; }
        .kuato-setting label { display: block; margin-bottom: 5px; }
        .kuato-setting input, .kuato-setting select { width: 100%; padding: 8px; box-sizing: border-box; }
        .kuato-settings-buttons { text-align: right; margin-top: 20px; }
    `;
    document.head.appendChild(style);
}

function createSettingsModal() {
    const modal = document.createElement('div');
    modal.id = 'kuato-settings-modal';
    modal.style.display = 'none'; // Hidden by default
    modal.innerHTML = `
        <div id="kuato-settings-content">
            <h2>Kuato Settings</h2>
            <div class="kuato-setting">
                <label for="kuato-setting-chunk-size">Chunk Size (characters):</label>
                <input type="number" id="kuato-setting-chunk-size" min="100" max="10000" step="100">
            </div>
            <div class="kuato-setting">
                <label for="kuato-setting-pastebin">Pastebin Service:</label>
                <select id="kuato-setting-pastebin">
                    <option value="fars.ee">fars.ee</option>
                    <option value="dpaste.org">dpaste.org</option>
                </select>
            </div>
            <div class="kuato-setting">
                <label for="kuato-setting-message-format">Message Format:</label>
                <input type="text" id="kuato-setting-message-format">
                <small>Placeholders: {title}, {chapter}, {chapterChunkIndex}, {chunkIndex}, {chunkCount}, {url}</small>
            </div>
            <div class="kuato-settings-buttons">
                <button id="kuato-settings-save">Save & Close</button>
                <button id="kuato-settings-cancel">Cancel</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
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
    let lastChapter = null;
    currentBook.chunks.forEach(chunk => {
        if (chunk.chapter !== lastChapter) {
            const chapterDiv = document.createElement('div');
            chapterDiv.style.fontWeight = 'bold';
            chapterDiv.style.marginTop = '5px';
            chapterDiv.textContent = chunk.chapter;
            chunksStatusDiv.appendChild(chapterDiv);
            lastChapter = chunk.chapter;
        }
        const chunkDiv = document.createElement('div');
        const status = chunk.status || 'pending';
        chunkDiv.textContent = `  Part ${chunk.chapterChunkIndex + 1}: ${status}`;
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
    
    const fullContent = `This is from ${chunk.chapter}, part ${chunk.chapterChunkIndex + 1} of the text "${currentBook.title}".\n\n---\n\n${chunk.content}`;

    chrome.runtime.sendMessage({ action: 'uploadToPastebin', content: fullContent }, (response) => {
        if (response && response.success) {
            const message = kuatoSettings.messageFormat
                .replace('{title}', currentBook.title)
                .replace('{chunkIndex}', chunk.chunkIndex + 1)
                .replace('{chunkCount}', currentBook.chunks.length)
                .replace('{chapter}', chunk.chapter)
                .replace('{chapterChunkIndex}', chunk.chapterChunkIndex + 1)
                .replace('{url}', response.url);
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
    createSettingsModal();
    populateLibraryDropdown();

    // Load settings from storage
    chrome.runtime.sendMessage({ action: 'getSettings' }, (response) => {
        if (response && response.success && response.settings) {
            kuatoSettings = { ...kuatoSettings, ...response.settings };
        }
    });

    const settingsModal = document.getElementById('kuato-settings-modal');
    const openSettingsButton = document.getElementById('kuato-open-settings');
    const closeSettingsButton = document.getElementById('kuato-settings-cancel');
    const saveSettingsButton = document.getElementById('kuato-settings-save');

    openSettingsButton.addEventListener('click', () => {
        document.getElementById('kuato-setting-chunk-size').value = kuatoSettings.chunkSize;
        document.getElementById('kuato-setting-pastebin').value = kuatoSettings.pastebinService;
        document.getElementById('kuato-setting-message-format').value = kuatoSettings.messageFormat;
        settingsModal.style.display = 'flex';
    });

    closeSettingsButton.addEventListener('click', () => {
        settingsModal.style.display = 'none';
    });

    saveSettingsButton.addEventListener('click', () => {
        const newSettings = {
            chunkSize: parseInt(document.getElementById('kuato-setting-chunk-size').value, 10),
            pastebinService: document.getElementById('kuato-setting-pastebin').value,
            messageFormat: document.getElementById('kuato-setting-message-format').value
        };

        kuatoSettings = { ...kuatoSettings, ...newSettings };
        chrome.runtime.sendMessage({ action: 'saveSettings', settings: kuatoSettings });

        settingsModal.style.display = 'none';
        alert('Settings saved.');
    });
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

    const panel = document.getElementById('kuato-panel');
    const toggleButton = document.getElementById('kuato-toggle-collapse');

    // Function to toggle panel collapse
    const togglePanel = (collapse) => {
        const shouldCollapse = typeof collapse === 'boolean' ? collapse : !panel.classList.contains('kuato-collapsed');
        panel.classList.toggle('kuato-collapsed', shouldCollapse);
        toggleButton.textContent = shouldCollapse ? '[+]' : '[-]';
        toggleButton.title = shouldCollapse ? 'Expand Panel' : 'Collapse Panel';
    };

    toggleButton.addEventListener('click', () => togglePanel());

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
