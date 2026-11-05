// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { nsZenDOMOperatedFeature } from "chrome://browser/content/zen-components/ZenCommonUtils.mjs";

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Builds a small diagram of a tile layout from rects given in a 20x14 box.
 */
function layoutGlyph(rects) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 20 14");
  svg.setAttribute("width", "26");
  svg.setAttribute("height", "18");
  for (const [x, y, w, h] of rects) {
    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("x", x);
    rect.setAttribute("y", y);
    rect.setAttribute("width", w);
    rect.setAttribute("height", h);
    rect.setAttribute("rx", "1.5");
    svg.appendChild(rect);
  }
  return svg;
}

/**
 * Host without "www.", used to tell whether a bookmark is open: bookmarks
 * rarely match the tab's final URL exactly after redirects.
 */
function siteOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch (e) {
    return "";
  }
}

/**
 * HiFi Bookmark Dock & Layout Selector
 * A launcher-style dock on the left with bookmarks, running indicators and
 * the tile layout picker.
 */
class HiFiBookmarkDock extends nsZenDOMOperatedFeature {
  #dockElement = null;
  #itemsContainer = null;
  #layoutDropdown = null;
  #layoutButton = null;
  #pipsQueued = false;

  static LAYOUTS = [
    { id: "auto", name: "Auto", hint: "Grows as you open tiles", rects: [[0, 0, 9.5, 14], [10.5, 0, 9.5, 6.5], [10.5, 7.5, 9.5, 6.5]] },
    { id: "single", name: "Single", hint: "One tile, full screen", rects: [[0, 0, 20, 14]] },
    { id: "vsep", name: "Side by side", hint: "Columns", rects: [[0, 0, 9.5, 14], [10.5, 0, 9.5, 14]] },
    { id: "hsep", name: "Stacked", hint: "Rows", rects: [[0, 0, 20, 6.5], [0, 7.5, 20, 6.5]] },
    { id: "grid", name: "Grid", hint: "Up to four tiles", rects: [[0, 0, 9.5, 6.5], [10.5, 0, 9.5, 6.5], [0, 7.5, 9.5, 6.5], [10.5, 7.5, 9.5, 6.5]] },
  ];

  async init() {
    this.#createDockDOM();
    this.#attachListeners();
    await this.#loadBookmarks();
  }

  #createDockDOM() {
    const browserBox = document.getElementById("browser");
    if (!browserBox) return;

    document.getElementById("hifi-ubuntu-dock")?.remove();

    const dock = document.createElement("div");
    dock.id = "hifi-ubuntu-dock";
    dock.classList.add("hifi-ubuntu-dock");
    dock.setAttribute("role", "toolbar");
    dock.setAttribute("aria-orientation", "vertical");
    dock.setAttribute("aria-label", "Launcher");

    // Home: opens a new tile
    const topSection = document.createElement("div");
    topSection.classList.add("hifi-dock-top");
    const homeBtn = document.createElement("button");
    homeBtn.classList.add("hifi-dock-item", "hifi-dock-logo-btn");
    homeBtn.title = "New Tile";
    homeBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
        <rect x="3" y="3" width="8" height="8" rx="2.2"/>
        <rect x="13" y="3" width="8" height="8" rx="2.2" opacity=".55"/>
        <rect x="3" y="13" width="8" height="8" rx="2.2" opacity=".55"/>
        <rect x="13" y="13" width="8" height="8" rx="2.2" opacity=".3"/>
      </svg>
    `;
    homeBtn.addEventListener("click", () => this.#openURLInNewTile("about:newtab"));
    topSection.appendChild(homeBtn);
    dock.appendChild(topSection);

    const itemsContainer = document.createElement("div");
    itemsContainer.id = "hifi-dock-items";
    itemsContainer.classList.add("hifi-dock-items");
    dock.appendChild(itemsContainer);
    this.#itemsContainer = itemsContainer;

    const bottomSection = document.createElement("div");
    bottomSection.classList.add("hifi-dock-bottom");

    const layoutBtn = document.createElement("button");
    layoutBtn.id = "hifi-dock-layout-btn";
    layoutBtn.classList.add("hifi-dock-item", "hifi-dock-btn");
    layoutBtn.title = "Tile Layout";
    layoutBtn.setAttribute("aria-haspopup", "menu");
    layoutBtn.addEventListener("click", event => {
      event.stopPropagation();
      this.#toggleLayoutDropdown();
    });
    bottomSection.appendChild(layoutBtn);
    this.#layoutButton = layoutBtn;

    const addBtn = document.createElement("button");
    addBtn.classList.add("hifi-dock-item", "hifi-dock-btn");
    addBtn.title = "Bookmark Current Tile";
    addBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
        <path d="M8 2a.75.75 0 0 1 .75.75v4.5h4.5a.75.75 0 0 1 0 1.5h-4.5v4.5a.75.75 0 0 1-1.5 0v-4.5h-4.5a.75.75 0 0 1 0-1.5h4.5v-4.5A.75.75 0 0 1 8 2z"/>
      </svg>
    `;
    addBtn.addEventListener("click", () => this.#addCurrentPageBookmark());
    bottomSection.appendChild(addBtn);

    dock.appendChild(bottomSection);

    // Up/down arrows move between dock items (TV remote navigation)
    dock.addEventListener("keydown", event => {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      const items = [...dock.querySelectorAll(".hifi-dock-item")];
      const index = items.indexOf(document.activeElement);
      if (index < 0) return;
      const next = items[index + (event.key === "ArrowDown" ? 1 : -1)];
      if (next) {
        event.preventDefault();
        next.focus();
      }
    });

    browserBox.insertBefore(dock, browserBox.firstChild);
    this.#dockElement = dock;

    this.#createLayoutDropdownDOM();
    this.#updateLayoutButton();
  }

  #currentLayout() {
    return window.gHiFiTileShelf?.currentLayout ?? "auto";
  }

  #updateLayoutButton() {
    const layout =
      HiFiBookmarkDock.LAYOUTS.find(l => l.id === this.#currentLayout()) ??
      HiFiBookmarkDock.LAYOUTS[0];
    this.#layoutButton.replaceChildren(layoutGlyph(layout.rects));
    this.#layoutButton.title = `Tile Layout: ${layout.name}`;
    for (const opt of this.#layoutDropdown?.querySelectorAll(".hifi-layout-option") ?? []) {
      const active = opt.dataset.layout === layout.id;
      opt.classList.toggle("is-active", active);
      opt.setAttribute("aria-checked", active ? "true" : "false");
    }
  }

  #createLayoutDropdownDOM() {
    document.getElementById("hifi-layout-dropdown")?.remove();

    const dropdown = document.createElement("div");
    dropdown.id = "hifi-layout-dropdown";
    dropdown.classList.add("hifi-layout-dropdown");
    dropdown.setAttribute("role", "menu");
    dropdown.hidden = true;

    const header = document.createElement("div");
    header.classList.add("hifi-layout-dropdown-header");
    header.textContent = "Tile Layout";
    dropdown.appendChild(header);

    for (const layout of HiFiBookmarkDock.LAYOUTS) {
      const opt = document.createElement("button");
      opt.setAttribute("type", "button");
      opt.setAttribute("role", "menuitemradio");
      opt.classList.add("hifi-layout-option");
      opt.dataset.layout = layout.id;

      const icon = document.createElement("span");
      icon.classList.add("hifi-layout-icon");
      icon.appendChild(layoutGlyph(layout.rects));

      const text = document.createElement("span");
      text.classList.add("hifi-layout-text");
      const name = document.createElement("span");
      name.classList.add("hifi-layout-label");
      name.textContent = layout.name;
      const hint = document.createElement("span");
      hint.classList.add("hifi-layout-hint");
      hint.textContent = layout.hint;
      text.append(name, hint);

      opt.append(icon, text);
      opt.addEventListener("click", () => {
        this.#applyLayout(layout.id);
        this.#closeLayoutDropdown();
      });
      dropdown.appendChild(opt);
    }

    dropdown.addEventListener("keydown", event => {
      const options = [...dropdown.querySelectorAll(".hifi-layout-option")];
      const index = options.indexOf(document.activeElement);
      if (event.key === "Escape") {
        event.preventDefault();
        this.#closeLayoutDropdown();
        this.#layoutButton.focus();
      } else if ((event.key === "ArrowDown" || event.key === "ArrowUp") && index >= 0) {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        options[(index + step + options.length) % options.length].focus();
      }
    });

    (document.body || document.documentElement).appendChild(dropdown);
    this.#layoutDropdown = dropdown;

    document.addEventListener("click", event => {
      if (!dropdown.hidden && !dropdown.contains(event.target)) {
        this.#closeLayoutDropdown();
      }
    });
  }

  #closeLayoutDropdown() {
    this.#layoutDropdown.hidden = true;
    this.#layoutButton.removeAttribute("open");
  }

  #toggleLayoutDropdown() {
    const dropdown = this.#layoutDropdown;
    if (!dropdown) return;
    if (!dropdown.hidden) {
      this.#closeLayoutDropdown();
      return;
    }
    this.#updateLayoutButton();
    const rect = this.#layoutButton.getBoundingClientRect();
    dropdown.style.left = `${rect.right + 12}px`;
    dropdown.style.bottom = `${window.innerHeight - rect.bottom}px`;
    dropdown.hidden = false;
    this.#layoutButton.setAttribute("open", "true");
    dropdown.querySelector(".hifi-layout-option.is-active")?.focus();
  }

  #applyLayout(layoutId) {
    if (window.gHiFiTileShelf) {
      window.gHiFiTileShelf.setLayout(layoutId);
    } else if (window.gZenViewSplitter) {
      if (layoutId === "single" || layoutId === "unsplit") {
        window.gZenViewSplitter.unsplitCurrentView();
      } else {
        const visibleTabs = window.gBrowser?.visibleTabs.filter(t => !t.hidden) || [];
        if (visibleTabs.length >= 2) {
          window.gZenViewSplitter.splitTabs(visibleTabs.slice(0, 4), layoutId === "auto" ? "grid" : layoutId);
        }
      }
    }
    this.#updateLayoutButton();
  }

  async #loadBookmarks() {
    if (!this.#itemsContainer) return;

    let bookmarks = [];
    try {
      const { PlacesUtils } = ChromeUtils.importESModule(
        "resource://gre/modules/PlacesUtils.sys.mjs"
      );

      const collect = async (folderGuid, limit) => {
        const tree = await PlacesUtils.promiseBookmarksTree(folderGuid);
        for (const node of tree?.children ?? []) {
          if (bookmarks.length >= limit) break;
          if (node.uri && /^https?:/.test(node.uri)) {
            bookmarks.push({ title: node.title || node.uri, url: node.uri });
          }
        }
      };

      await collect(PlacesUtils.bookmarks.toolbarGuid, 15);
      if (bookmarks.length < 6) {
        await collect(PlacesUtils.bookmarks.unfiledGuid, 15);
      }
    } catch (e) {
      console.warn("HiFiBookmarkDock: Error loading Places bookmarks", e);
    }

    if (bookmarks.length === 0) {
      bookmarks = [
        { title: "YouTube", url: "https://www.youtube.com/" },
        { title: "Twitch", url: "https://www.twitch.tv/" },
        { title: "itch.io", url: "https://itch.io/" },
        { title: "Wikipedia", url: "https://www.wikipedia.org/" },
      ];
    }

    this.#itemsContainer.replaceChildren();
    for (const bm of bookmarks) {
      this.#createBookmarkItem(bm);
    }
    this.#updateActivePips();
  }

  #createBookmarkItem(bookmark) {
    const item = document.createElement("button");
    item.classList.add("hifi-dock-item", "hifi-dock-bookmark");
    item.title = bookmark.title;
    item.dataset.url = bookmark.url;
    item.dataset.site = siteOf(bookmark.url);

    const pip = document.createElement("div");
    pip.classList.add("hifi-dock-pip");
    item.appendChild(pip);

    // Monogram underneath the favicon, visible if no icon is cached yet
    const monogram = document.createElement("span");
    monogram.classList.add("hifi-dock-monogram");
    monogram.textContent = (bookmark.title || item.dataset.site || "?").trim().charAt(0).toUpperCase();
    item.appendChild(monogram);

    // page-icon: serves the favicon Firefox already has cached for the page,
    // without contacting any third-party service.
    const icon = document.createElement("img");
    icon.classList.add("hifi-dock-icon");
    icon.alt = "";
    icon.addEventListener("load", () => item.classList.add("has-icon"));
    icon.addEventListener("error", () => icon.remove());
    icon.src = `page-icon:${bookmark.url}`;
    item.appendChild(icon);

    item.addEventListener("click", () => this.#onBookmarkClick(bookmark.url));

    this.#itemsContainer.appendChild(item);
  }

  #findTabForURL(url) {
    const site = siteOf(url);
    const tabs = (window.gBrowser?.tabs || []).filter(
      t => !t.hidden && !t.closing && !t.hasAttribute("zen-empty-tab")
    );
    let siteMatch = null;
    for (const tab of tabs) {
      const spec = tab.linkedBrowser?.currentURI?.spec;
      if (!spec) continue;
      if (spec === url) return tab;
      if (site && !siteMatch && siteOf(spec) === site) siteMatch = tab;
    }
    return siteMatch;
  }

  #onBookmarkClick(url) {
    const existingTab = this.#findTabForURL(url);
    if (existingTab) {
      if (window.gHiFiTileShelf) {
        window.gHiFiTileShelf.bringTileIntoArrangement(existingTab);
      } else {
        window.gBrowser.selectedTab = existingTab;
      }
    } else {
      this.#openURLInNewTile(url);
    }
  }

  #openURLInNewTile(url) {
    if (window.gHiFiTileShelf) {
      window.gHiFiTileShelf.openNewTile(url);
    } else if (window.gBrowser) {
      try {
        window.gBrowser.selectedTab = window.gBrowser.addTrustedTab(url, {
          inBackground: false,
        });
      } catch (e) {
        console.warn("HiFiBookmarkDock open error", e);
      }
    }
  }

  async #addCurrentPageBookmark() {
    try {
      const currentTab = window.gBrowser?.selectedTab;
      const uri = currentTab?.linkedBrowser?.currentURI;
      if (!uri || !/^https?$/.test(uri.scheme)) return;

      const { PlacesUtils } = ChromeUtils.importESModule(
        "resource://gre/modules/PlacesUtils.sys.mjs"
      );
      await PlacesUtils.bookmarks.insert({
        parentGuid: PlacesUtils.bookmarks.toolbarGuid,
        url: uri.spec,
        title: currentTab.label || uri.spec,
      });
      await this.#loadBookmarks();
    } catch (e) {
      console.warn("Could not insert bookmark", e);
    }
  }

  // Tab events bubble to the window, so this works before gBrowser exists.
  #attachListeners() {
    for (const type of ["TabOpen", "TabClose", "TabSelect", "TabAttrModified", "TabShow", "TabHide"]) {
      window.addEventListener(type, () => this.#schedulePips());
    }
    window.addEventListener("HiFiTiles:LayoutChanged", () => this.#updateLayoutButton());
  }

  #schedulePips() {
    if (this.#pipsQueued) return;
    this.#pipsQueued = true;
    requestAnimationFrame(() => {
      this.#pipsQueued = false;
      this.#updateActivePips();
    });
  }

  #updateActivePips() {
    if (!this.#itemsContainer || !window.gBrowser) return;
    const openSites = new Map();
    const selected = window.gBrowser.selectedTab;
    let selectedSite = "";
    for (const tab of window.gBrowser.tabs) {
      if (tab.hidden || tab.closing || tab.hasAttribute("zen-empty-tab")) continue;
      const site = siteOf(tab.linkedBrowser?.currentURI?.spec ?? "");
      if (!site) continue;
      openSites.set(site, (openSites.get(site) || 0) + 1);
      if (tab === selected) selectedSite = site;
    }

    for (const btn of this.#itemsContainer.querySelectorAll(".hifi-dock-bookmark")) {
      const count = openSites.get(btn.dataset.site) || 0;
      btn.classList.toggle("is-open", count > 0);
      btn.classList.toggle("is-multi", count > 1);
      btn.classList.toggle("is-focused", btn.dataset.site === selectedSite);
    }
  }
}

window.gHiFiBookmarkDock = new HiFiBookmarkDock();
