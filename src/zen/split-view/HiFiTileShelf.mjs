// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { nsZenDOMOperatedFeature } from "chrome://browser/content/zen-components/ZenCommonUtils.mjs";

/**
 * HiFi Tile Shelf & Auto-Tile Engine
 * Manages the bottom tile shelf dock, static tab snapshots, and automatic tiling.
 */
class HiFiTileShelf extends nsZenDOMOperatedFeature {
  #shelfElement = null;
  #trackElement = null;
  #tabToCard = new WeakMap();
  #tabToSnapshotUrl = new WeakMap();
  #capturingTabs = new WeakSet();
  #autoTileTimeout = null;

  async init() {
    if (!Services.prefs.getBoolPref("hifi.tiles.shelf.enabled", true)) {
      return;
    }

    document.documentElement.setAttribute("hifi-tiles-active", "true");

    this.#createShelfDOM();
    this.#attachTabListeners();

    // Initial render
    this.#renderAllCards();

    // Startup retry loop: captures tabs restored asynchronously by SessionStore
    const checkStartup = () => {
      this.#renderAllCards();
      this.checkAutoTile();
    };

    setTimeout(checkStartup, 400);
    setTimeout(checkStartup, 1000);
    setTimeout(checkStartup, 2500);

    // Wait for SessionStore and delayed startup
    try {
      const { SessionStore } = ChromeUtils.importESModule(
        "resource:///modules/sessionstore/SessionStore.sys.mjs"
      );
      SessionStore.promiseAllWindowsRestored?.then(() => {
        checkStartup();
      });
    } catch (e) {
      // Fallback timer already active
    }

    window.addEventListener(
      "load",
      () => {
        checkStartup();
      },
      { once: true }
    );
  }

  #createShelfDOM() {
    const parent =
      document.getElementById("zen-appcontent-wrapper") ||
      document.getElementById("browser");
    if (!parent) return;

    document.getElementById("hifi-tile-shelf")?.remove();

    const shelf = document.createElement("div");
    shelf.id = "hifi-tile-shelf";
    shelf.classList.add("hifi-tile-shelf");

    // Brand / Mode badge
    const brand = document.createElement("div");
    brand.classList.add("hifi-shelf-brand");
    const badge = document.createElement("span");
    badge.classList.add("hifi-shelf-badge");
    badge.textContent = "TILES";
    badge.title = "HiFi Tiled Viewport Shelf";
    brand.appendChild(badge);
    shelf.appendChild(brand);

    // Scrollable Cards Track
    const track = document.createElement("div");
    track.id = "hifi-shelf-track";
    track.classList.add("hifi-shelf-track");
    shelf.appendChild(track);
    this.#trackElement = track;

    // Actions (New Tile + Button)
    const actions = document.createElement("div");
    actions.classList.add("hifi-shelf-actions");

    const newBtn = document.createElement("button");
    newBtn.id = "hifi-shelf-new-tile-btn";
    newBtn.classList.add("hifi-shelf-action-btn");
    newBtn.title = "Open New Tile";
    newBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="13" height="13" fill="currentColor">
        <path d="M8 2a.75.75 0 0 1 .75.75v4.5h4.5a.75.75 0 0 1 0 1.5h-4.5v4.5a.75.75 0 0 1-1.5 0v-4.5h-4.5a.75.75 0 0 1 0-1.5h4.5v-4.5A.75.75 0 0 1 8 2z"/>
      </svg>
    `;
    newBtn.addEventListener("click", () => {
      this.#openNewTile();
    });
    actions.appendChild(newBtn);

    shelf.appendChild(actions);

    parent.appendChild(shelf);
    this.#shelfElement = shelf;
  }

  #attachTabListeners() {
    const tabContainer = window.gBrowser?.tabContainer;
    if (!tabContainer) return;

    tabContainer.addEventListener("TabOpen", event => {
      this.#onTabOpen(event.target);
    });

    tabContainer.addEventListener("TabClose", event => {
      this.#onTabClose(event.target);
    });

    tabContainer.addEventListener("TabSelect", () => {
      this.#updateCardStates();
      const currentTab = window.gBrowser?.selectedTab;
      if (currentTab) {
        setTimeout(() => this.#captureSnapshot(currentTab), 300);
      }
    });

    tabContainer.addEventListener("TabAttrModified", event => {
      this.#updateCard(event.target);
    });

    // Listen to minimize action from HiFiTileBar
    window.addEventListener("hifi-tile-minimized", event => {
      const tab = event.detail?.tab;
      if (tab) {
        this.#captureSnapshot(tab);
        this.#updateCardStates();
      }
    });
  }

  #onTabOpen(tab) {
    this.#createCardForTab(tab);
    this.#triggerAutoTileDebounced();
  }

  #onTabClose(tab) {
    const card = this.#tabToCard.get(tab);
    if (card) {
      card.remove();
      this.#tabToCard.delete(tab);
    }
    const snapUrl = this.#tabToSnapshotUrl.get(tab);
    if (snapUrl) {
      try {
        URL.revokeObjectURL(snapUrl);
      } catch (e) {}
      this.#tabToSnapshotUrl.delete(tab);
    }
    this.#triggerAutoTileDebounced();
  }

  #renderAllCards() {
    if (!this.#trackElement || !window.gBrowser) return;
    for (const tab of window.gBrowser.tabs) {
      if (!tab.hidden && !this.#tabToCard.has(tab)) {
        this.#createCardForTab(tab);
      }
    }
    this.#updateCardStates();
  }

  #createCardForTab(tab) {
    if (!this.#trackElement || this.#tabToCard.has(tab)) return;

    const card = document.createElement("div");
    card.classList.add("hifi-shelf-card");
    card.setAttribute("tabindex", "0");
    card.setAttribute("role", "button");

    // Thumbnail Preview Area
    const thumbContainer = document.createElement("div");
    thumbContainer.classList.add("hifi-shelf-card-thumb-container");

    const thumbImg = document.createElement("img");
    thumbImg.classList.add("hifi-shelf-card-thumb");
    thumbImg.setAttribute("alt", "Tile Snapshot");
    const existingSnap = this.#tabToSnapshotUrl.get(tab);
    if (existingSnap) {
      thumbImg.src = existingSnap;
      thumbImg.style.display = "block";
    } else {
      thumbImg.style.display = "none";
    }
    thumbContainer.appendChild(thumbImg);

    // Overlay (Status, Minimized Badge, Close)
    const overlay = document.createElement("div");
    overlay.classList.add("hifi-shelf-card-overlay");

    const minBadge = document.createElement("span");
    minBadge.classList.add("hifi-shelf-min-badge");
    minBadge.textContent = "Minimized";
    overlay.appendChild(minBadge);

    const closeBtn = document.createElement("button");
    closeBtn.classList.add("hifi-shelf-card-close");
    closeBtn.textContent = "✕";
    closeBtn.title = "Close tile";
    closeBtn.addEventListener("click", e => {
      e.stopPropagation();
      window.gBrowser?.removeTab(tab);
    });
    overlay.appendChild(closeBtn);

    thumbContainer.appendChild(overlay);
    card.appendChild(thumbContainer);

    // Meta Footer (Favicon + Title)
    const footer = document.createElement("div");
    footer.classList.add("hifi-shelf-card-footer");

    const icon = document.createElement("img");
    icon.classList.add("hifi-shelf-card-icon");
    const favSrc = tab.getAttribute("image");
    if (favSrc) {
      icon.setAttribute("src", favSrc);
    } else {
      icon.src = "chrome://global/skin/icons/defaultFavicon.svg";
    }
    footer.appendChild(icon);

    const title = document.createElement("span");
    title.classList.add("hifi-shelf-card-title");
    title.textContent = tab.label || "New Tile";
    footer.appendChild(title);

    card.appendChild(footer);

    // Click handler: select or restore tile
    card.addEventListener("click", () => {
      this.#onCardClick(tab);
    });

    this.#trackElement.appendChild(card);
    this.#tabToCard.set(tab, card);

    // Capture initial snapshot
    if (tab.linkedBrowser) {
      setTimeout(() => this.#captureSnapshot(tab), 400);
      tab.linkedBrowser.addEventListener(
        "load",
        () => {
          setTimeout(() => this.#captureSnapshot(tab), 400);
        },
        { once: true }
      );
    }
  }

  #updateCard(tab) {
    const card = this.#tabToCard.get(tab);
    if (!card) {
      this.#createCardForTab(tab);
      return;
    }

    const titleEl = card.querySelector(".hifi-shelf-card-title");
    if (titleEl) {
      titleEl.textContent = tab.label || "New Tile";
      titleEl.title = tab.label || "";
    }

    const iconEl = card.querySelector(".hifi-shelf-card-icon");
    if (iconEl) {
      const fav = tab.getAttribute("image");
      if (fav) {
        iconEl.setAttribute("src", fav);
        iconEl.style.display = "";
      }
    }

    this.#updateCardStates();
  }

  #updateCardStates() {
    if (!window.gBrowser) return;
    const selectedTab = window.gBrowser.selectedTab;

    for (const tab of window.gBrowser.tabs) {
      const card = this.#tabToCard.get(tab);
      if (!card) continue;

      const isSelected = tab === selectedTab;
      const isMinimized = tab.getAttribute("hifi-minimized") === "true";
      const isSplit = !!tab.splitView;
      const isPlaying = !!tab.soundPlaying;
      const isMuted = !!tab.muted;

      card.classList.toggle("is-selected", isSelected);
      card.classList.toggle("is-minimized", isMinimized);
      card.classList.toggle("is-split", isSplit);
      card.classList.toggle("sound-playing", isPlaying);
      card.classList.toggle("is-muted", isMuted);
    }
  }

  #onCardClick(tab) {
    const isMinimized = tab.getAttribute("hifi-minimized") === "true";
    if (isMinimized) {
      tab.removeAttribute("hifi-minimized");
      if (window.gZenViewSplitter) {
        const visibleTabs = window.gBrowser.visibleTabs.filter(
          t => !t.hidden && !t.getAttribute("hifi-minimized")
        );
        if (visibleTabs.length >= 2) {
          window.gZenViewSplitter.splitTabs(visibleTabs.slice(0, 4), "grid");
        } else {
          window.gBrowser.selectedTab = tab;
        }
      } else {
        window.gBrowser.selectedTab = tab;
      }
    } else {
      window.gBrowser.selectedTab = tab;
    }
    this.#updateCardStates();
  }

  async #captureSnapshot(tab) {
    if (!tab || tab.closing || this.#capturingTabs.has(tab)) return;
    const browser = tab.linkedBrowser;
    if (!browser) return;

    this.#capturingTabs.add(tab);
    try {
      const global = browser.browsingContext?.currentWindowGlobal;
      if (!global || !global.drawSnapshot) return;

      const rect = browser.getBoundingClientRect();
      const w = Math.max(120, Math.round(rect.width || 800));
      const h = Math.max(80, Math.round(rect.height || 600));

      const targetThumbWidth = 220;
      const scale = Math.min(1.0, targetThumbWidth / w);

      const imageBitmap = await global.drawSnapshot(
        new DOMRect(0, 0, w, h),
        scale,
        "white"
      );

      if (!imageBitmap) return;

      const canvas = new OffscreenCanvas(imageBitmap.width, imageBitmap.height);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(imageBitmap, 0, 0);
      imageBitmap.close();

      const blob = await canvas.convertToBlob({
        type: "image/webp",
        quality: 0.82
      });

      const oldUrl = this.#tabToSnapshotUrl.get(tab);
      if (oldUrl) {
        try {
          URL.revokeObjectURL(oldUrl);
        } catch (e) {}
      }

      const newUrl = URL.createObjectURL(blob);
      this.#tabToSnapshotUrl.set(tab, newUrl);

      const card = this.#tabToCard.get(tab);
      if (card) {
        const thumbImg = card.querySelector(".hifi-shelf-card-thumb");
        if (thumbImg) {
          thumbImg.src = newUrl;
          thumbImg.style.display = "block";
        }
      }
    } catch (e) {
      // Ignore background snapshot warnings
    } finally {
      this.#capturingTabs.delete(tab);
    }
  }

  #triggerAutoTileDebounced() {
    clearTimeout(this.#autoTileTimeout);
    this.#autoTileTimeout = setTimeout(() => {
      this.checkAutoTile();
    }, 200);
  }

  checkAutoTile() {
    if (!Services.prefs.getBoolPref("hifi.tiles.auto-tile", true)) {
      return;
    }
    if (!window.gZenViewSplitter || !window.gBrowser) return;

    const visibleTabs = window.gBrowser.visibleTabs.filter(
      t => !t.hidden && !t.getAttribute("hifi-minimized")
    );

    if (visibleTabs.length < 2) return;

    const anySplit = visibleTabs.some(t => t.splitView);
    if (!anySplit) {
      // Auto-split all visible tabs side-by-side or grid
      window.gZenViewSplitter.splitTabs(
        visibleTabs.slice(0, 4),
        visibleTabs.length === 2 ? "vsep" : "grid"
      );
    } else if (window.gZenViewSplitter.currentView >= 0) {
      const currentGroup = window.gZenViewSplitter._data[window.gZenViewSplitter.currentView];
      if (currentGroup && currentGroup.tabs.length < 4) {
        const unsplitTab = visibleTabs.find(t => !currentGroup.tabs.includes(t));
        if (unsplitTab) {
          window.gZenViewSplitter.splitTabs(
            [...currentGroup.tabs, unsplitTab],
            currentGroup.tabs.length >= 2 ? "grid" : "vsep"
          );
        }
      }
    }
    this.#updateCardStates();
  }

  #openNewTile() {
    if (!window.gBrowser) return;
    const newTab = window.gBrowser.addTrustedTab("about:newtab", {
      inBackground: false,
      triggeringPrincipal: Services.scriptsecuritymanager.getSystemPrincipal()
    });
    window.gBrowser.selectedTab = newTab;
    this.#triggerAutoTileDebounced();
  }
}

window.gHiFiTileShelf = new HiFiTileShelf();
