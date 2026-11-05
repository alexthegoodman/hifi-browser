// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { nsZenDOMOperatedFeature } from "chrome://browser/content/zen-components/ZenCommonUtils.mjs";

const DEFAULT_FAVICON = "chrome://global/skin/icons/defaultFavicon.svg";
const LAYOUT_PREF = "hifi.tiles.layout";
const LAYOUTS = ["auto", "single", "vsep", "hsep", "grid"];

// How many tiles each layout can show at once
const LAYOUT_CAPACITY = { auto: 4, single: 1, vsep: 3, hsep: 3, grid: 4 };

// Refresh previews of on-screen tiles so videos and games stay current
const LIVE_PREVIEW_INTERVAL_MS = 5000;

/**
 * HiFi Tile Shelf & Viewport Manager
 *
 * The shelf is the "tab bar": every tile tab gets a card along the bottom of
 * the window. The tiles currently on screen are the "arrangement", which is
 * always applied through #arrange() so the split view, the selected tab and
 * the shelf cards can never drift apart.
 */
class HiFiTileShelf extends nsZenDOMOperatedFeature {
  #shelfElement = null;
  #trackElement = null;
  #newTileButton = null;
  #tabToCard = new WeakMap();
  #tabToSnapshotUrl = new WeakMap();
  #capturingTabs = new WeakSet();

  // Tabs currently shown on screen, in slot order
  #arrangement = [];
  // True while #arrange() drives the splitter, so our own TabSelects are ignored
  #arranging = false;
  // True between a TabClose and our follow-up, so Firefox's fallback selection isn't adopted
  #closing = false;
  // Off until session restore is done, so restored tabs aren't pulled on screen
  #ready = false;
  #syncQueued = false;
  #lastSelected = null;

  currentLayout = "auto";

  init() {
    if (!Services.prefs.getBoolPref("hifi.tiles.shelf.enabled", true)) {
      return;
    }

    const savedLayout = Services.prefs.getStringPref(LAYOUT_PREF, "auto");
    this.currentLayout = LAYOUTS.includes(savedLayout) ? savedLayout : "auto";

    document.documentElement.setAttribute("hifi-tiles-active", "true");

    this.#createShelfDOM();
    this.#attachListeners();

    // gBrowser and session restore come up after DOMContentLoaded; syncing is
    // idempotent, so just resync at each stage of startup.
    const onReady = () => {
      this.#adoptSplitterState();
      this.#sync();
    };
    const onRestored = () => {
      onReady();
      this.#ready = true;
    };
    window.addEventListener(
      "load",
      () => {
        onReady();
        // Fallback in case the restore promise never settles
        setTimeout(onRestored, 3000);
      },
      { once: true }
    );
    window.addEventListener("AfterWorkspacesSessionRestore", onReady, { once: true });
    try {
      const { SessionStore } = ChromeUtils.importESModule(
        "resource:///modules/sessionstore/SessionStore.sys.mjs"
      );
      SessionStore.promiseAllWindowsRestored?.then(onRestored);
    } catch (e) {}

    setInterval(() => this.#refreshLivePreviews(), LIVE_PREVIEW_INTERVAL_MS);
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
    shelf.setAttribute("role", "toolbar");
    shelf.setAttribute("aria-label", "Tiles");

    const track = document.createElement("div");
    track.id = "hifi-shelf-track";
    track.classList.add("hifi-shelf-track");
    shelf.appendChild(track);
    this.#trackElement = track;

    // The "New Tile" card always sits at the start of the track
    const newBtn = document.createElement("button");
    newBtn.id = "hifi-shelf-new-tile-btn";
    newBtn.classList.add("hifi-shelf-card", "hifi-shelf-new-tile-btn");
    newBtn.setAttribute("type", "button");
    newBtn.title = "Open New Tile";
    const plus = document.createElement("span");
    plus.classList.add("hifi-new-tile-plus");
    const label = document.createElement("span");
    label.classList.add("hifi-new-tile-text");
    label.textContent = "New Tile";
    newBtn.append(plus, label);
    newBtn.addEventListener("click", () => this.openNewTile());
    this.#attachTilt(newBtn);
    track.appendChild(newBtn);
    this.#newTileButton = newBtn;

    // Arrow keys move between cards, which is how a TV remote navigates
    track.addEventListener("keydown", event => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const items = [...track.children];
      const index = items.indexOf(document.activeElement);
      if (index < 0) return;
      const next = items[index + (event.key === "ArrowRight" ? 1 : -1)];
      if (next) {
        event.preventDefault();
        next.focus();
        next.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
      }
    });

    // A vertical mouse wheel scrolls the shelf sideways
    track.addEventListener(
      "wheel",
      event => {
        if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
          event.preventDefault();
          track.scrollBy({ left: event.deltaY, behavior: "smooth" });
        }
      },
      { passive: false }
    );

    parent.appendChild(shelf);
    this.#shelfElement = shelf;
  }

  // Tab events bubble to the window, so listening here works even before
  // gBrowser.tabContainer exists.
  #attachListeners() {
    window.addEventListener("TabOpen", event => this.#onTabOpen(event.target));
    window.addEventListener("TabClose", event => this.#onTabClose(event.target));
    window.addEventListener("TabSelect", event => this.#onTabSelect(event.target));
    window.addEventListener("TabAttrModified", event => this.#updateCardMetadata(event.target));
    for (const type of ["TabShow", "TabHide", "TabMove", "TabPinned", "TabUnpinned"]) {
      window.addEventListener(type, () => this.#scheduleSync());
    }
    window.addEventListener("ZenViewSplitter:SplitViewActivated", () => {
      // A split we didn't create (restored group, Zen's own split commands)
      // becomes the arrangement.
      if (!this.#arranging) {
        this.#adoptSplitterState();
      }
      this.#scheduleSync();
    });
    for (const type of ["ZenViewSplitter:SplitViewDeactivated", "ZenWorkspacesUIUpdate"]) {
      window.addEventListener(type, () => this.#scheduleSync());
    }
  }

  // ---------------------------------------------------------------------------
  // Tab lifecycle

  /**
   * Whether a tab should appear as a tile. Excludes Zen's internal empty tab,
   * glance popups, and tabs from other workspaces.
   */
  #isTileTab(tab) {
    return (
      !!tab &&
      tab.isConnected &&
      !tab.closing &&
      !tab.hidden &&
      !tab.hasAttribute("zen-empty-tab") &&
      !tab.hasAttribute("zen-glance-tab")
    );
  }

  #tileTabs() {
    return (window.gBrowser?.tabs || []).filter(t => this.#isTileTab(t));
  }

  #onTabOpen(tab) {
    this.#scheduleSync();
    if (!this.#ready || !Services.prefs.getBoolPref("hifi.tiles.auto-tile", true)) return;
    // Lazy tabs (session restore, undo close) wait on the shelf until picked
    if (tab.hasAttribute("pending") || !tab.linkedPanel) return;

    // Tabs opened elsewhere (links, shortcuts) join the arrangement too. Wait a
    // tick so we can tell whether Firefox selected it (foreground open).
    setTimeout(() => {
      if (!this.#isTileTab(tab) || this.#arrangement.includes(tab)) return;
      const focus = window.gBrowser.selectedTab === tab ? tab : null;
      this.#addToArrangement(tab, focus);
    }, 0);
  }

  #onTabClose(tab) {
    this.#closing = true;
    this.#removeCard(tab);

    // Let the splitter and tabbrowser finish removing the tab first
    setTimeout(() => {
      this.#closing = false;
      if (!this.#ready) return;
      const remaining = this.#arrangement.filter(t => t !== tab && this.#isTileTab(t));
      if (remaining.length) {
        const selected = window.gBrowser.selectedTab;
        this.#arrange(remaining, remaining.includes(selected) ? selected : remaining[0]);
        return;
      }
      // The arrangement emptied: show the most recently used tile, or start fresh
      const next = this.#mostRecent(this.#tileTabs());
      if (next) {
        this.#arrange([next], next);
      } else {
        this.openNewTile();
      }
    }, 0);
  }

  #onTabSelect(tab) {
    this.#scheduleSync();
    if (!this.#ready || this.#arranging || this.#closing || !this.#isTileTab(tab)) return;
    if (this.#arrangement.includes(tab)) return;

    // Selecting an off-screen tab (keyboard shortcut, link, extension) brings
    // it into the arrangement rather than silently leaving tiled mode.
    setTimeout(() => {
      if (window.gBrowser.selectedTab === tab && !this.#arrangement.includes(tab)) {
        this.#addToArrangement(tab, tab);
      }
    }, 0);
  }

  // ---------------------------------------------------------------------------
  // Arrangement

  #currentGroup() {
    const splitter = window.gZenViewSplitter;
    if (!splitter || splitter.currentView < 0) return null;
    return splitter._data[splitter.currentView] || null;
  }

  /** Reads whatever the splitter is showing (e.g. after session restore). */
  #adoptSplitterState() {
    if (!window.gBrowser) return;
    const group = this.#currentGroup();
    if (group) {
      this.#arrangement = group.tabs.filter(t => this.#isTileTab(t));
    } else if (!this.#arrangement.some(t => this.#isTileTab(t))) {
      const selected = window.gBrowser.selectedTab;
      this.#arrangement = this.#isTileTab(selected) ? [selected] : [];
    }
  }

  get capacity() {
    return LAYOUT_CAPACITY[this.currentLayout] ?? 4;
  }

  #gridTypeFor(count) {
    if (this.currentLayout === "auto") {
      return count <= 2 ? "vsep" : "grid";
    }
    return this.currentLayout === "single" ? "vsep" : this.currentLayout;
  }

  #mostRecent(tabs) {
    let best = null;
    for (const tab of tabs) {
      if (!best || (tab.lastAccessed || 0) > (best.lastAccessed || 0)) {
        best = tab;
      }
    }
    return best;
  }

  /**
   * Shows exactly `tabs` on screen, in order, with `focusTab` selected.
   * This is the only place that drives the splitter.
   */
  #arrange(tabs, focusTab = tabs[0]) {
    const splitter = window.gZenViewSplitter;
    if (!window.gBrowser) return;

    tabs = tabs
      .filter(t => this.#isTileTab(t))
      .filter((t, i, arr) => arr.indexOf(t) === i)
      .slice(0, splitter?.MAX_TABS ?? 4);
    if (!tabs.length) return;
    if (!tabs.includes(focusTab)) focusTab = tabs[0];

    for (const tab of tabs) {
      tab.removeAttribute("hifi-minimized");
    }

    const gridType = this.#gridTypeFor(tabs.length);
    const group = this.#currentGroup();
    const unchanged =
      tabs.length === 1
        ? !group
        : group &&
          group.gridType === gridType &&
          group.tabs.length === tabs.length &&
          tabs.every((t, i) => group.tabs[i] === t);

    this.#arranging = true;
    try {
      if (!unchanged && splitter) {
        // Rebuild from scratch: the splitter can add tiles to a group but
        // can't swap or remove them while changing the grid type.
        splitter.unsplitCurrentView();
        for (const tab of tabs) {
          if (tab.splitView) {
            splitter.removeTabFromGroup(tab, undefined, {
              forUnsplit: true,
              changeTab: false,
            });
          }
        }
        if (tabs.length >= 2) {
          splitter.splitTabs(tabs, gridType, tabs.indexOf(focusTab));
        }
      }
      if (window.gBrowser.selectedTab !== focusTab) {
        window.gBrowser.selectedTab = focusTab;
      }
    } catch (e) {
      console.error("HiFiTileShelf: arrange failed", e);
    } finally {
      this.#arranging = false;
    }

    // splitTabs may substitute tabs (e.g. duplicating pinned ones), so trust
    // what the splitter actually shows.
    const shown = this.#currentGroup();
    this.#arrangement = shown ? [...shown.tabs] : [window.gBrowser.selectedTab];
    this.#scheduleSync();
  }

  /**
   * Adds a tab to the arrangement. When the layout is full, it takes the slot
   * of the least recently used tile, which goes back to the shelf. Without a
   * focusTab (a background open) it only fills a free slot, so it never
   * replaces what the user is watching.
   */
  #addToArrangement(tab, focusTab = tab) {
    const current = this.#arrangement.filter(t => this.#isTileTab(t) && t !== tab);
    let next;
    if (current.length < this.capacity) {
      next = [...current, tab];
    } else if (!focusTab) {
      this.#scheduleSync();
      return;
    } else {
      const keep = focusTab !== tab ? focusTab : null;
      const candidates = current.filter(t => t !== keep);
      let stalest = candidates[0];
      for (const t of candidates) {
        if ((t.lastAccessed || 0) < (stalest.lastAccessed || 0)) stalest = t;
      }
      next = current.map(t => (t === stalest ? tab : t));
    }
    this.#arrange(next, focusTab || window.gBrowser.selectedTab);
  }

  /**
   * Brings a tile on screen and focuses it. Used by shelf cards and the dock.
   */
  bringTileIntoArrangement(tab) {
    if (!this.#isTileTab(tab)) return;
    if (this.#arrangement.includes(tab)) {
      window.gBrowser.selectedTab = tab;
      return;
    }
    this.#addToArrangement(tab, tab);
  }

  /**
   * Sets the layout: "auto" | "single" | "vsep" | "hsep" | "grid".
   * Fills empty slots with the most recently used tiles from the shelf.
   */
  setLayout(layoutType) {
    const layout = layoutType === "unsplit" ? "single" : layoutType;
    if (!LAYOUTS.includes(layout)) return;
    this.currentLayout = layout;
    Services.prefs.setStringPref(LAYOUT_PREF, layout);

    const selected = window.gBrowser.selectedTab;
    let tiles = this.#arrangement.filter(t => this.#isTileTab(t));
    if (this.#isTileTab(selected) && !tiles.includes(selected)) {
      tiles.unshift(selected);
    }

    if (tiles.length > this.capacity) {
      // Keep the focused tile, drop the rest from the end
      tiles = [selected, ...tiles.filter(t => t !== selected)].slice(0, this.capacity);
    } else if (layout !== "auto") {
      const spare = this.#tileTabs()
        .filter(t => !tiles.includes(t) && t.getAttribute("hifi-minimized") !== "true")
        .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
      tiles = tiles.concat(spare.slice(0, this.capacity - tiles.length));
    }

    this.#arrange(tiles, selected);
    window.dispatchEvent(new CustomEvent("HiFiTiles:LayoutChanged", { detail: { layout } }));
  }

  /** Closes a tile's tab. #onTabClose takes care of re-arranging. */
  closeTile(tab) {
    if (!tab || !window.gBrowser) return;
    try {
      window.gBrowser.removeTab(tab, { animate: false });
    } catch (e) {
      console.warn("HiFiTileShelf: could not remove tab", e);
    }
  }

  /** Sends a tile back to the shelf without closing it. */
  minimizeTile(tab) {
    if (!tab) return;
    const remaining = this.#arrangement.filter(t => t !== tab && this.#isTileTab(t));
    if (!remaining.length) {
      // Nothing else on screen: swap in the most recent other tile, if any
      const other = this.#mostRecent(this.#tileTabs().filter(t => t !== tab));
      if (!other) return;
      remaining.push(other);
    }
    tab.setAttribute("hifi-minimized", "true");
    const selected = window.gBrowser.selectedTab;
    this.#arrange(remaining, remaining.includes(selected) ? selected : remaining[0]);
    // #arrange clears the flag on arranged tabs only, so set it again in case
    tab.setAttribute("hifi-minimized", "true");
    this.#scheduleSync();
  }

  /** Opens a new tab and places it into the arrangement as a tile. */
  openNewTile(url = "about:newtab") {
    if (!window.gBrowser) return null;
    try {
      // Open in the background so the old arrangement is still intact when
      // we add the new tile to it.
      const tab = window.gBrowser.addTrustedTab(url, { inBackground: true });
      this.#addToArrangement(tab, tab);
      return tab;
    } catch (e) {
      console.warn("HiFiTileShelf: openNewTile failed", e);
      return null;
    }
  }

  /** Tabs currently on screen. */
  getActiveSplitTabs() {
    return this.#arrangement.filter(t => this.#isTileTab(t));
  }

  // ---------------------------------------------------------------------------
  // Shelf cards

  #scheduleSync() {
    if (this.#syncQueued) return;
    this.#syncQueued = true;
    requestAnimationFrame(() => {
      this.#syncQueued = false;
      this.#sync();
    });
  }

  /**
   * Reconciles cards with tile tabs. Existing cards keep their position (the
   * splitter regroups tabs in the strip, which would otherwise shuffle the
   * shelf); new tiles are appended at the end.
   */
  #sync() {
    if (!this.#trackElement || !window.gBrowser) return;
    const tabs = this.#tileTabs();

    for (const tab of tabs) {
      if (!this.#tabToCard.has(tab)) {
        this.#trackElement.appendChild(this.#createCard(tab));
      }
    }

    const live = new Set(tabs.map(t => this.#tabToCard.get(t)));
    for (const card of [...this.#trackElement.querySelectorAll(".hifi-shelf-tab-card")]) {
      if (!live.has(card)) card.remove();
    }

    this.updateCardStates();
  }

  #removeCard(tab) {
    this.#tabToCard.get(tab)?.remove();
    this.#tabToCard.delete(tab);
    const snapUrl = this.#tabToSnapshotUrl.get(tab);
    if (snapUrl) {
      URL.revokeObjectURL(snapUrl);
      this.#tabToSnapshotUrl.delete(tab);
    }
  }

  #createCard(tab) {
    const card = document.createElement("div");
    card.classList.add("hifi-shelf-card", "hifi-shelf-tab-card");
    card.setAttribute("tabindex", "0");
    card.setAttribute("role", "button");

    const thumbContainer = document.createElement("div");
    thumbContainer.classList.add("hifi-shelf-card-thumb-container");

    const thumbImg = document.createElement("img");
    thumbImg.classList.add("hifi-shelf-card-thumb");
    thumbImg.alt = "";
    thumbImg.hidden = true;
    thumbContainer.appendChild(thumbImg);

    // Shown until a snapshot is captured
    const fallback = document.createElement("div");
    fallback.classList.add("hifi-shelf-card-fallback");
    const fallbackIcon = document.createElement("img");
    fallbackIcon.classList.add("hifi-shelf-fallback-icon");
    fallbackIcon.alt = "";
    const fallbackDomain = document.createElement("span");
    fallbackDomain.classList.add("hifi-shelf-fallback-domain");
    fallback.append(fallbackIcon, fallbackDomain);
    thumbContainer.appendChild(fallback);

    // Pointer-following highlight for the 3D hover effect
    const glare = document.createElement("div");
    glare.classList.add("hifi-shelf-card-glare");
    thumbContainer.appendChild(glare);

    const status = document.createElement("div");
    status.classList.add("hifi-shelf-card-status");
    const onScreen = document.createElement("span");
    onScreen.classList.add("hifi-shelf-onscreen-dot");
    onScreen.title = "On screen";
    const audio = document.createElement("span");
    audio.classList.add("hifi-shelf-audio");
    for (let i = 0; i < 3; i++) {
      audio.appendChild(document.createElement("i"));
    }
    status.append(onScreen, audio);
    thumbContainer.appendChild(status);

    card.appendChild(thumbContainer);

    const closeBtn = document.createElement("button");
    closeBtn.classList.add("hifi-shelf-card-close");
    closeBtn.setAttribute("type", "button");
    closeBtn.setAttribute("tabindex", "-1");
    closeBtn.title = "Close Tile";
    closeBtn.addEventListener("click", e => {
      e.stopPropagation();
      this.closeTile(tab);
    });
    card.appendChild(closeBtn);

    const footer = document.createElement("div");
    footer.classList.add("hifi-shelf-card-footer");
    const icon = document.createElement("img");
    icon.classList.add("hifi-shelf-card-icon");
    icon.alt = "";
    const title = document.createElement("span");
    title.classList.add("hifi-shelf-card-title");
    footer.append(icon, title);
    card.appendChild(footer);

    card.addEventListener("click", () => this.bringTileIntoArrangement(tab));
    card.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        this.bringTileIntoArrangement(tab);
      } else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        this.closeTile(tab);
      }
    });
    this.#attachTilt(card);

    this.#tabToCard.set(tab, card);
    this.#fillCardMetadata(tab, card);

    const snap = this.#tabToSnapshotUrl.get(tab);
    if (snap) {
      this.#showSnapshot(card, snap);
    }
    if (tab.linkedBrowser) {
      setTimeout(() => this.captureSnapshot(tab), 500);
    }
    return card;
  }

  /**
   * Apple TV-style parallax: the card tilts toward the pointer and a soft
   * highlight follows it. Keyboard focus gets the same lift without the tilt.
   */
  #attachTilt(card) {
    card.addEventListener("pointermove", event => {
      const rect = card.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width;
      const y = (event.clientY - rect.top) / rect.height;
      card.style.setProperty("--hifi-tilt-x", `${(0.5 - y) * 14}deg`);
      card.style.setProperty("--hifi-tilt-y", `${(x - 0.5) * 18}deg`);
      card.style.setProperty("--hifi-glare-x", `${x * 100}%`);
      card.style.setProperty("--hifi-glare-y", `${y * 100}%`);
    });
    card.addEventListener("pointerleave", () => {
      for (const prop of ["--hifi-tilt-x", "--hifi-tilt-y", "--hifi-glare-x", "--hifi-glare-y"]) {
        card.style.removeProperty(prop);
      }
    });
  }

  #fillCardMetadata(tab, card) {
    const label = tab.label || "New Tile";
    const fav = tab.getAttribute("image") || DEFAULT_FAVICON;

    const title = card.querySelector(".hifi-shelf-card-title");
    title.textContent = label;
    card.title = label;
    card.setAttribute("aria-label", label);

    for (const img of card.querySelectorAll(".hifi-shelf-card-icon, .hifi-shelf-fallback-icon")) {
      if (img.getAttribute("src") !== fav) img.src = fav;
    }
    card.querySelector(".hifi-shelf-fallback-domain").textContent =
      this.#getDomainFromTab(tab);
  }

  #updateCardMetadata(tab) {
    const card = this.#tabToCard.get(tab);
    if (!card) {
      this.#scheduleSync();
      return;
    }
    this.#fillCardMetadata(tab, card);
    this.#scheduleSync();
  }

  #getDomainFromTab(tab) {
    try {
      const uri = tab.linkedBrowser?.currentURI;
      if (uri?.host) return uri.host.replace(/^www\./, "");
    } catch (e) {}
    return tab.label || "New Tile";
  }

  updateCardStates() {
    if (!window.gBrowser) return;
    const selectedTab = window.gBrowser.selectedTab;
    const onScreen = new Set(this.getActiveSplitTabs());

    for (const tab of this.#tileTabs()) {
      const card = this.#tabToCard.get(tab);
      if (!card) continue;

      const isSelected = tab === selectedTab;
      card.classList.toggle("is-selected", isSelected);
      card.classList.toggle("is-active-tile", onScreen.has(tab));
      card.classList.toggle("is-minimized", tab.getAttribute("hifi-minimized") === "true");
      card.classList.toggle("sound-playing", !!tab.soundPlaying && !tab.muted);
      card.classList.toggle("is-muted", !!tab.muted);
      card.setAttribute("aria-pressed", isSelected ? "true" : "false");

      if (isSelected && tab !== this.#lastSelected) {
        card.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
      }
    }
    this.#lastSelected = selectedTab;
  }

  // ---------------------------------------------------------------------------
  // Previews

  #showSnapshot(card, url) {
    const thumbImg = card.querySelector(".hifi-shelf-card-thumb");
    thumbImg.src = url;
    thumbImg.hidden = false;
    card.classList.add("has-snapshot");
  }

  #refreshLivePreviews() {
    if (document.hidden || document.documentElement.hasAttribute("inDOMFullscreen")) {
      return;
    }
    for (const tab of this.getActiveSplitTabs()) {
      this.captureSnapshot(tab);
    }
  }

  /** Captures a static snapshot of the page for the card preview. */
  async captureSnapshot(tab) {
    if (!this.#isTileTab(tab) || this.#capturingTabs.has(tab)) return;
    const browser = tab.linkedBrowser;
    if (!browser || tab.hasAttribute("pending")) return;

    this.#capturingTabs.add(tab);
    try {
      // Aim for ~480px wide previews regardless of tile size
      const width = browser.getBoundingClientRect().width;
      const scale = width > 0 ? Math.min(0.3, 480 / width) : 0.3;
      let image = null;
      if (typeof browser.drawSnapshot === "function") {
        image = await browser.drawSnapshot(0, 0, 0, 0, scale, "black", true);
      }
      if (!image && browser.browsingContext?.currentWindowGlobal?.drawSnapshot) {
        image = await browser.browsingContext.currentWindowGlobal.drawSnapshot(
          null,
          scale,
          "black"
        );
      }
      if (!image || !this.#isTileTab(tab)) return;

      const canvas = new OffscreenCanvas(image.width, image.height);
      canvas.getContext("2d").drawImage(image, 0, 0);
      image.close();
      const blob = await canvas.convertToBlob({ type: "image/webp", quality: 0.82 });

      const oldUrl = this.#tabToSnapshotUrl.get(tab);
      const newUrl = URL.createObjectURL(blob);
      this.#tabToSnapshotUrl.set(tab, newUrl);
      const card = this.#tabToCard.get(tab);
      if (card) {
        this.#showSnapshot(card, newUrl);
      }
      if (oldUrl) {
        URL.revokeObjectURL(oldUrl);
      }
    } catch (e) {
      // Keep the fallback preview
    } finally {
      this.#capturingTabs.delete(tab);
    }
  }
}

window.gHiFiTileShelf = new HiFiTileShelf();
