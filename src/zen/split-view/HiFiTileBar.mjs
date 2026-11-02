// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

/**
 * HiFi Tile Decoration Bar
 * Manages title, favicon, audio mute, tile minimization, fullscreen toggle, and close controls.
 */
export class HiFiTileBar {
  static SVG_ICONS = {
    drag: `<svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor"><circle cx="5" cy="3.5" r="1.3"/><circle cx="11" cy="3.5" r="1.3"/><circle cx="5" cy="8" r="1.3"/><circle cx="11" cy="8" r="1.3"/><circle cx="5" cy="12.5" r="1.3"/><circle cx="11" cy="12.5" r="1.3"/></svg>`,
    mute: `<svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor"><path d="M11.536 14.071a1 1 0 0 1-1.414-1.414A5.978 5.978 0 0 0 12 8c0-1.657-.672-3.156-1.878-4.243a1 1 0 1 1 1.414-1.414A7.978 7.978 0 0 1 14 8a7.978 7.978 0 0 1-2.464 6.071zM7 3.414 4.707 5.707A1 1 0 0 1 4 6H2a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h2a1 1 0 0 1 .707.293L7 12.586V3.414z"/></svg>`,
    muted: `<svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor"><path d="m1.293 1.293 13.414 13.414-1.414 1.414L10.37 13.2A7.94 7.94 0 0 1 8 13.6V12.6a6.95 6.95 0 0 0 1.636-.364L7 9.614V12.586L4.707 10.293A1 1 0 0 1 4 10H2a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h1.586L1.293 2.707 2.707 1.293zM7 3.414v2.772L4.814 4.072 7 3.414zm4.536.657A7.978 7.978 0 0 1 14 8a7.93 7.93 0 0 1-1.127 4.053l-1.47-1.47A5.95 5.95 0 0 0 12 8c0-1.657-.672-3.156-1.878-4.243a1 1 0 1 1 1.414-1.414z"/></svg>`,
    minimize: `<svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor"><path d="M3 8.5a.75.75 0 0 1 .75-.75h8.5a.75.75 0 0 1 0 1.5h-8.5A.75.75 0 0 1 3 8.5z"/></svg>`,
    fullscreen: `<svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor"><path d="M2.5 3A.5.5 0 0 1 3 2.5h3.5a.5.5 0 0 1 0 1H4v2.5a.5.5 0 0 1-1 0V3zm10.5.5a.5.5 0 0 0-.5-.5H9a.5.5 0 0 0 0 1h2.5v2.5a.5.5 0 0 0 1 0V3.5zm-.5 9.5a.5.5 0 0 0 .5-.5V9a.5.5 0 0 0-1 0v2.5H9a.5.5 0 0 0 0 1h3.5zM3 13a.5.5 0 0 1-.5-.5V9a.5.5 0 0 1 1 0v2.5H6a.5.5 0 0 1 0 1H3z"/></svg>`,
    restore: `<svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor"><path d="M5.5 3a.5.5 0 0 0-.5.5V6H2.5a.5.5 0 0 0 0 1H6a.5.5 0 0 0 .5-.5V3a.5.5 0 0 0-1 0zm5 0a.5.5 0 0 1 .5.5V6h2.5a.5.5 0 0 1 0 1H10a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 1 0zm-5 10a.5.5 0 0 1-.5-.5V10H2.5a.5.5 0 0 1 0-1H6a.5.5 0 0 1 .5.5v3.5a.5.5 0 0 1-1 0zm5 0a.5.5 0 0 0 .5-.5V10h2.5a.5.5 0 0 0 0-1H10a.5.5 0 0 0-.5.5v3.5a.5.5 0 0 0 1 0z"/></svg>`,
    close: `<svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor"><path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06z"/></svg>`
  };

  /**
   * Builds the tile decoration bar element for a given browser container
   * @param {Element} container - .browserSidebarContainer
   * @param {object} splitter - Reference to nsZenViewSplitter instance
   * @returns {Element}
   */
  static create(container, splitter) {
    const headerWrapper = document.createElement("div");
    headerWrapper.classList.add("zen-view-splitter-header-container", "hifi-tile-bar-container");

    const bar = document.createElement("div");
    bar.classList.add("zen-view-splitter-header", "hifi-tile-bar");

    // Drag / Rearrange Handle
    const dragBtn = document.createXULElement("toolbarbutton");
    dragBtn.classList.add("zen-tab-rearrange-button", "hifi-tile-btn", "hifi-tile-drag-btn");
    dragBtn.setAttribute("tooltiptext", "Drag to rearrange tile");
    dragBtn.innerHTML = this.SVG_ICONS.drag;
    bar.appendChild(dragBtn);

    // Favicon & Title Container
    const infoContainer = document.createElement("div");
    infoContainer.classList.add("hifi-tile-info");

    const favicon = document.createXULElement("image");
    favicon.classList.add("hifi-tile-favicon");
    infoContainer.appendChild(favicon);

    const title = document.createElement("span");
    title.classList.add("hifi-tile-title");
    title.textContent = "Tile";
    infoContainer.appendChild(title);

    bar.appendChild(infoContainer);

    // Controls Container
    const controls = document.createElement("div");
    controls.classList.add("hifi-tile-controls");

    // 1. Mute Button
    const muteBtn = document.createXULElement("toolbarbutton");
    muteBtn.classList.add("hifi-tile-btn", "hifi-tile-mute-btn");
    muteBtn.setAttribute("tooltiptext", "Mute Audio");
    muteBtn.innerHTML = this.SVG_ICONS.mute;
    controls.appendChild(muteBtn);

    // 2. Minimize Button
    const minBtn = document.createXULElement("toolbarbutton");
    minBtn.classList.add("hifi-tile-btn", "hifi-tile-minimize-btn");
    minBtn.setAttribute("tooltiptext", "Minimize to Tile Shelf");
    minBtn.innerHTML = this.SVG_ICONS.minimize;
    controls.appendChild(minBtn);

    // 3. Fullscreen / Maximize Button
    const fsBtn = document.createXULElement("toolbarbutton");
    fsBtn.classList.add("hifi-tile-btn", "hifi-tile-fullscreen-btn");
    fsBtn.setAttribute("tooltiptext", "Toggle Tile Fullscreen");
    fsBtn.innerHTML = this.SVG_ICONS.fullscreen;
    controls.appendChild(fsBtn);

    // 4. Close Button
    const closeBtn = document.createXULElement("toolbarbutton");
    closeBtn.classList.add("zen-tab-unsplit-button", "hifi-tile-btn", "hifi-tile-close-btn");
    closeBtn.setAttribute("tooltiptext", "Close Tile");
    closeBtn.innerHTML = this.SVG_ICONS.close;
    controls.appendChild(closeBtn);

    bar.appendChild(controls);
    headerWrapper.appendChild(bar);

    // Helper to get tab associated with this container
    const getTab = () => {
      const browser = container.querySelector("browser");
      return browser ? window.gBrowser?.getTabForBrowser(browser) : null;
    };

    // Live state updater
    const updateState = () => {
      const tab = getTab();
      if (!tab) return;

      const label = tab.label || tab.getAttribute("label") || "New Tile";
      title.textContent = label;
      title.setAttribute("title", label);

      const icon = tab.getAttribute("image");
      if (icon) {
        favicon.setAttribute("src", icon);
        favicon.style.display = "";
      } else {
        favicon.style.display = "none";
      }

      const isMuted = !!tab.muted;
      const isPlaying = !!tab.soundPlaying;
      muteBtn.classList.toggle("is-muted", isMuted);
      muteBtn.classList.toggle("sound-playing", isPlaying);
      muteBtn.innerHTML = isMuted ? HiFiTileBar.SVG_ICONS.muted : HiFiTileBar.SVG_ICONS.mute;
      muteBtn.setAttribute("tooltiptext", isMuted ? "Unmute Audio" : "Mute Audio");
    };

    // Initialize state
    const initialTab = getTab();
    if (initialTab) {
      initialTab.addEventListener("TabAttrModified", updateState);
      updateState();
    } else {
      setTimeout(updateState, 100);
    }

    // Button event listeners
    muteBtn.addEventListener("click", event => {
      event.stopPropagation();
      const currentTab = getTab();
      if (currentTab?.toggleMuteAudio) {
        currentTab.toggleMuteAudio();
        updateState();
      }
    });

    minBtn.addEventListener("click", event => {
      event.stopPropagation();
      const currentTab = getTab();
      if (currentTab) {
        currentTab.setAttribute("hifi-minimized", "true");
        window.dispatchEvent(
          new CustomEvent("hifi-tile-minimized", {
            bubbles: true,
            detail: { tab: currentTab }
          })
        );
        if (splitter?.removeTabFromSplit) {
          splitter.removeTabFromSplit(event, container);
        }
      }
    });

    fsBtn.addEventListener("click", event => {
      event.stopPropagation();
      const isMax = container.classList.toggle("hifi-tile-fullscreen");
      fsBtn.classList.toggle("is-maximized", isMax);
      fsBtn.innerHTML = isMax ? HiFiTileBar.SVG_ICONS.restore : HiFiTileBar.SVG_ICONS.fullscreen;
      fsBtn.setAttribute("tooltiptext", isMax ? "Restore Tile Layout" : "Toggle Tile Fullscreen");
      window.dispatchEvent(new Event("resize"));
    });

    closeBtn.addEventListener("click", event => {
      event.stopPropagation();
      const currentTab = getTab();
      if (currentTab) {
        window.gBrowser?.removeTab(currentTab);
      } else if (splitter?.removeTabFromSplit) {
        splitter.removeTabFromSplit(event, container);
      }
    });

    return headerWrapper;
  }
}
