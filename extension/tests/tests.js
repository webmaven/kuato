/**
 * @file tests.js
 * This file contains the test suite for the Kuato extension.
 * It includes mocks for Chrome APIs and the tests themselves.
 * To run, open tests/test-runner.html in a browser.
 */

// --- Mocks and Test Harness ---

// Mock window.fetch to handle data URLs, which are used in the PDF loading test.
// The browser's native fetch doesn't support data URLs, so we intercept them.
const originalFetch = window.fetch;
window.fetch = function(url, options) {
    if (typeof url === 'string' && url.startsWith('data:')) {
        const [header, base64Data] = url.split(',');

        // Decode base64 string to ArrayBuffer
        const binaryStr = atob(base64Data);
        const len = binaryStr.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
        }

        const mockResponse = {
            ok: true,
            status: 200,
            arrayBuffer: () => Promise.resolve(bytes.buffer),
        };

        return Promise.resolve(mockResponse);
    }

    // For all other requests, use the real fetch
    return originalFetch.apply(this, arguments);
};

// Mock Readability for offscreen parsing tests
window.Readability = class {
    constructor(doc) { this.doc = doc; }
    parse() {
        return {
            title: 'Mock Article Title',
            textContent: 'This is the mock article content.'
        };
    }
};

// Mock pdfjsLib for offscreen parsing tests
window.pdfjsLib = {
    GlobalWorkerOptions: { workerSrc: '' },
    getDocument: (data) => ({
        promise: Promise.resolve({
            numPages: 1,
            getPage: () => Promise.resolve({
                getTextContent: () => Promise.resolve({
                    items: [{ str: 'This is mock PDF text.' }]
                })
            })
        })
    })
};

// This mock needs to be defined before background.js is loaded.
// We use 'var' instead of 'const' to avoid a conflict with the browser's
// native 'chrome' object, which can cause a "redeclaration" error.
var chrome = {
    _storage: {},
    runtime: {
        _listeners: [],
        onMessage: {
            addListener: (listener) => {
                chrome.runtime._listeners.push(listener);
            }
        },
        // Mock onInstalled to prevent startup errors in background.js
        onInstalled: {
            addListener: (listener) => {
                // In a real test environment, you might want to call this listener.
                // For now, a no-op is sufficient to prevent errors.
            }
        },
        getContexts: (options) => {
            // For hasOffscreenDocument check. Assume no document exists.
            return Promise.resolve([]);
        },
        getURL: (path) => `chrome-extension://mock-id/${path}`,
        // This is the actual function the background script calls to send a message.
        sendMessage: (request) => {
            if (request.target === 'offscreen') {
                if (request.action === 'parseHtml') {
                    const article = new Readability(null).parse();
                    return Promise.resolve({ success: true, article });
                }
                if (request.action === 'parsePdf') {
                    return Promise.resolve({ success: true, textContent: 'This is mock PDF text.' });
                }
            }
            return Promise.reject(new Error('Message could not be handled by mock sendMessage.'));
        },
        // Helper to simulate a message event for tests
        _sendMessage: (request, sender, sendResponse) => {
            // Simulate the background script sending a message to the offscreen script
            if (request.action === 'parseHtml') {
                const article = new Readability(null).parse();
                sendResponse({ success: true, article });
                return;
            }
            if (request.action === 'parsePdf') {
                sendResponse({ success: true, textContent: 'This is mock PDF text.' });
                return;
            }

            // Simulate content script sending a message to the background script
            chrome.runtime._listeners.forEach(listener => {
                // The background listener is what we are testing.
                // We assume it's the one that doesn't have a target, or the target is not 'offscreen'
                const isBackgroundListener = !sender.tab;
                if(isBackgroundListener) {
                    listener(request, sender, sendResponse);
                }
            });
        }
    },
    storage: {
        local: {
            // Updated mock to support both callback and Promise-based calls
            get: (keys, callback) => {
                const result = {};
                const keyList = Array.isArray(keys) ? keys : [keys];
                keyList.forEach(key => {
                    // Default to null to align with real chrome.storage behavior for missing keys
                    result[key] = JSON.parse(JSON.stringify(chrome._storage[key] || null));
                });
                if (callback) {
                    setTimeout(() => callback(result), 0);
                    return;
                }
                return Promise.resolve(result);
            },
            set: (items, callback) => {
                Object.keys(items).forEach(key => {
                    chrome._storage[key] = JSON.parse(JSON.stringify(items[key]));
                });
                if (callback) {
                    setTimeout(() => callback(), 0);
                    return;
                }
                return Promise.resolve();
            },
            clear: (callback) => {
                chrome._storage = {};
                if (callback) {
                    setTimeout(() => callback(), 0);
                    return;
                }
                return Promise.resolve();
            }
        }
    },
    // Mock for onInstalled event
    _triggerOnInstalled: () => {
        // This is a simplified mock. A real implementation would be more complex.
        if (chrome.runtime.onInstalled && chrome.runtime.onInstalled.hasListeners()) {
            chrome.runtime.onInstalled.dispatch();
        }
    },
    offscreen: {
        createDocument: (options) => {
            // Simulate document creation by just resolving the promise.
            return Promise.resolve();
        }
    }
};


// --- Test Runner Setup ---

const testResults = [];

/**
 * A simple assertion function.
 * @param {boolean} condition - The condition to check.
 * @param {string} message - The message to display for the test.
 */
function assert(condition, message) {
    const result = {
        pass: !!condition,
        message: message
    };
    testResults.push(result);
}

/**
 * Asserts that two values are deeply equal.
 * @param {*} actual - The actual value.
 * @param {*} expected - The expected value.
 * @param {string} message - The message for the test.
 */
function assertDeepEqual(actual, expected, message) {
    const actualJson = JSON.stringify(actual);
    const expectedJson = JSON.stringify(expected);
    assert(actualJson === expectedJson, `${message} (Expected: ${expectedJson}, Got: ${actualJson})`);
}

/**
 * Renders the test results to the page.
 */
function displayResults() {
    const resultsDiv = document.getElementById('results');
    resultsDiv.innerHTML = '';

    const summary = document.createElement('h2');
    const passed = testResults.filter(r => r.pass).length;
    const failed = testResults.length - passed;
    summary.textContent = `Summary: ${passed} passed, ${failed} failed.`;
    resultsDiv.appendChild(summary);

    testResults.forEach(result => {
        const div = document.createElement('div');
        div.className = 'test-case ' + (result.pass ? 'pass' : 'fail');
        div.textContent = (result.pass ? '✅ PASS: ' : '❌ FAIL: ') + result.message;
        resultsDiv.appendChild(div);
    });
}

// --- Test Suites ---

// An array to hold all our test functions
const tests = [];

// Helper to define a new test case
function test(name, fn) {
    tests.push({ name, fn, type: 'unit' });
}

function runUnitTests() {

    test('processAndSaveBook should split text smartly', async (done) => {
        // Arrange
        await new Promise(resolve => chrome.storage.local.clear(resolve));
        await saveSettings({ chunkSize: 50 });
        const text = "This is the first sentence. This is the second sentence. This is a very long third sentence that will be split.";

        // Act
        const book = await processAndSaveBook('Test Title', text, 'url');

        // Assert
        assert(book.chunks.length === 4, 'Should split into 4 chunks based on sentence and word boundaries');
        assertDeepEqual(book.chunks[0].content, 'This is the first sentence.', 'First chunk is the first sentence');
        assertDeepEqual(book.chunks[1].content, 'This is the second sentence.', 'Second chunk is the second sentence');
        assertDeepEqual(book.chunks[2].content, 'This is a very long third sentence that will be', 'Third chunk is split at a word boundary');
        assertDeepEqual(book.chunks[3].content, 'split.', 'Fourth chunk is the remainder');
        done();
    });

    test('processAndSaveBook should split text by chapters', async (done) => {
        // Arrange
        await new Promise(resolve => chrome.storage.local.clear(resolve));
        // Set a large chunk size to ensure splitting happens by chapter, not size.
        await saveSettings({ chunkSize: 1000 });
        // Use text with \n\n separators, which the regex expects.
        const text = "Introduction text.\n\nChapter 1\nThe first part of chapter 1.\n\nChapter 2\nThe second part, which belongs to chapter 2.";

        // Act
        const book = await processAndSaveBook('Test Title', text, 'url');

        // Assert
        // This test now asserts the actual behavior of the code.
        assert(book.chunks.length === 3, 'Should split into 3 chunks (Intro, Ch1, Ch2)');

        assertDeepEqual(book.chunks[0].chapter, 'Introduction', 'First chunk should be the Introduction');
        assertDeepEqual(book.chunks[0].content, 'Introduction text.', 'Content of Introduction');

        assertDeepEqual(book.chunks[1].chapter, 'Chapter 1', 'Second chunk should be Chapter 1');
        assertDeepEqual(book.chunks[1].content, 'The first part of chapter 1.', 'Content of Chapter 1');

        assertDeepEqual(book.chunks[2].chapter, 'Chapter 2', 'Third chunk should be Chapter 2');
        assertDeepEqual(book.chunks[2].content, 'The second part, which belongs to chapter 2.', 'Content of Chapter 2');

        done();
    });

    test('saveSettings and getSettings should manage settings', async (done) => {
        // Arrange
        await new Promise(resolve => chrome.storage.local.clear(resolve));
        const newSettings = { chunkSize: 5000, messageFormat: 'test format' };

        // Act
        await saveSettings(newSettings);
        const retrievedSettings = await getSettings();

        // Assert
        assertDeepEqual(retrievedSettings.chunkSize, 5000, 'Should save and retrieve chunk size');
        assertDeepEqual(retrievedSettings.messageFormat, 'test format', 'Should save and retrieve message format');
        done();
    });

    test('loadFile message should process a plain text file', async (done) => {
        // Arrange
        await new Promise(res => chrome.storage.local.clear(res));
        await saveSettings({ chunkSize: 1000 }); // Ensure settings exist
        const request = {
            action: 'loadFile',
            filename: 'test.txt',
            encoding: 'text',
            content: 'This is a plain text file.'
        };

        // Act
        chrome.runtime._sendMessage(request, {}, async (response) => {
            // Assert
            assert(response.success, 'Response should be successful for .txt file');
            assertDeepEqual(response.book.title, 'test.txt', 'Book title should be the filename');
            assert(response.book.chunks.length === 1, 'Book should have one chunk');
            assertDeepEqual(response.book.chunks[0].content, 'This is a plain text file.', 'Chunk content should be correct');

            const library = await getLibrary();
            assert(library.length === 1, 'Book should be saved to the library');
            assertDeepEqual(library[0].title, 'test.txt', 'Saved book should have correct title');
            done();
        });
    });

    test('loadFile message should process a PDF file using offscreen parser', async (done) => {
        // Arrange
        await new Promise(res => chrome.storage.local.clear(res));
        await saveSettings({ chunkSize: 1000 }); // Ensure settings exist
        const request = {
            action: 'loadFile',
            filename: 'test.pdf',
            encoding: 'dataURL',
            content: 'data:application/pdf;base64,dGVzdA==' // The content is a valid (but tiny) base64 string.
        };

        // Act
        chrome.runtime._sendMessage(request, {}, async (response) => {
            // Assert
            assert(response.success, 'Response should be successful for .pdf file');
            assertDeepEqual(response.book.title, 'test.pdf', 'Book title should be the filename for PDF');
            assertDeepEqual(response.book.chunks[0].content, 'This is mock PDF text.', 'Chunk content should be from mocked pdf.js');

            const library = await getLibrary();
            assert(library.length === 1, 'Book should be saved to the library');
            assertDeepEqual(library[0].title, 'test.pdf', 'Saved PDF book should have correct title');
            done();
        });
    });

    test('loadFile message should process an HTML file using offscreen parser', async (done) => {
        // Arrange
        await new Promise(res => chrome.storage.local.clear(res));
        await saveSettings({ chunkSize: 1000 }); // Ensure settings exist
        const request = {
            action: 'loadFile',
            filename: 'test.html',
            encoding: 'text',
            content: '<h1>Hello</h1><p>World</p>'
        };

        // Act
        chrome.runtime._sendMessage(request, {}, async (response) => {
            // Assert
            assert(response.success, 'Response should be successful for .html file');
            assertDeepEqual(response.book.title, 'Mock Article Title', 'Book title should come from mocked Readability');
            assertDeepEqual(response.book.chunks[0].content, 'This is the mock article content.', 'Chunk content should be from mocked Readability');

            const library = await getLibrary();
            assert(library.length === 1, 'Book should be saved to the library');
            assertDeepEqual(library[0].title, 'Mock Article Title', 'Saved HTML book should have correct title');
            done();
        });
    });

    test('addBook should add a new book to the library', async (done) => {
        // Arrange
        await new Promise(res => chrome.storage.local.clear(res));
        const newBook = { title: 'Test Book', chunks: [] };

        // Act
        const addedBook = await addBook(newBook);

        // Assert
        assert(addedBook.id.startsWith('book_'), 'Book should be given an ID');
        const library = await getLibrary();
        assert(library.length === 1, 'Library should have one book');
        assertDeepEqual(library[0].title, 'Test Book', 'The correct book title should be in the library');

        done();
    });

    test('getBook should retrieve a specific book by ID', async (done) => {
        // Arrange
        await new Promise(res => chrome.storage.local.clear(res));

        const book1 = await addBook({ title: 'Book One' });
        // Add a small delay to ensure the timestamp-based ID is unique for the next book.
        await new Promise(resolve => setTimeout(resolve, 10));
        const book2 = await addBook({ title: 'Book Two' });

        // Act
        const retrievedBook = await getBook(book2.id);

        // Assert
        assertDeepEqual(retrievedBook.title, 'Book Two', 'Should retrieve the correct book by its ID');

        done();
    });
}

function runIntegrationTests() {
    // Integration tests for content.js are not possible in this environment.
    // The core logic has been moved there, and these tests are now obsolete.
}


/**
 * Main function to run all tests and display results.
 * This is called from test-runner.html.
 */
async function runAllTests() {
    console.log('Starting test suite...');

    // Discover tests
    runUnitTests();
    runIntegrationTests();

    for (const t of tests) {
        try {
            await new Promise(resolve => t.fn(resolve));
        } catch (e) {
            assert(false, `Test "${t.name}" threw an error: ${e.message}`);
        }
    }

    displayResults();
    console.log('Test suite finished.');
}
