// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { nsZenDOMOperatedFeature } from "chrome://browser/content/zen-components/ZenCommonUtils.mjs";

/**
 * HiFi Tile Shelf & Viewport Manager
 * Replaces the traditional tab bar with an intuitive bottom tile shelf
 * featuring static page snapshots, clear fallback previews, prominent "New Tile" button,
 * and reliable auto-tiling arrangements.
 */
class HiFiTileShelf extends nsZenDOMOperatedFeature {
  #shelfElement = null;
  #trackElement = null;
  #tabToCard = new WeakMap();
  #tabToSnapshotUrl = new WeakMap();
  #capturingTabs = new WeakSet();
  #autoArrangeTimeout = null;

  // Current active layout: "single" | "vsep" | "hsep" | "grid"
  currentLayout = "vsep";

  async init() {
    if (!Services.prefs.getBoolPref("hifi.tiles.shelf.enabled", true)) {
      return;
    }

    document.documentElement.setAttribute("hifi-tiles-active", "true");

    this.#createShelfDOM();
    this.#attachTabListeners();

    // Render cards and initialize arrangement across startup lifecycle
    const onReady = () => {
      this.#renderAllCards();
      this.autoArrange();
    };

    onReady();
    setTimeout(onReady, 350);
    setTimeout(onReady, 1000);
    setTimeout(onReady, 2500);

    try {
      const { SessionStore } = ChromeUtils.importESModule(
        "resource:///modules/sessionstore/SessionStore.sys.mjs"
      );
      SessionStore.promiseAllWindowsRestored?.then(onReady);
    } catch (e) {}

    window.addEventListener("load", onReady, { once: true });
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

    // 1. Brand / Mode Badge
    const brand = document.createElement("div");
    brand.classList.add("hifi-shelf-brand");
    const badge = document.createElement("span");
    badge.classList.add("hifi-shelf-badge");
    badge.textContent = "TILES";
    badge.title = "HiFi Tiled Viewport Shelf";
    brand.appendChild(badge);
    shelf.appendChild(brand);

    // 2. Prominent "+ New Tile" Action Button (at the start of shelf)
    const newBtn = document.createElement("button");
    newBtn.id = "hifi-shelf-new-tile-btn";
    newBtn.classList.add("hifi-shelf-new-tile-btn");
    newBtn.setAttribute("type", "button");
    newBtn.title = "Open New Tile";
    newBtn.innerHTML = `
      <span class="hifi-new-tile-plus">+</span>
      <span class="hifi-new-tile-text">New Tile</span>
    `;
    newBtn.addEventListener("click", () => {
      this.openNewTile();
    });
    shelf.appendChild(newBtn);

    // 3. Horizontal Scrollable Tile Cards Track
    const track = document.createElement("div");
    track.id = "hifi-shelf-track";
    track.classList.add("hifi-shelf-track");
    shelf.appendChild(track);
    this.#trackElement = track;

    parent.appendChild(shelf);
    this.#shelfElement = shelf;
  }

  #attachTabListeners() {
    const tabContainer = window.gBrowser?.tabContainer;
    if (!tabContainer) return;

    tabContainer.addEventListener("TabOpen", event => {
      const tab = event.target;
      this.#createCardForTab(tab);
      this.#triggerAutoArrangeDebounced();
    });

    tabContainer.addEventListener("TabClose", event => {
      const tab = event.target;
      this.#onTabClosed(tab);
    });

    tabContainer.addEventListener("TabSelect", () => {
      this.updateCardStates();
      const currentTab = window.gBrowser?.selectedTab;
      if (currentTab) {
        setTimeout(() => this.captureSnapshot(currentTab), 400);
      }
    });

    tabContainer.addEventListener("TabAttrModified", event => {
      const tab = event.target;
      this.#updateCardMetadata(tab);
    });
  }

  #onTabClosed(tab) {
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

    // If remaining tabs are fewer than needed, auto arrange
    setTimeout(() => {
      const remaining = window.gBrowser ? window.gBrowser.visibleTabs.filter(t => !t.hidden) : [];
      if (remaining.length === 0) {
        this.openNewTile();
      } else if (remaining.length === 1) {
        window.gZenViewSplitter?.unsplitCurrentView();
      } else {
        this.autoArrange();
      }
      this.updateCardStates();
    }, 150);
  }

  #renderAllCards() {
    if (!this.#trackElement || !window.gBrowser) return;
    for (const tab of window.gBrowser.tabs) {
      if (!tab.hidden && !this.#tabToCard.has(tab)) {
        this.#createCardForTab(tab);
      }
    }
    this.updateCardStates();
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

    // 1. Snapshot Image (displayed when captured)
    const thumbImg = document.createElement("img");
    thumbImg.classList.add("hifi-shelf-card-thumb");
    thumbImg.alt = "Tile Snapshot";
    const existingSnap = this.#tabToSnapshotUrl.get(tab);
    if (existingSnap) {
      thumbImg.src = existingSnap;
      thumbImg.style.display = "block";
    } else {
      thumbImg.style.display = "none";
    }
    thumbContainer.appendChild(thumbImg);

    // 2. Elegant Fallback Preview (visible while snapshot loads or when snapshot is empty)
    const fallback = document.createElement("div");
    fallback.classList.add("hifi-shelf-card-fallback");
    if (existingSnap) {
      fallback.style.display = "none";
    }

    const fallbackIcon = document.createElement("img");
    fallbackIcon.classList.add("hifi-shelf-fallback-icon");
    const fav = tab.getAttribute("image");
    fallbackIcon.src = fav || "chrome://global/skin/icons/defaultFavicon.svg";
    fallback.appendChild(fallbackIcon);

    const fallbackDomain = document.createElement("span");
    fallbackDomain.classList.add("hifi-shelf-fallback-domain");
    fallbackDomain.textContent = this.#getDomainFromTab(tab);
    fallback.appendChild(fallbackDomain);

    thumbContainer.appendChild(fallback);

    // Overlay (Minimized Badge + Close Button)
    const overlay = document.createElement("div");
    overlay.classList.add("hifi-shelf-card-overlay");

    const minBadge = document.createElement("span");
    minBadge.classList.add("hifi-shelf-min-badge");
    minBadge.textContent = "Minimized";
    overlay.appendChild(minBadge);

    const closeBtn = document.createElement("button");
    closeBtn.classList.add("hifi-shelf-card-close");
    closeBtn.setAttribute("type", "button");
    closeBtn.textContent = "✕";
    closeBtn.title = "Close Tile";
    closeBtn.addEventListener("click", e => {
      e.stopPropagation();
      e.preventDefault();
      this.closeTile(tab);
    });
    overlay.appendChild(closeBtn);

    thumbContainer.appendChild(overlay);
    card.appendChild(thumbContainer);

    // Footer: Favicon + Title
    const footer = document.createElement("div");
    footer.classList.add("hifi-shelf-card-footer");

    const icon = document.createElement("img");
    icon.classList.add("hifi-shelf-card-icon");
    icon.src = fav || "chrome://global/skin/icons/defaultFavicon.svg";
    footer.appendChild(icon);

    const title = document.createElement("span");
    title.classList.add("hifi-shelf-card-title");
    title.textContent = tab.label || "New Tile";
    footer.appendChild(title);

    card.appendChild(footer);

    // Click handler: Bring tile into viewport arrangement
    card.addEventListener("click", () => {
      this.bringTileIntoArrangement(tab);
    });

    this.#trackElement.appendChild(card);
    this.#tabToCard.set(tab, card);

    // Schedule initial snapshot
    if (tab.linkedBrowser) {
      setTimeout(() => this.captureSnapshot(tab), 400);
      tab.linkedBrowser.addEventListener(
        "load",
        () => {
          setTimeout(() => this.captureSnapshot(tab), 500);
        },
        { once: true }
      );
    }
  }

  #updateCardMetadata(tab) {
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
    const fav = tab.getAttribute("image");
    if (iconEl && fav) {
      iconEl.src = fav;
    }

    const fallbackIcon = card.querySelector(".hifi-shelf-fallback-icon");
    if (fallbackIcon && fav) {
      fallbackIcon.src = fav;
    }

    const fallbackDomain = card.querySelector(".hifi-shelf-fallback-domain");
    if (fallbackDomain) {
      fallbackDomain.textContent = this.#getDomainFromTab(tab);
    }

    this.updateCardStates();
  }

  #getDomainFromTab(tab) {
    try {
      const uri = tab.linkedBrowser?.currentURI;
      if (uri?.host) return uri.host;
      if (uri?.spec) return uri.spec.replace(/^https?:\/\//, "").split("/")[0];
    } catch (e) {}
    return tab.label || "New Tile";
  }

  updateCardStates() {
    if (!window.gBrowser) return;
    const selectedTab = window.gBrowser.selectedTab;
    const activeTiles = new Set(this.getActiveSplitTabs());

    for (const tab of window.gBrowser.tabs) {
      const card = this.#tabToCard.get(tab);
      if (!card) continue;

      const isSelected = tab === selectedTab;
      const isMinimized = tab.getAttribute("hifi-minimized") === "true";
      const isInArrangement = activeTiles.has(tab);
      const isPlaying = !!tab.soundPlaying;
      const isMuted = !!tab.muted;

      card.classList.toggle("is-selected", isSelected);
      card.classList.toggle("is-minimized", isMinimized);
      card.classList.toggle("is-active-tile", isInArrangement);
      card.classList.toggle("sound-playing", isPlaying);
      card.classList.toggle("is-muted", isMuted);
    }
  }

  /**
   * Returns the list of tabs currently rendered in the split-view arrangement.
   */
  getActiveSplitTabs() {
    if (window.gZenViewSplitter?.currentView >= 0) {
      const group = window.gZenViewSplitter._data[window.gZenViewSplitter.currentView];
      if (group && Array.isArray(group.tabs)) {
        return group.tabs.filter(t => !t.closing && t.isConnected);
      }
    }
    const splitTabs = window.gBrowser
      ? window.gBrowser.tabs.filter(t => t.splitView && !t.closing)
      : [];
    if (splitTabs.length > 0) return splitTabs;
    return window.gBrowser?.selectedTab ? [window.gBrowser.selectedTab] : [];
  }

  /**
   * Brings a given tile into the active viewport arrangement.
   * If already on screen, focuses it. If not, swaps/adds it into the arrangement.
   */
  bringTileIntoArrangement(targetTab) {
    if (!targetTab || !window.gBrowser) return;

    // Remove minimized badge if set
    targetTab.removeAttribute("hifi-minimized");

    if (this.currentLayout === "single" || !window.gZenViewSplitter) {
      window.gZenViewSplitter?.unsplitCurrentView();
      window.gBrowser.selectedTab = targetTab;
      this.updateCardStates();
      return;
    }

    const active = this.getActiveSplitTabs();
    if (active.includes(targetTab)) {
      // Tile is already displayed on screen; simply focus it
      window.gBrowser.selectedTab = targetTab;
      this.updateCardStates();
      return;
    }

    const maxTiles = this.currentLayout === "grid" ? 4 : 2;

    if (active.length < maxTiles) {
      // Slot available: add directly to split
      window.gZenViewSplitter.splitTabs([...active, targetTab], this.currentLayout);
    } else {
      // Full arrangement: replace the currently focused tile (or first slot)
      const currentSelected = window.gBrowser.selectedTab;
      let newActive = active.map(t => (t === currentSelected ? targetTab : t));
      if (!newActive.includes(targetTab)) {
        newActive[newActive.length - 1] = targetTab;
      }
      window.gZenViewSplitter.splitTabs(newActive, this.currentLayout);
    }

    window.gBrowser.selectedTab = targetTab;
    this.updateCardStates();
  }

  /**
   * Sets the arrangement layout explicitly: "single" | "vsep" | "hsep" | "grid"
   */
  setLayout(layoutType) {
    this.currentLayout = layoutType === "unsplit" ? "single" : layoutType;

    if (this.currentLayout === "single") {
      window.gZenViewSplitter?.unsplitCurrentView();
      this.updateCardStates();
      return;
    }

    const visible = (window.gBrowser?.visibleTabs || []).filter(
      t => !t.hidden && t.getAttribute("hifi-minimized") !== "true"
    );

    const targetCount = this.currentLayout === "grid" ? 4 : 2;
    const tabsToSplit = visible.slice(0, targetCount);

    if (tabsToSplit.length >= 2) {
      window.gZenViewSplitter?.splitTabs(tabsToSplit, this.currentLayout);
    } else if (tabsToSplit.length === 1) {
      window.gZenViewSplitter?.unsplitCurrentView();
      window.gBrowser.selectedTab = tabsToSplit[0];
    }
    this.updateCardStates();
  }

  /**
   * Safely closes a tile, detaching it from split groups and the browser.
   */
  closeTile(tab) {
    if (!tab) return;
    try {
      if (window.gZenViewSplitter) {
        window.gZenViewSplitter.removeTabFromGroup(tab, undefined, { forUnsplit: true });
      }
    } catch (e) {}

    try {
      window.gBrowser?.removeTab(tab);
    } catch (e) {
      console.warn("Could not remove tab", e);
    }
  }

  /**
   * Minimizes a tile into the shelf.
   */
  minimizeTile(tab) {
    if (!tab) return;
    tab.setAttribute("hifi-minimized", "true");
    try {
      if (window.gZenViewSplitter) {
        window.gZenViewSplitter.removeTabFromGroup(tab, undefined, { forUnsplit: true });
      }
    } catch (e) {}

    // Refill arrangement slot if other visible tabs exist
    const available = (window.gBrowser?.visibleTabs || []).filter(
      t => !t.hidden && t !== tab && t.getAttribute("hifi-minimized") !== "true"
    );

    const targetCount = this.currentLayout === "grid" ? 4 : 2;
    if (available.length >= 2 && this.currentLayout !== "single") {
      window.gZenViewSplitter?.splitTabs(available.slice(0, targetCount), this.currentLayout);
    } else if (available.length === 1) {
      window.gZenViewSplitter?.unsplitCurrentView();
      window.gBrowser.selectedTab = available[0];
    }
    this.updateCardStates();
  }

  #triggerAutoArrangeDebounced() {
    clearTimeout(this.#autoArrangeTimeout);
    this.#autoArrangeTimeout = setTimeout(() => {
      this.autoArrange();
    }, 200);
  }

  /**
   * Automatically establishes the split arrangement if 2+ tabs are open.
   */
  autoArrange() {
    if (!Services.prefs.getBoolPref("hifi.tiles.auto-tile", true)) return;
    if (!window.gZenViewSplitter || !window.gBrowser) return;

    if (this.currentLayout === "single") return;

    const visibleTabs = window.gBrowser.visibleTabs.filter(
      t => !t.hidden && t.getAttribute("hifi-minimized") !== "true"
    );

    if (visibleTabs.length < 2) return;

    const activeSplit = this.getActiveSplitTabs();
    if (activeSplit.length < 2) {
      const targetCount = this.currentLayout === "grid" ? 4 : 2;
      window.gZenViewSplitter.splitTabs(
        visibleTabs.slice(0, targetCount),
        this.currentLayout
      );
    }
    this.updateCardStates();
  }

  /**
   * Captures a static page snapshot for the tile card preview.
   */
  async captureSnapshot(tab) {
    if (!tab || tab.closing || this.#capturingTabs.has(tab)) return;
    const browser = tab.linkedBrowser;
    if (!browser) return;

    this.#capturingTabs.add(tab);
    try {
      let image = null;

      // 1. Direct browser.drawSnapshot (standard Gecko API)
      if (typeof browser.drawSnapshot === "function") {
        image = await browser.drawSnapshot(0, 0, 0, 0, 0.22, "white", true);
      }

      // 2. BrowsingContext WindowGlobalParent fallback
      if (!image && browser.browsingContext?.currentWindowGlobal?.drawSnapshot) {
        image = await browser.browsingContext.currentWindowGlobal.drawSnapshot(
          null,
          0.22,
          "white"
        );
      }

      if (!image) return;

      const canvas = new OffscreenCanvas(image.width, image.height);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(image, 0, 0);
      image.close();

      const blob = await canvas.convertToBlob({
        type: "image/webp",
        quality: 0.85
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
        const fallback = card.querySelector(".hifi-shelf-card-fallback");
        if (thumbImg) {
          thumbImg.src = newUrl;
          thumbImg.style.display = "block";
        }
        if (fallback) {
          fallback.style.display = "none";
        }
      }
    } catch (e) {
      // Fallback stays visible
    } finally {
      this.#capturingTabs.delete(tab);
    }
  }

  /**
   * Opens a new tile tab and brings it into the active arrangement.
   */
  openNewTile(url = "about:newtab") {
    if (!window.gBrowser) return;
    const newTab = window.gBrowser.addTrustedTab(url, {
      inBackground: false,
      triggeringPrincipal: Services.scriptsecuritymanager.getSystemPrincipal()
    });
    window.gBrowser.selectedTab = newTab;
    setTimeout(() => {
      this.bringTileIntoArrangement(newTab);
    }, 150);
  }
}

window.gHiFiTileShelf = new HiFiTileShelf();
