/**
 * @file tests.js
 * This file contains the test suite for the Kuato extension.
 * It includes mocks for Chrome APIs and the tests themselves.
 * To run, open tests/test-runner.html in a browser.
 */

// --- Mocks and Test Harness ---
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

// This mock needs to be defined before background.js is loaded.
const chrome = {
    _storage: {},
    runtime: {
        _listeners: [],
        onMessage: {
            addListener: (listener) => {
                chrome.runtime._listeners.push(listener);
            }
        },
        // Helper to simulate a message event for tests
        _sendMessage: (request, sender, sendResponse) => {
            // Simulate the background script sending a message to the offscreen script
            if (request.action === 'parseHtml') {
                const article = new Readability(null).parse();
                sendResponse({ success: true, article });
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
            get: (keys, callback) => {
                const result = {};
                const keyList = Array.isArray(keys) ? keys : [keys];
                keyList.forEach(key => {
                    result[key] = JSON.parse(JSON.stringify(chrome._storage[key] || null));
                });
                // Simulate async behavior
                setTimeout(() => callback(result), 0);
            },
            set: (items, callback) => {
                Object.keys(items).forEach(key => {
                    chrome._storage[key] = JSON.parse(JSON.stringify(items[key]));
                });
                 // Simulate async behavior
                setTimeout(() => callback(), 0);
            },
            clear: (callback) => {
                chrome._storage = {};
                 // Simulate async behavior
                setTimeout(() => callback(), 0);
            }
        }
    },
    // Mock for onInstalled event
    _triggerOnInstalled: () => {
        // This is a simplified mock. A real implementation would be more complex.
        if (chrome.runtime.onInstalled && chrome.runtime.onInstalled.hasListeners()) {
            chrome.runtime.onInstalled.dispatch();
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
        assert(book.chunks.length === 2, 'Should split into 2 chunks');
        assertDeepEqual(book.chunks[0].content, 'This is the first sentence. This is the second.', 'First chunk should end at a word break');
        assertDeepEqual(book.chunks[1].content, 'sentence. This is a very long third sentence that will be split.', 'Second chunk should contain the rest');
        done();
    });

    test('processAndSaveBook should split text by chapters', async (done) => {
        // Arrange
        await new Promise(resolve => chrome.storage.local.clear(resolve));
        await saveSettings({ chunkSize: 80 });
        const text = "Introduction text. Chapter 1 The first part of chapter 1. The second part of chapter 1. Chapter 2 The only part of chapter 2.";

        // Act
        const book = await processAndSaveBook('Test Title', text, 'url');

        // Assert
        assert(book.chunks.length === 4, 'Should split into 4 chunks across chapters');
        assertDeepEqual(book.chunks[0].chapter, 'Introduction', 'First chunk in Introduction');
        assertDeepEqual(book.chunks[1].chapter, 'Chapter 1', 'Second chunk in Chapter 1');
        assertDeepEqual(book.chunks[2].chapter, 'Chapter 1', 'Third chunk in Chapter 1');
        assertDeepEqual(book.chunks[3].chapter, 'Chapter 2', 'Fourth chunk in Chapter 2');
        assertDeepEqual(book.chunks[1].content, 'The first part of chapter 1.', 'Content of chunk in chapter 1');
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
        const request = {
            action: 'loadFile',
            filename: 'test.txt',
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

    test('loadFile message should process an HTML file using offscreen parser', async (done) => {
        // Arrange
        await new Promise(res => chrome.storage.local.clear(res));
        const request = {
            action: 'loadFile',
            filename: 'test.html',
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
        chrome.storage.local.clear(() => {});
        const newBook = { title: 'Test Book', chunks: [] };

        // Act
        const addedBook = await addBook(newBook);

        // Assert
        assert(addedBook.id.startsWith('book_'), 'Book should be given an ID');

        const library = await getLibrary();
        assert(library.length === 1, 'Library should have one book');
        assertDeepEqual(library[0].title, 'Test Book', 'The correct book should be in the library');

        done();
    });

    test('getBook should retrieve a specific book by ID', async (done) => {
        // Arrange
        chrome.storage.local.clear(() => {});
        const book1 = await addBook({ title: 'Book One' });
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
