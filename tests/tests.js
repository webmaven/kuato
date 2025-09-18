/**
 * @file tests.js
 * This file contains the test suite for the Kuato extension.
 * It includes mocks for Chrome APIs and the tests themselves.
 * To run, open tests/test-runner.html in a browser.
 */

// --- Mocks and Test Harness ---

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
            chrome.runtime._listeners.forEach(listener => {
                listener(request, sender, sendResponse);
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
    test('addBookFromText message should create and save a new book', async (done) => {
        // Arrange
        chrome.storage.local.clear(() => {});
        const request = {
            action: 'addBookFromText',
            title: 'Test Title',
            text: 'This is the full text content.',
            sourceUrl: 'https://example.com'
        };

        // Act
        chrome.runtime._sendMessage(request, {}, async (response) => {
            // Assert
            assert(response.success, 'Response should be successful');
            assertDeepEqual(response.book.title, 'Test Title', 'Book title should be correct');
            assert(response.book.chunks.length === 1, 'Book should be split into one chunk');

            const library = await getLibrary();
            assert(library.length === 1, 'Book should be saved to the library');
            assertDeepEqual(library[0].title, 'Test Title', 'Saved book should have correct title');
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
