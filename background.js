// background.js
// Service worker: orchestrates the full-page capture using Chrome DevTools Protocol
// Uses Page.printToPDF — Chrome's native print engine for pixel-perfect text/spacing

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'START_CAPTURE') {
    handleCapture(msg.tabId, msg.options)
      .then(() => sendResponse({ ok: true }))
      .catch(err => sendResponse({ error: err.message }));
    return true; // keep channel open for async
  }
});

async function sendProgress(label, pct) {
  try {
    await chrome.runtime.sendMessage({ type: 'PROGRESS', label, pct });
  } catch (_) {}
}

// Outer shell: attaches/detaches debugger and enforces a 90 s hard timeout.
async function handleCapture(tabId, options) {
  await sendProgress('Attaching to page…', 8);

  try {
    await chrome.debugger.attach({ tabId }, '1.3');
  } catch (err) {
    if (err.message && err.message.toLowerCase().includes('already')) {
      throw new Error('A capture is already in progress on this tab, or DevTools is open. Close DevTools and try again.');
    }
    throw new Error('Could not attach to this page. Try refreshing and capturing again.');
  }

  let timeoutId;
  try {
    await Promise.race([
      captureWork(tabId, options),
      new Promise((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(
            'Capture timed out after 90 seconds. ' +
            'The page may be unresponsive or too large to capture.'
          )),
          90_000
        );
      }),
    ]);
  } finally {
    clearTimeout(timeoutId);
    // Always detach debugger — even if something throws or times out
    await chrome.debugger.detach({ tabId }).catch(() => {});
  }
}

// Inner shell: all the actual capture work, runs inside the timeout race.
async function captureWork(tabId, options) {
  if (!options.visibleOnly) {
      await sendProgress('Scrolling to trigger lazy load…', 20);

      // Scroll through full page height to trigger lazy-loaded images/content
      await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
        expression: `
          (async () => {
            const totalHeight = document.documentElement.scrollHeight;
            const step = window.innerHeight * 0.8;
            let pos = 0;
            while (pos < totalHeight) {
              window.scrollTo(0, pos);
              await new Promise(r => setTimeout(r, 120));
              pos += step;
            }
            window.scrollTo(0, totalHeight);
            await new Promise(r => setTimeout(r, 400));
            window.scrollTo(0, 0);
            await new Promise(r => setTimeout(r, 300));
          })()
        `,
        awaitPromise: true,
      });
    }

    await sendProgress('Waiting for page to settle…', 40);

    // Wait for browser idle instead of a fixed timeout — more reliable on both
    // fast and slow connections. requestIdleCallback fires when the main thread
    // has finished layout, paint, and image decoding. Falls back to 500 ms.
    await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
      expression: `
        new Promise(resolve => {
          const settle = () => {
            typeof requestIdleCallback !== 'undefined'
              ? requestIdleCallback(resolve, { timeout: 3000 })
              : setTimeout(resolve, 500);
          };
          document.readyState === 'complete'
            ? settle()
            : window.addEventListener('load', settle, { once: true });
        })
      `,
      awaitPromise: true,
    });

    await sendProgress('Reading page dimensions…', 55);

    let paperWidth, paperHeight, title;

    // Walk the DOM to find the true bottom of all content
    const dimsResult = await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
        expression: `JSON.stringify((function() {
          document.documentElement.style.paddingBottom = '0';
          document.documentElement.style.marginBottom = '0';
          document.body.style.paddingBottom = '0';
          document.body.style.marginBottom = '0';

          let maxBottom = 0;
          document.querySelectorAll('body *').forEach(el => {
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return;
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden') return;
            if (style.position === 'fixed' || style.position === 'sticky') return;
            const absBottom = rect.bottom + window.scrollY;
            if (absBottom > maxBottom) maxBottom = absBottom;
          });

          return {
            w: document.documentElement.scrollWidth,
            h: Math.ceil(maxBottom) + 16,
            title: document.title,
          };
        })())`,
        returnByValue: true,
      });
    if (!dimsResult?.result?.value) {
      throw new Error('Could not read page dimensions. The page may have blocked script execution.');
    }
    const dims = JSON.parse(dimsResult.result.value);
    paperWidth  = dims.w / 96;
    paperHeight = dims.h / 96;
    title = dims.title;

    await sendProgress('Hiding overlays…', 62);

    // Hide popups, fixed overlays, and sticky bars if requested
    if (options.hidePopups) {
      await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
        expression: `
          (function() {
            const selectors = [
              '[class*="cookie"]', '[class*="Cookie"]',
              '[id*="cookie"]',   '[id*="Cookie"]',
              '[class*="consent"]', '[class*="gdpr"]',
              '[class*="banner"]',  '[id*="banner"]',
              '[class*="chat-widget"]', '[id*="intercom"]',
              '[class*="drift"]',   '[class*="zendesk"]',
              '#hubspot-messages-iframe-container',
            ];
            selectors.forEach(sel => {
              try {
                document.querySelectorAll(sel).forEach(el => {
                  el.style.setProperty('display', 'none', 'important');
                });
              } catch (_) {}
            });
            // Hide all position:fixed and position:sticky overlays —
            // sticky headers/footers would otherwise appear mis-positioned in the PDF
            document.querySelectorAll('*').forEach(el => {
              const s = window.getComputedStyle(el);
              if ((s.position === 'fixed' || s.position === 'sticky') &&
                  el.tagName !== 'HTML' && el.tagName !== 'BODY') {
                el.style.setProperty('display', 'none', 'important');
              }
            });
          })()
        `,
        awaitPromise: false,
      });
    }

    await sendProgress('Generating PDF…', 70);

    // CDP Page.printToPDF — Chrome's native print engine.
    // paperWidth/paperHeight are exact page dimensions to avoid empty-page artifacts.
    // pageRanges:'1-1' clips any empty trailing page from sub-pixel rounding.
    const printResult = await chrome.debugger.sendCommand({ tabId }, 'Page.printToPDF', {
      printBackground: options.includeBackground,
      scale: 1,
      marginTop: 0,
      marginBottom: 0,
      marginLeft: 0,
      marginRight: 0,
      paperWidth,
      paperHeight,
      preferCSSPageSize: false,
      transferMode: 'ReturnAsBase64',
      pageRanges: '1-1',
    });

    await sendProgress('Saving to Downloads…', 90);

    // Guard against empty result (page blocked printing, or extreme size)
    if (!printResult?.data || printResult.data.length < 100) {
      throw new Error(
        'PDF came back empty. The page may be blocking printing, or is too large. ' +
        'Try refreshing the page and capturing again.'
      );
    }

    const dataUrl = 'data:application/pdf;base64,' + printResult.data;
    // Use the user-edited filename if provided, otherwise fall back to page title
    const filename = sanitizeFilename(options.filename || title) + '.pdf';

    const downloadId = await chrome.downloads.download({ url: dataUrl, filename });

    await sendProgress('Done!', 100);

    try {
      // Pass downloadId so popup can offer an "Open PDF" button
      await chrome.runtime.sendMessage({ type: 'DONE', downloadId });
    } catch (_) {}
}

function sanitizeFilename(name) {
  if (!name) return 'page2pdf-capture';
  return name
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .substring(0, 80);
}
