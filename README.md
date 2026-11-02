# HiFi Browser

HiFi Browser is a modern, high-productivity browser forked from [Zen Browser](https://zen-browser.app/) and built on Mozilla Firefox. HiFi replaces conventional tab bars with a **tile-based browsing paradigm**, complete with custom **tile decoration bars**, multi-viewport tiling, and distraction-free spatial navigation.

---

## 1. Codebase Architecture

The project is structured into two main layers:

```text
D:\hifi\
├── engine\                  # Full clone of Firefox (mozilla-central, branch zen_browser)
│   ├── browser\             # Firefox browser frontend
│   ├── toolkit\             # Gecko toolkit components
│   ├── zen\                 # Local mirror of src/zen/ (populated via npm run import)
│   ├── mach                 # Mozilla build tool
│   └── obj-*\dist\bin\      # Compiled binary (zen.exe)
│
├── src\                     # Source files tracked by HiFi
│   ├── zen\                 # [REGULAR CODE] Standalone HiFi/Zen features, UI & styles
│   │   ├── common\          # Startup, UI managers (ZenStartup.mjs, ZenUIManager.mjs)
│   │   ├── tabs\            # Tab layout & CSS (zen-tabs.css, vertical-tabs.css)
│   │   ├── split-view\      # Viewport splitting & tile mechanics (ZenViewSplitter.mjs)
│   │   ├── spaces\          # Workspaces logic & styling
│   │   └── ...
│   ├── browser\             # [FIREFOX PATCHES] Diff overrides against Firefox browser
│   │   └── base\content\    # e.g., browser-xhtml.patch, browser-box-inc-xhtml.patch
│   └── toolkit\             # Patches for toolkit components
│
├── prefs\zen\               # [PREFERENCES] YAML configuration files for about:config
│   ├── zen.yaml
│   ├── split-view.yaml
│   └── ...
│
├── tools\ffprefs\           # Rust tool that compiles YAML prefs into C++ & JS
└── surfer.json              # Surfer CLI configuration & branding
```

---

## 2. Regular Code vs. Patches

Understanding the difference between **Regular Code** and **Patches** is fundamental to developing HiFi Browser:

### Regular Code (`src/zen/`)
- **What it is:** Pure custom JavaScript modules (`.mjs`), scripts (`.js`), styles (`.css`), custom HTML Web Components (`<zen-folder>`, `<zen-workspace>`), and Mozilla build manifests (`moz.build`, `jar.inc.mn`).
- **How it works:** This code does not exist in vanilla Firefox. When you run `npm run import`, these files are synced into `engine/zen/`. Firefox includes them via a one-line declaration in `browser/base/moz.build` (`DIRS += ["../../zen"]`).
- **How you edit it:** Edit directly in `src/zen/`. Run `npm run import && npm run build:ui` to test.

### Firefox Patches (`src/**/*.patch`)
- **What it is:** Surgical unified diff patches targeting original Firefox files (e.g., `browser.xhtml`, `browser.js`, `browser-box.inc.xhtml`).
- **How it works:** When `npm run import` runs, these patches are applied to `engine/` via `git apply`.
- **How you generate or edit them:**
  1. Open and edit the target file directly in `engine/` (e.g., `engine/browser/base/content/browser.xhtml`).
  2. Test with `npm run build:ui` and `npm start`.
  3. Run the export command:
     ```bash
     npm run export <relative-path-in-engine>
     # Example:
     npm run export browser/base/content/browser.xhtml
     ```
  4. Surfer runs `git diff` against vanilla Firefox inside `engine/` and automatically updates or generates the matching `.patch` file under `src/`!

---

## 3. Fast UI Iteration Loop

> **Note:** A full C++/Rust compile (`npm run build`) takes 20–40+ minutes. For frontend UI, CSS, XHTML, and JavaScript work, **always use `npm run build:ui`**.

`npm run build:ui` calls Mozilla's `mach build faster`. It repackages the chrome JARs and updates JS/CSS/XHTML in **2 to 10 seconds**.

### Standard Development Commands

```bash
# 1. Sync files from src/zen/ and compile prefs to engine:
npm run import

# 2. Fast UI build (takes ~3-5 seconds):
npm run build:ui

# 3. Launch HiFi Browser:
npm start
```

---

## 4. Live UI Inspection (Browser Toolbox)

You can inspect and debug the browser UI live while it is running:

1. Launch HiFi Browser (`npm start`).
2. Press **`Ctrl + Alt + Shift + I`** (Windows/Linux) or **`Cmd + Opt + Shift + I`** (macOS).
3. Accept the incoming debugging connection prompt.
4. Use the DevTools inspector to:
   - Live-edit CSS styles on tabs, split viewports, and toolbars.
   - Inspect the live DOM tree (`#zen-tabbox-wrapper`, `#vertical-tabs`, etc.).
   - Execute JavaScript commands in the Chrome console with access to `gBrowser`, `ZenUIManager`, etc.

---

## 5. Adding & Modifying Preferences

HiFi preferences are managed modularly in YAML files inside `prefs/zen/`:

1. Open or create a YAML file in `prefs/zen/` (e.g. `prefs/zen/tiles.yaml`):
   ```yaml
   - name: hifi.tiles.enabled
     value: true
   - name: hifi.tiles.layout
     value: "grid"
   ```
2. Run `npm run import` (this executes `ffprefs` to generate C++ static prefs and JS default prefs).
3. Access the preference in JavaScript:
   ```javascript
   const tilesEnabled = Services.prefs.getBoolPref("hifi.tiles.enabled", true);
   ```

---

## 6. Gameplan: Tiles Instead of Tabs & Tile Decoration Bars

The primary roadmap goal is transitioning from a traditional vertical tab strip to a tiled grid interface with custom tile decoration bars.

### Key Existing Components

- **Split View System (`src/zen/split-view/`)**:
  - `ZenViewSplitter.mjs`: Manages multi-viewport tab splitting, grid calculation, and focus.
  - `zen-split-view.css`: Multi-view containers, active border glow, and splitters.
  - `zen-splitview-overlay.inc.xhtml`: Split-pane decoration overlays.
- **Vertical Tabs Manager (`src/zen/common/modules/ZenVerticalTabsManager.mjs`)**:
  - Controls tab strip display modes, collapse/expand states, and tab selection.
- **Browser Box Structure (`src/browser/base/content/browser-box-inc-xhtml.patch`)**:
  - Sets up `#zen-tabbox-wrapper` and `#vertical-tabs`.

### Roadmap Phases

1. **Phase 1: Architecture & Prototyping**
   - Study `ZenViewSplitter.mjs` and split-view styling via the Browser Toolbox (`Ctrl+Alt+Shift+I`).
   - Understand how multiple `<browser>` elements are currently tiled in split view.
2. **Phase 2: Configuration (`prefs/zen/tiles.yaml`)**
   - Define preferences for tile layouts (grid, 2x2, vertical columns) and decoration bars.
3. **Phase 3: Tile Manager & Styling**
   - Create `src/zen/tiles/` (or adapt `src/zen/split-view/`) with tile arrangement logic and CSS grid layouts.
   - Register modules in `src/zen/common/ZenPreloadedScripts.js`.
4. **Phase 4: Tile Decoration Bar**
   - Implement custom element `<hifi-tile-bar>` containing title, favicon, pin/close buttons, and split controls.
   - Attach the decoration bar to each tile container.
5. **Phase 5: Tab Strip Transition**
   - Allow toggling or replacing the legacy tab strip (`#vertical-tabs`) with the tile interface.

---

## 7. Command Reference

| Command | Description |
| :--- | :--- |
| `npm run import` | Syncs `src/zen/` to `engine/`, compiles prefs, and applies patches |
| `npm run build:ui` | Fast frontend build (~3-5 seconds, no C++ compilation) |
| `npm start` | Launches HiFi Browser without a test profile |
| `npm run export <path>` | Generates a `.patch` file in `src/` from modified files in `engine/` |
| `npm run build` | Full browser build (C++, Rust, and UI) |
| `npm run package` | Builds release packages / installers |
| `npm run test` | Runs test suite |
