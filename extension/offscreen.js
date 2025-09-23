/**
 * @file offscreen.js
 * This script runs in a hidden offscreen document. Its sole purpose is to
 * provide a real DOM environment for parsing HTML content, which is not
 * available in the background service worker.
 */

chrome.runtime.onMessage.addListener(handleMessages);

async function handleMessages(request, sender, sendResponse) {
  if (request.target !== 'offscreen') {
    return false;
  }

  if (request.action === 'parseHtml') {
    const { html } = request;
    
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const reader = new Readability(doc);
      const article = reader.parse();
      
      if (!article) {
        throw new Error('Readability parsing returned null.');
      }

      sendResponse({ success: true, article: {
        title: article.title,
        textContent: article.textContent
      }});

    } catch (e) {
      console.error('[Kuato Offscreen] Error parsing HTML:', e);
      sendResponse({ success: false, error: e.message });
    }

    return true;
  }

  if (request.action === 'parsePdf') {
    console.log('[Kuato Offscreen] Received parsePdf request:', request);
    const { pdfData } = request;
    console.log('[Kuato Offscreen] Extracted pdfData:', pdfData);
    console.log('[Kuato Offscreen] Type of pdfData:', typeof pdfData);
    if (pdfData) {
      console.log('[Kuato Offscreen] pdfData.byteLength:', pdfData.byteLength);
    }

    (async () => {
        try {
            const { pdfjsLib } = globalThis;
            pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdfjs/pdf.worker.mjs');

            const loadingTask = pdfjsLib.getDocument({
                data: pdfData,
                cMapUrl: chrome.runtime.getURL('lib/pdfjs/cmaps/'),
                cMapPacked: true,
            });

            const pdf = await loadingTask.promise;
            let fullText = '';

            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const textContent = await page.getTextContent();
                const pageText = textContent.items.map(item => item.str).join(' ');
                fullText += pageText + '\n\n';
            }

            sendResponse({ success: true, textContent: fullText.trim() });

        } catch (error) {
            console.error('[Kuato Offscreen] Error parsing PDF:', error);
            sendResponse({ success: false, error: error.message });
        }
    })();
    return true;
  }

  return false;
}

// Signal to the background script that the offscreen document is ready.
chrome.runtime.sendMessage({ action: 'offscreenReady' });
