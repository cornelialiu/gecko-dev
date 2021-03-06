/*globals
  XPCOMUtils,
  aboutNewTabService,
  Services,
  ContentTask,
  TestUtils,
  BrowserOpenTab,
  registerCleanupFunction,
  is,
  content
*/

"use strict";

let Cu = Components.utils;
Cu.import("resource://gre/modules/Task.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/Preferences.jsm");

XPCOMUtils.defineLazyServiceGetter(this, "aboutNewTabService",
                                   "@mozilla.org/browser/aboutnewtab-service;1",
                                   "nsIAboutNewTabService");

registerCleanupFunction(function() {
  Services.prefs.setBoolPref("browser.newtabpage.remote", false);
  aboutNewTabService.resetNewTabURL();
});

/*
 * Tests that the default newtab page is always returned when one types "about:newtab" in the URL bar,
 * even when overridden.
 */
add_task(function* redirector_ignores_override() {
  let overrides = [
    "chrome://browser/content/downloads/contentAreaDownloadsView.xul",
    "about:home",
  ];

  for (let overrideURL of overrides) {
    let notificationPromise = nextChangeNotificationPromise(overrideURL, `newtab page now points to ${overrideURL}`);
    aboutNewTabService.newTabURL = overrideURL;

    yield notificationPromise;
    Assert.ok(aboutNewTabService.overridden, "url has been overridden");

    let tabOptions = {
      gBrowser,
      url: "about:newtab",
    };

    /*
     * Simulate typing "about:newtab" in the url bar.
     *
     * Bug 1240169 - We expect the redirector to lead the user to "about:newtab", the default URL,
     * due to invoking AboutRedirector. A user interacting with the chrome otherwise would lead
     * to the overriding URLs.
     */
    yield BrowserTestUtils.withNewTab(tabOptions, function*(browser) {
      yield ContentTask.spawn(browser, {}, function*() {
        is(content.location.href, "about:newtab", "Got right URL");
        is(content.document.location.href, "about:newtab", "Got right URL");
        is(content.document.nodePrincipal,
           Services.scriptSecurityManager.getSystemPrincipal(),
           "nodePrincipal should match systemPrincipal");
      });
    });  // jshint ignore:line
  }
});

/*
 * Tests loading an overridden newtab page by simulating opening a newtab page from chrome
 */
add_task(function* override_loads_in_browser() {
  let overrides = [
    "chrome://browser/content/downloads/contentAreaDownloadsView.xul",
    "about:home",
    " about:home",
  ];

  for (let overrideURL of overrides) {
    let notificationPromise = nextChangeNotificationPromise(overrideURL.trim(), `newtab page now points to ${overrideURL}`);
    aboutNewTabService.newTabURL = overrideURL;

    yield notificationPromise;
    Assert.ok(aboutNewTabService.overridden, "url has been overridden");

    // simulate a newtab open as a user would
    BrowserOpenTab();  // jshint ignore:line

    let browser = gBrowser.selectedBrowser;
    yield BrowserTestUtils.browserLoaded(browser);

    yield ContentTask.spawn(browser, {url: overrideURL}, function*(args) {
      is(content.location.href, args.url.trim(), "Got right URL");
      is(content.document.location.href, args.url.trim(), "Got right URL");
    });  // jshint ignore:line
    yield BrowserTestUtils.removeTab(gBrowser.selectedTab);
  }
});

/*
 * Tests edge cases when someone overrides the newtabpage with whitespace
 */
add_task(function* override_blank_loads_in_browser() {
  let overrides = [
    "",
    " ",
    "\n\t",
    " about:blank",
  ];

  for (let overrideURL of overrides) {
    let notificationPromise = nextChangeNotificationPromise("about:blank", "newtab page now points to about:blank");
    aboutNewTabService.newTabURL = overrideURL;

    yield notificationPromise;
    Assert.ok(aboutNewTabService.overridden, "url has been overridden");

    // simulate a newtab open as a user would
    BrowserOpenTab();  // jshint ignore:line

    let browser = gBrowser.selectedBrowser;
    yield BrowserTestUtils.browserLoaded(browser);

    yield ContentTask.spawn(browser, {}, function*() {
      is(content.location.href, "about:blank", "Got right URL");
      is(content.document.location.href, "about:blank", "Got right URL");
    });  // jshint ignore:line
    yield BrowserTestUtils.removeTab(gBrowser.selectedTab);
  }
});

function nextChangeNotificationPromise(aNewURL, testMessage) {
  return TestUtils.topicObserved("newtab-url-changed", function observer(aSubject, aData) {  // jshint unused:false
      Assert.equal(aData, aNewURL, testMessage);
      return true;
  }.bind(this));
}
