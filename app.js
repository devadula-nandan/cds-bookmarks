document.addEventListener("DOMContentLoaded", () => {
  // --- MODULE: State Management ---
  const AppState = {
    STORAGE_KEY_BOOKMARKS: "cdsBookmarksData",
    STORAGE_KEY_THEME: "theme",

    getData() {
      const raw = localStorage.getItem(this.STORAGE_KEY_BOOKMARKS);
      try {
        const data = raw ? JSON.parse(raw) : bookmarksData;
        // Ensure data is initialized if storage is empty
        if (!raw) this.saveData(data);
        return data;
      } catch {
        this.saveData(bookmarksData); // Overwrite corrupted data
        return bookmarksData;
      }
    },

    saveData(data) {
      localStorage.setItem(this.STORAGE_KEY_BOOKMARKS, JSON.stringify(data));
    },

    getTheme() {
      return localStorage.getItem(this.STORAGE_KEY_THEME) || "white";
    },

    saveTheme(theme) {
      localStorage.setItem(this.STORAGE_KEY_THEME, theme);
    },
  };

  // --- MODULE: UI Generation ---
  const UIGenerator = {
    createTile(tileData, target) {
      const buttonsHTML = tileData.buttons
        .map((button) => {
          const btnHTML = `
            <cds-button size="md" kind="${
              button.kind || "secondary"
            }" data-href="${button.href || ""}">
              ${button.label}${button.icon || ""}
            </cds-button>`;

          if (button.versionedHref) {
            return `
              <div class="versioned-group" data-versioned-href="${
                button.versionedHref
              }" style="display: flex; align-items: end;">
                ${btnHTML}
                <div style="max-width: 6rem;">
                  <cds-text-input class="version-input" placeholder="Enter version" size="md" value="${
                    button.version || "latest"
                  }"></cds-text-input>
                </div>
                <cds-button size="md" tooltip-text="Open" kind="secondary" tooltip-position="top" class="open-version-btn">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" width="16" height="16" slot="icon">
                    <path d="M13,14H3c-0.6,0-1-0.4-1-1V3c0-0.6,0.4-1,1-1h5v1H3v10h10V8h1v5C14,13.6,13.6,14,13,14z"></path>
                    <path d="M10 1L10 2 13.3 2 9 6.3 9.7 7 14 2.7 14 6 15 6 15 1z"></path>
                  </svg>
                </cds-button>
              </div>`;
          }
          return btnHTML;
        })
        .join("\n");

      return `
        <cds-tile style="margin-bottom: 2rem">
          <h2 style="font-size: 2em; font-weight: 200; margin: 0">${
            tileData.title
          }</h2>
          ${
            tileData.buttons.length > 0
              ? `<div style="padding-top: 1rem; display: flex; flex-wrap: wrap; gap: 4px;">${buttonsHTML}</div>`
              : ""
          }
          ${tileData.icon}
        </cds-tile>`;
    },

    createTabPanel(tabData, currentTheme) {
      const panel = document.createElement("div");
      panel.id = `${tabData.id}-panel`;
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-labelledby", tabData.id);
      panel.hidden = true;

      const isChecked = tabData.linksTarget === "_blank";

      // ✅ FIX: Use cds--css-grid--full-width for the main content area
      panel.innerHTML = `
        <div class="cds--css-grid cds--css-grid--full-width" style="margin-top: 2rem">
          
          <div style="margin-bottom: 2rem; display: flex; flex-direction: column; gap: 1rem;" 
               class="cds--css-grid-column cds--sm:col-span-4 cds--md:col-span-8 cds--lg:col-span-5 cds--xlg:col-span-4">
            ${tabData.icon}
            <cds-heading style="margin-bottom: 1rem">${
              tabData.name
            }</cds-heading>
            <cds-dropdown label="Theme" class="theme-selector" value="${currentTheme}" style="margin-bottom: 1rem">
              <cds-dropdown-item value="white">white</cds-dropdown-item>
              <cds-dropdown-item value="g10">g10</cds-dropdown-item>
              <cds-dropdown-item value="g90">g90</cds-dropdown-item>
              <cds-dropdown-item value="g100">g100</cds-dropdown-item>
            </cds-dropdown>
            <cds-toggle
              ${isChecked ? "checked" : ""}
              label-text="Open links in new tab"
              class="link-toggle"
              data-tab-id="${tabData.id}"
              style="margin-bottom: 1rem"
            ></cds-toggle>
          </div>
          
          <div style="margin-bottom: 2rem" 
               class="cds--css-grid-column cds--sm:col-span-4 cds--md:col-span-8 cds--lg:col-span-6 cds--xlg:col-span-8">
            ${this.createTile(tabData.github, tabData.linksTarget)}
            ${this.createTile(tabData.website, tabData.linksTarget)}
            ${this.createTile(tabData.storybooks, tabData.linksTarget)}
          </div>
          
        </div>`;
      return panel;
    },

    render(data, containers, currentTheme) {
      containers.tabs.innerHTML = "";
      containers.panels.innerHTML = "";
      const selectedTab = data.find((tab) => tab.selected)?.id || data[0]?.id;

      data.forEach((tab) => {
        const tabElement = document.createElement("cds-tab");
        tabElement.id = tab.id;
        tabElement.textContent = tab.name;
        tabElement.setAttribute("target", `${tab.id}-panel`);
        tabElement.setAttribute("value", tab.id);
        containers.tabs.appendChild(tabElement);

        const panelElement = this.createTabPanel(tab, currentTheme);
        containers.panels.appendChild(panelElement);
      });

      containers.tabs.value = selectedTab;
    },
  };

  // --- MODULE: Event Handling ---
  const EventHandlers = {
    initialize(containers) {
      containers.tabs.addEventListener(
        "cds-tabs-selected",
        this.handleTabSelection
      );
      containers.panels.addEventListener(
        "cds-dropdown-selected",
        this.handleThemeChange.bind(this)
      );
      containers.panels.addEventListener(
        "cds-toggle-changed",
        this.handleLinkToggle
      );
      containers.panels.addEventListener("click", this.handlePanelClick);
    },

    handleTabSelection(event) {
      const newSelectedId = event.detail.item.id;
      const data = AppState.getData();
      const updatedData = data.map((tab) => ({
        ...tab,
        selected: tab.id === newSelectedId,
      }));
      AppState.saveData(updatedData);
    },

    handleThemeChange(event) {
      if (!event.target.classList.contains("theme-selector")) return;
      const selectedTheme = event.detail.item.value;
      document.documentElement.className = `cds-theme-zone-${selectedTheme}`;
      AppState.saveTheme(selectedTheme);
      // Sync other dropdowns
      document
        .querySelectorAll(".theme-selector")
        .forEach((d) => (d.value = selectedTheme));
    },

    handleLinkToggle(event) {
      if (!event.target.classList.contains("link-toggle")) return;
      const tabId = event.target.dataset.tabId;
      const isChecked = event.target.checked;
      const data = AppState.getData();
      const updatedData = data.map((tab) =>
        tab.id === tabId
          ? { ...tab, linksTarget: isChecked ? "_blank" : "_self" }
          : tab
      );
      AppState.saveData(updatedData);
    },

    handlePanelClick(event) {
      const button = event.target.closest("cds-button");
      if (!button) return;

      event.stopPropagation();

      const data = AppState.getData();
      const activeTabId = document.getElementById("main-tabs").value;
      const activeTab = data.find((tab) => tab.id === activeTabId);
      const target = activeTab.linksTarget || "_self";

      // Handle versioned buttons
      const versionGroup = button.closest(".versioned-group");
      if (versionGroup && button.classList.contains("open-version-btn")) {
        const input = versionGroup.querySelector(".version-input");
        const version = input.value.trim() || "latest";
        const finalUrl = versionGroup.dataset.versionedHref.replace(
          "<v>",
          encodeURIComponent(version)
        );
        window.open(finalUrl, target);
        return;
      }

      // Handle standard buttons with data-href
      const href = button.dataset.href;
      if (href) {
        window.open(href, target);
      }
    },
  };

  // --- MODULE: Utilities ---
  const Utils = {
    updateDateTime() {
      const date = new Date();
      const options = {
        day: "2-digit",
        month: "long",
        weekday: "long",
        hour: "2-digit",
        minute: "2-digit",
      };
      const formattedDate = date
        .toLocaleDateString("en-US", options)
        .replace(",", " |")
        .replace(" at", " |");
      document.getElementById("date-time").innerText = formattedDate;
    },
  };

  // --- APPLICATION INITIALIZATION ---
  function main() {
    const containers = {
      tabs: document.getElementById("main-tabs"),
      panels: document.getElementById("tab-panels"),
    };

    const currentTheme = AppState.getTheme();
    const currentData = AppState.getData();

    UIGenerator.render(currentData, containers, currentTheme);
    EventHandlers.initialize(containers);

    Utils.updateDateTime();
    setInterval(Utils.updateDateTime, 60000); // Update every minute is sufficient
  }

  main();
});
