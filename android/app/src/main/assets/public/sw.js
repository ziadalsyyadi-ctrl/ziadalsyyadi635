/**
 * Copyright 2018 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// If the loader is already loaded, just stop.
if (!self.define) {
  let registry = {};

  // Used for `eval` and `importScripts` where we can't get script URL by other means.
  // In both cases, it's safe to use a global var because those functions are synchronous.
  let nextDefineUri;

  const singleRequire = (uri, parentUri) => {
    uri = new URL(uri + ".js", parentUri).href;
    return registry[uri] || (
      
        new Promise(resolve => {
          if ("document" in self) {
            const script = document.createElement("script");
            script.src = uri;
            script.onload = resolve;
            document.head.appendChild(script);
          } else {
            nextDefineUri = uri;
            importScripts(uri);
            resolve();
          }
        })
      
      .then(() => {
        let promise = registry[uri];
        if (!promise) {
          throw new Error(`Module ${uri} didn’t register its module`);
        }
        return promise;
      })
    );
  };

  self.define = (depsNames, factory) => {
    const uri = nextDefineUri || ("document" in self ? document.currentScript.src : "") || location.href;
    if (registry[uri]) {
      // Module is already loading or loaded.
      return;
    }
    let exports = {};
    const require = depUri => singleRequire(depUri, uri);
    const specialDeps = {
      module: { uri },
      exports,
      require
    };
    registry[uri] = Promise.all(depsNames.map(
      depName => specialDeps[depName] || require(depName)
    )).then(deps => {
      factory(...deps);
      return exports;
    });
  };
}
define(['./workbox-b1bafff1'], (function (workbox) { 'use strict';

  self.skipWaiting();
  workbox.clientsClaim();
  /**
   * The precacheAndRoute() method efficiently caches and responds to
   * requests for URLs in the manifest.
   * See https://goo.gl/S9QRab
   */
  workbox.precacheAndRoute([{
    "url": "registerSW.js",
    "revision": "1872c500de691dce40960bb85481de07"
  }, {
    "url": "pwa-maskable-512x512.png",
    "revision": "5f7a2e92697da39d9b2f4c2f44bb7f88"
  }, {
    "url": "pwa-512x512.png",
    "revision": "7b203fdb7b190066dd6a504a1caf0233"
  }, {
    "url": "pwa-192x192.png",
    "revision": "785575716e490f0098625300e5680212"
  }, {
    "url": "privacy.html",
    "revision": "81f6a121e50162890a04f8556319bf17"
  }, {
    "url": "offline.html",
    "revision": "8ec4deea565882642a9bc613e2d2b37f"
  }, {
    "url": "index.html",
    "revision": "2490577cb2584e7f7d63a7cb86db006a"
  }, {
    "url": "icon.svg",
    "revision": "696670265fd8899643c9d3ee8c53a0aa"
  }, {
    "url": "apple-touch-icon.png",
    "revision": "e6c3ad82207c6bb64f84908f91bdf471"
  }, {
    "url": "assets/web-xUL2PQH0.js",
    "revision": null
  }, {
    "url": "assets/web-Dm83kf0y.js",
    "revision": null
  }, {
    "url": "assets/web-CrnKFnI-.js",
    "revision": null
  }, {
    "url": "assets/web-CgTikDSB.js",
    "revision": null
  }, {
    "url": "assets/web-C0C5oW53.js",
    "revision": null
  }, {
    "url": "assets/web-B2m1RIbG.js",
    "revision": null
  }, {
    "url": "assets/rolldown-runtime-la_ZsWYt.js",
    "revision": null
  }, {
    "url": "assets/react-vendor-B66vKKKj.js",
    "revision": null
  }, {
    "url": "assets/index-VohRq2t5.css",
    "revision": null
  }, {
    "url": "assets/index-Bjy1fQT5.js",
    "revision": null
  }, {
    "url": "assets/icons-vendor-DWSVIP7f.js",
    "revision": null
  }, {
    "url": "assets/firebase-vendor-CgDVrt5K.js",
    "revision": null
  }, {
    "url": "assets/aistudio/nadi_jishan_blood_donation_poster_0524ef1d.webp",
    "revision": null
  }, {
    "url": "assets/aistudio/file_0000000095248211b993231fe2c26b0d_43df0429.webp",
    "revision": null
  }, {
    "url": "assets/aistudio/file_0000000045e882119c7c9319efd48f08_cf9f259d.webp",
    "revision": null
  }, {
    "url": "assets/aistudio/1794594460673_53a90780.webp",
    "revision": null
  }, {
    "url": "apple-touch-icon.png",
    "revision": "e6c3ad82207c6bb64f84908f91bdf471"
  }, {
    "url": "icon.svg",
    "revision": "696670265fd8899643c9d3ee8c53a0aa"
  }, {
    "url": "offline.html",
    "revision": "8ec4deea565882642a9bc613e2d2b37f"
  }, {
    "url": "pwa-192x192.png",
    "revision": "785575716e490f0098625300e5680212"
  }, {
    "url": "pwa-512x512.png",
    "revision": "7b203fdb7b190066dd6a504a1caf0233"
  }, {
    "url": "pwa-maskable-512x512.png",
    "revision": "5f7a2e92697da39d9b2f4c2f44bb7f88"
  }, {
    "url": "manifest.webmanifest",
    "revision": "c3453ca4a26e4356da9cc93f16e61b17"
  }], {});
  workbox.cleanupOutdatedCaches();
  workbox.registerRoute(new workbox.NavigationRoute(workbox.createHandlerBoundToURL("index.html")));
  workbox.registerRoute(/^https:\/\/fonts\.googleapis\.com\/.*/i, new workbox.CacheFirst({
    "cacheName": "google-fonts-cache",
    plugins: [new workbox.ExpirationPlugin({
      maxEntries: 10,
      maxAgeSeconds: 31536000
    }), new workbox.CacheableResponsePlugin({
      statuses: [0, 200]
    })]
  }), 'GET');
  workbox.registerRoute(/^https:\/\/fonts\.gstatic\.com\/.*/i, new workbox.CacheFirst({
    "cacheName": "gstatic-fonts-cache",
    plugins: [new workbox.ExpirationPlugin({
      maxEntries: 10,
      maxAgeSeconds: 31536000
    }), new workbox.CacheableResponsePlugin({
      statuses: [0, 200]
    })]
  }), 'GET');
  workbox.registerRoute(/\.(?:png|jpg|jpeg|svg|gif|webp|ico)$/i, new workbox.StaleWhileRevalidate({
    "cacheName": "images-cache",
    plugins: [new workbox.ExpirationPlugin({
      maxEntries: 50,
      maxAgeSeconds: 2592000
    })]
  }), 'GET');

}));
