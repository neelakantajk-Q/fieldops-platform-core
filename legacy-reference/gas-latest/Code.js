/**
 * Web app entry points.
 *
 * doGet  - serves the portal shell (the same index.html published to Pages)
 * doPost - single JSON API used by the portal and by the Android service
 *
 * All authorisation lives behind Router.gs; this file only parses and wraps.
 */

function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('Field Operations & HRMS Portal')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function doPost(e) {
  try {
    return handleRequest_(parseBody_(e));
  } catch (error) {
    return toErrorResponse_(error, 'doPost', null);
  }
}

/**
 * google.script.run cannot serialise ContentService.TextOutput, so in-page
 * clients get plain JSON through the same dispatcher.
 */
function callWebApp(payload) {
  var output = doPost({ postData: { contents: JSON.stringify(payload || {}) } });
  return JSON.parse(output.getContent());
}

/** Used by HtmlService templates when the shell is split into partials. */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/** Health check from the editor or an uptime probe. */
function healthCheck() {
  return pingAction_();
}
