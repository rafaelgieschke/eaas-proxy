self.window = self;

importScripts("@@@/lib/xhr.js");
// importScripts("https://unpkg.com/browser-es-module-loader@0.4.1/dist/babel-browser-build.js");
// importScripts("https://unpkg.com/browser-es-module-loader@0.4.1/dist/browser-es-module-loader.js");
importScripts("https://raw.githack.com/rafaelgieschke/browser-es-module-loader/master/dist/babel-browser-build.js");
importScripts("https://raw.githack.com/rafaelgieschke/browser-es-module-loader/master/dist/browser-es-module-loader.js");

new BrowserESModuleLoader().import(location.search.slice(1));

self.oninstall = () => {
  skipWaiting();
};

self.onactivate = () => {
  clients.claim();
};

self.onfetch = () => {};
