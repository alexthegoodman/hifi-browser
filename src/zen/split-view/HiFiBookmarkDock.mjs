// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { nsZenDOMOperatedFeature } from "chrome://browser/content/zen-components/ZenCommonUtils.mjs";

/**
 * HiFi Ubuntu-Style Bookmark Dock & Layout Selector
 * Replaces the traditional tab sidebar with a sleek 52px left-hand launcher dock
 * containing bookmarks, running indicator pips, and layout arrangement controls.
 */
class HiFiBookmarkDock extends nsZenDOMOperatedFeature {
  #dockElement = null;
  #itemsContainer = null;
  #layoutDropdown = null;

  static LAYOUTS = [
    { id: "unsplit", name: "Single Tile", icon: "◻️", gridType: "unsplit" },
    { id: "vsep", name: "2 Columns (Side-by-Side)", icon: "◫", gridType: "vsep" },
    { id: "hsep", name: "2 Rows (Stacked)", icon: "⬒", gridType: "hsep" },
    { id: "grid", name: "2 × 2 Grid (Quad)", icon: "⊞", gridType: "grid" }
  ];

  async init() {
    this.#createDockDOM();
    await this.#loadBookmarks();
    this.#attachTabListeners();
  }

  #createDockDOM() {
    const browserBox = document.getElementById("browser");
    if (!browserBox) return;

    // Remove old dock if exists
    document.getElementById("hifi-ubuntu-dock")?.remove();

    const dock = document.createElement("div");
    dock.id = "hifi-ubuntu-dock";
    dock.classList.add("hifi-ubuntu-dock");

    // 1. Top Logo Launcher (Ubuntu / HiFi)
    const topSection = document.createElement("div");
    topSection.classList.add("hifi-dock-top");

    const homeBtn = document.createElement("button");
    homeBtn.classList.add("hifi-dock-item", "hifi-dock-logo-btn");
    homeBtn.title = "HiFi Browser";
    homeBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
        <circle cx="12" cy="12" r="10" fill="#e95420"/>
        <circle cx="12" cy="7" r="2.2" fill="#ffffff"/>
        <circle cx="7.5" cy="14.5" r="2.2" fill="#ffffff"/>
        <circle cx="16.5" cy="14.5" r="2.2" fill="#ffffff"/>
      </svg>
    `;
    homeBtn.addEventListener("click", () => {
      this.#openURLInNewTile("about:newtab");
    });
    topSection.appendChild(homeBtn);
    dock.appendChild(topSection);

    // 2. Middle Scrollable Bookmarks Stack
    const itemsContainer = document.createElement("div");
    itemsContainer.id = "hifi-dock-items";
    itemsContainer.classList.add("hifi-dock-items");
    dock.appendChild(itemsContainer);
    this.#itemsContainer = itemsContainer;

    // 3. Bottom Controls (Layout Selector Dropdown & Add Bookmark)
    const bottomSection = document.createElement("div");
    bottomSection.classList.add("hifi-dock-bottom");

    // Layout Selector Button
    const layoutBtn = document.createElement("button");
    layoutBtn.id = "hifi-dock-layout-btn";
    layoutBtn.classList.add("hifi-dock-item", "hifi-dock-btn");
    layoutBtn.title = "Tile Layout Arrangements";
    layoutBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="18" height="18" fill="currentColor">
        <rect x="2" y="2" width="5.5" height="5.5" rx="1"/>
        <rect x="8.5" y="2" width="5.5" height="5.5" rx="1"/>
        <rect x="2" y="8.5" width="5.5" height="5.5" rx="1"/>
        <rect x="8.5" y="8.5" width="5.5" height="5.5" rx="1"/>
      </svg>
    `;
    layoutBtn.addEventListener("click", event => {
      event.stopPropagation();
      this.#toggleLayoutDropdown(layoutBtn);
    });
    bottomSection.appendChild(layoutBtn);

    // Add Bookmark Button
    const addBtn = document.createElement("button");
    addBtn.classList.add("hifi-dock-item", "hifi-dock-btn");
    addBtn.title = "Bookmark Current Page";
    addBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
        <path d="M8 2a.75.75 0 0 1 .75.75v4.5h4.5a.75.75 0 0 1 0 1.5h-4.5v4.5a.75.75 0 0 1-1.5 0v-4.5h-4.5a.75.75 0 0 1 0-1.5h4.5v-4.5A.75.75 0 0 1 8 2z"/>
      </svg>
    `;
    addBtn.addEventListener("click", () => {
      this.#addCurrentPageBookmark();
    });
    bottomSection.appendChild(addBtn);

    dock.appendChild(bottomSection);

    // Prepend to browserBox so it is on the far left
    browserBox.insertBefore(dock, browserBox.firstChild);
    this.#dockElement = dock;

    // Create the Layout Dropdown element (hidden by default)
    this.#createLayoutDropdownDOM();
  }

  #createLayoutDropdownDOM() {
    document.getElementById("hifi-layout-dropdown")?.remove();

    const dropdown = document.createElement("div");
    dropdown.id = "hifi-layout-dropdown";
    dropdown.classList.add("hifi-layout-dropdown");
    dropdown.style.display = "none";

    const header = document.createElement("div");
    header.classList.add("hifi-layout-dropdown-header");
    header.textContent = "Tile Arrangements";
    dropdown.appendChild(header);

    for (const layout of HiFiBookmarkDock.LAYOUTS) {
      const opt = document.createElement("div");
      opt.classList.add("hifi-layout-option");
      opt.dataset.layout = layout.gridType;

      const icon = document.createElement("span");
      icon.classList.add("hifi-layout-icon");
      icon.textContent = layout.icon;
      opt.appendChild(icon);

      const label = document.createElement("span");
      label.classList.add("hifi-layout-label");
      label.textContent = layout.name;
      opt.appendChild(label);

      opt.addEventListener("click", () => {
        this.#applyLayout(layout.gridType);
        dropdown.style.display = "none";
      });

      dropdown.appendChild(opt);
    }

    (document.body || document.documentElement).appendChild(dropdown);
    this.#layoutDropdown = dropdown;

    document.addEventListener("click", event => {
      if (!this.#layoutDropdown.contains(event.target) && event.target.id !== "hifi-dock-layout-btn") {
        this.#layoutDropdown.style.display = "none";
      }
    });
  }

  #toggleLayoutDropdown(anchorBtn) {
    if (!this.#layoutDropdown) return;
    const isVisible = this.#layoutDropdown.style.display !== "none";
    if (isVisible) {
      this.#layoutDropdown.style.display = "none";
      return;
    }

    const rect = anchorBtn.getBoundingClientRect();
    this.#layoutDropdown.style.left = `${rect.right + 8}px`;
    this.#layoutDropdown.style.bottom = `${window.innerHeight - rect.bottom}px`;
    this.#layoutDropdown.style.display = "flex";
  }

  #applyLayout(gridType) {
    if (!window.gZenViewSplitter || !window.gBrowser) return;

    if (gridType === "unsplit") {
      window.gZenViewSplitter.unsplitCurrentView();
      return;
    }

    const visibleTabs = window.gBrowser.visibleTabs.filter(
      t => !t.hidden && !t.getAttribute("hifi-minimized")
    );

    if (visibleTabs.length >= 2) {
      window.gZenViewSplitter.splitTabs(visibleTabs.slice(0, 4), gridType);
    }
  }

  async #loadBookmarks() {
    if (!this.#itemsContainer) return;
    this.#itemsContainer.innerHTML = "";

    let bookmarks = [];
    try {
      const { PlacesUtils } = ChromeUtils.importESModule(
        "resource://gre/modules/PlacesUtils.sys.mjs"
      );

      // Fetch from Toolbar Bookmarks
      await PlacesUtils.bookmarks.fetch(
        { parentGuid: PlacesUtils.bookmarks.toolbarGuid },
        bm => {
          if (bm.url && !bm.url.startsWith("place:")) {
            bookmarks.push({ title: bm.title || bm.url, url: bm.url });
          }
        }
      );

      // Fetch from Unfiled Bookmarks if list is small
      if (bookmarks.length < 6) {
        await PlacesUtils.bookmarks.fetch(
          { parentGuid: PlacesUtils.bookmarks.unfiledGuid },
          bm => {
            if (bm.url && !bm.url.startsWith("place:") && bookmarks.length < 15) {
              bookmarks.push({ title: bm.title || bm.url, url: bm.url });
            }
          }
        );
      }
    } catch (e) {
      console.warn("HiFiBookmarkDock: Error loading Places bookmarks", e);
    }

    // Default favorites if no bookmarks exist yet
    if (bookmarks.length === 0) {
      bookmarks = [
        { title: "GitHub", url: "https://github.com" },
        { title: "YouTube", url: "https://youtube.com" },
        { title: "Wikipedia", url: "https://wikipedia.org" },
        { title: "Reddit", url: "https://reddit.com" },
        { title: "Hacker News", url: "https://news.ycombinator.com" }
      ];
    }

    for (const bm of bookmarks) {
      this.#createBookmarkItem(bm);
    }

    this.#updateActivePips();
  }

  #createBookmarkItem(bookmark) {
    const item = document.createElement("button");
    item.classList.add("hifi-dock-item", "hifi-dock-bookmark");
    item.title = `${bookmark.title}\n${bookmark.url}`;
    item.dataset.url = bookmark.url;

    // Running Pip Indicator (Ubuntu Orange Pip)
    const pip = document.createElement("div");
    pip.classList.add("hifi-dock-pip");
    item.appendChild(pip);

    // Favicon Image
    const icon = document.createElement("img");
    icon.classList.add("hifi-dock-icon");
    icon.alt = bookmark.title;
    try {
      const domain = new URL(bookmark.url).hostname;
      icon.src = `https://icons.duckduckgo.com/ip3/${domain}.ico`;
    } catch (e) {
      icon.src = "chrome://global/skin/icons/defaultFavicon.svg";
    }
    item.appendChild(icon);

    item.addEventListener("click", () => {
      this.#onBookmarkClick(bookmark.url);
    });

    this.#itemsContainer.appendChild(item);
  }

  #onBookmarkClick(url) {
    // If URL is already open in an existing tab, select it
    const existingTab = window.gBrowser?.tabs.find(t => {
      try {
        return t.linkedBrowser?.currentURI?.spec === url;
      } catch (e) {
        return false;
      }
    });

    if (existingTab) {
      window.gBrowser.selectedTab = existingTab;
    } else {
      this.#openURLInNewTile(url);
    }
  }

  #openURLInNewTile(url) {
    if (!window.gBrowser) return;
    const newTab = window.gBrowser.addTrustedTab(url, {
      inBackground: false,
      triggeringPrincipal: Services.scriptsecuritymanager.getSystemPrincipal()
    });
    window.gBrowser.selectedTab = newTab;

    // Auto-tile into workspace if auto-tile is enabled
    setTimeout(() => {
      if (window.gHiFiTileShelf) {
        window.gHiFiTileShelf.checkAutoTile();
      }
    }, 250);
  }

  #addCurrentPageBookmark() {
    try {
      const currentTab = window.gBrowser?.selectedTab;
      if (!currentTab?.linkedBrowser?.currentURI) return;
      const url = currentTab.linkedBrowser.currentURI.spec;
      const title = currentTab.label || url;

      const { PlacesUtils } = ChromeUtils.importESModule(
        "resource://gre/modules/PlacesUtils.sys.mjs"
      );
      PlacesUtils.bookmarks.insert({
        parentGuid: PlacesUtils.bookmarks.toolbarGuid,
        url,
        title
      }).then(() => {
        this.#loadBookmarks();
      });
    } catch (e) {
      console.warn("Could not insert bookmark", e);
    }
  }

  #attachTabListeners() {
    const tabContainer = window.gBrowser?.tabContainer;
    if (!tabContainer) return;

    tabContainer.addEventListener("TabOpen", () => this.#updateActivePips());
    tabContainer.addEventListener("TabClose", () => this.#updateActivePips());
    tabContainer.addEventListener("TabSelect", () => this.#updateActivePips());
  }

  #updateActivePips() {
    if (!this.#itemsContainer || !window.gBrowser) return;
    const openUrls = new Set(
      window.gBrowser.tabs.map(t => {
        try {
          return t.linkedBrowser?.currentURI?.spec;
        } catch (e) {
          return "";
        }
      })
    );

    for (const btn of this.#itemsContainer.querySelectorAll(".hifi-dock-bookmark")) {
      const bmUrl = btn.dataset.url;
      const isOpen = openUrls.has(bmUrl);
      btn.classList.toggle("is-open", isOpen);
    }
  }
}

window.gHiFiBookmarkDock = new HiFiBookmarkDock();
