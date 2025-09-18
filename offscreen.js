/**
 * @file offscreen.js
 * This script runs in a hidden offscreen document. Its sole purpose is to
 * provide a real DOM environment for parsing HTML content, which is not
 * available in the background service worker.
 */

chrome.runtime.onMessage.addListener(handleMessages);

function handleMessages(request, sender, sendResponse) {
  if (request.target !== 'offscreen') {
    return false;
  }

  if (request.action === 'parseHtml') {
    const { html } = request;
    
    try {
      // Use DOMParser to turn the HTML string into a DOM document
      const doc = new DOMParser().parseFromString(html, 'text/html');
      
      // Use Readability to extract the article content
      const reader = new Readability(doc);
      const article = reader.parse();
      
      if (!article) {
        throw new Error('Readability parsing returned null.');
      }

      // Send the parsed article object back to the background script
      sendResponse({ success: true, article: {
        title: article.title,
        textContent: article.textContent
      }});

    } catch (e) {
      console.error('[Kuato Offscreen] Error parsing HTML:', e);
      sendResponse({ success: false, error: e.message });
    }

    return true; // Indicates asynchronous response
  }
  return false;
}
