"use strict";

(() => {
  const search = document.querySelector("#search");
  const filters = document.querySelector("#filters");
  const grid = document.querySelector("#pack-grid");
  const status = document.querySelector("#results-status");
  const error = document.querySelector("#load-error");
  const empty = document.querySelector("#empty-state");
  const selection = { industry: "", function: "" };
  let packs = [];

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function link(text, url, className, accessibleLabel) {
    const node = element("a", className, text);
    node.href = url;
    if (accessibleLabel) node.setAttribute("aria-label", accessibleLabel);
    return node;
  }

  function safeUrl(value, optional = false) {
    if (optional && value === "") return true;
    if (typeof value !== "string") return false;
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password;
    } catch {
      return false;
    }
  }

  function validateCatalog(data) {
    if (!Array.isArray(data)) throw new Error("Catalog must be an array.");
    const ids = new Set();
    const requiredText = ["id", "title", "summary", "industry", "function", "author", "updated"];
    for (const pack of data) {
      if (!pack || requiredText.some(key => typeof pack[key] !== "string" || !pack[key].trim())) {
        throw new Error("Missing required pack metadata.");
      }
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(pack.id) || ids.has(pack.id)) throw new Error("Invalid or duplicate pack ID.");
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(pack.updated)) throw new Error("Invalid review month.");
      if (pack.workInProgress !== undefined && typeof pack.workInProgress !== "boolean") throw new Error("Invalid work-in-progress flag.");
      const placeholder = pack.workInProgress === true;
      if (!Array.isArray(pack.features) || (!placeholder && !pack.features.length) || pack.features.some(tag => typeof tag !== "string" || !tag.trim())) throw new Error("Invalid feature tags.");
      if (placeholder && (pack.features.length || [pack.pagesUrl, pack.repoUrl, pack.demoUrl].some(url => url !== ""))) throw new Error("Placeholders must not claim capabilities or link to unfinished resources.");
      if (pack.tags !== undefined && (!Array.isArray(pack.tags) || pack.tags.some(tag => typeof tag !== "string"))) throw new Error("Invalid search tags.");
      if (!safeUrl(pack.pagesUrl, placeholder) || !safeUrl(pack.repoUrl, placeholder) || !safeUrl(pack.demoUrl, true)) throw new Error("Pack links must be HTTPS.");
      if (pack.setup !== undefined && !(!placeholder && ["local", "snowflake"].includes(pack.setup))) throw new Error("Invalid setup mode.");
      if (pack.images !== undefined && (placeholder || !Array.isArray(pack.images) || !pack.images.length || pack.images.length > 8 || pack.images.some(image => !image || typeof image.src !== "string" || !/^assets\/packs\/[a-z0-9-]+\.(jpg|png|webp)$/.test(image.src) || typeof image.alt !== "string" || !image.alt.trim()))) throw new Error("Invalid pack images.");
      if (pack.access !== undefined && !["public", "internal"].includes(pack.access)) throw new Error("Invalid access label.");
      ids.add(pack.id);
    }
    return data;
  }

  function buildFilters() {
    filters.replaceChildren();
    for (const [key, label] of [["industry", "Industry"], ["function", "Function"]]) {
      const group = element("fieldset");
      group.append(element("legend", "", label));
      const choices = [...new Set(packs.map(pack => pack[key]))].sort();
      const chips = element("div", "chips");
      for (const value of ["", ...choices]) {
        const button = element("button", "chip", value || "All");
        button.type = "button";
        button.dataset.filter = key;
        button.dataset.value = value;
        button.setAttribute("aria-pressed", String(selection[key] === value));
        button.addEventListener("click", () => {
          selection[key] = value;
          updateChips();
          render();
        });
        chips.append(button);
      }
      group.append(chips);
      filters.append(group);
    }
  }

  function updateChips() {
    filters.querySelectorAll("button").forEach(button => {
      button.setAttribute("aria-pressed", String(selection[button.dataset.filter] === button.dataset.value));
    });
  }

  function packCard(pack) {
    const internal = pack.access === "internal";
    const card = element("article", "pack-card");
    card.dataset.packId = pack.id;
    const headingId = `pack-${pack.id}`;
    card.setAttribute("aria-labelledby", headingId);
    const badges = element("div", "card-top");
    badges.append(element("span", "badge", pack.industry), element("span", "badge function-badge", pack.function));
    const heading = element("h3", "", pack.title);
    heading.id = headingId;
    card.append(badges, heading, element("p", "pack-summary", pack.summary));
    if (pack.workInProgress) {
      card.classList.add("wip-card");
      card.prepend(element("p", "wip-label", "Work in progress"));
      card.append(element("p", "wip-note", "Planned concept. Example and code are not yet available."));
      return card;
    }
    card.classList.add("available-card");
    if (pack.images) badges.append(previewToggle(pack, card));
    if (internal) card.append(element("p", "access-note", "Internal · Snowflake employees only"));
    const features = element("ul", "feature-tags");
    features.setAttribute("aria-label", "Snowflake features and capabilities");
    pack.features.forEach(feature => features.append(element("li", "", feature)));
    card.append(features);
    const actions = element("div", "card-actions");
    const accessLabel = internal ? "; employee sign-in required" : "";
    actions.append(link("View pack ↗", pack.pagesUrl, "button primary", `View ${pack.title}${accessLabel}`));
    if (pack.demoUrl) actions.append(link("Try example", pack.demoUrl, "button secondary", `Try ${pack.title} example${accessLabel}`));
    actions.append(link("View code ↗", pack.repoUrl, "repo-link", `${pack.title} repository${accessLabel}`));
    card.append(actions);
    if (!pack.demoUrl) {
      const note = element("p", "example-note");
      if (internal) {
        note.textContent = "Access-controlled showcase. Not a public customer deployment template.";
      } else if (pack.setup === "snowflake") {
        note.append(link("Try this example in your Snowflake account", pack.repoUrl, "", `Setup instructions for ${pack.title}`), " with synthetic data using the guide's SQL script.");
      } else {
        note.append(link("Try this example locally", pack.repoUrl, "", `Local setup instructions for ${pack.title}`), " with sample data using the Quick Start.");
      }
      card.append(note);
    }
    return card;
  }

  // Hover, focus, or tap the toggle to show a screenshot carousel over the card.
  // Images are created on first open, so cards stay light until someone asks.
  function previewToggle(pack, card) {
    const panelId = `preview-${pack.id}`;
    const toggle = element("button", "preview-toggle");
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-controls", panelId);
    const icon = element("span", "preview-icon", "▶");
    icon.setAttribute("aria-hidden", "true");
    toggle.append(icon, " Preview");
    toggle.setAttribute("aria-label", `Preview ${pack.title} screenshots`);

    const panel = element("div", "preview-panel");
    panel.id = panelId;
    panel.hidden = true;
    panel.setAttribute("role", "region");
    panel.setAttribute("aria-label", `${pack.title} screenshots`);
    let slides = [];
    let dots = [];
    let caption;
    let index = 0;
    let timer;
    let closeTimer;
    let pinned = false;
    let suppressOpen = false;
    let openedBy = "";
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    function build() {
      const frame = link("", pack.pagesUrl, "preview-frame");
      frame.tabIndex = -1;
      frame.setAttribute("aria-hidden", "true");
      slides = pack.images.map((image, n) => {
        const img = element("img");
        img.src = image.src;
        img.alt = image.alt;
        img.width = 960;
        img.height = 600;
        img.decoding = "async";
        img.className = n === 0 ? "active" : "";
        frame.append(img);
        return img;
      });
      caption = element("p", "preview-caption");
      caption.setAttribute("aria-live", "polite");
      const nav = element("div", "preview-dots");
      dots = pack.images.map((image, n) => {
        const dot = element("button", "preview-dot");
        dot.type = "button";
        dot.setAttribute("aria-label", `Screenshot ${n + 1} of ${pack.images.length}: ${image.alt}`);
        dot.addEventListener("click", () => { stopCycle(); show(n); });
        nav.append(dot);
        return dot;
      });
      panel.append(frame, caption, nav);
    }

    function show(n) {
      index = (n + slides.length) % slides.length;
      slides.forEach((img, i) => img.classList.toggle("active", i === index));
      dots.forEach((dot, i) => dot.setAttribute("aria-current", String(i === index)));
      caption.textContent = `${index + 1}/${slides.length} · ${pack.images[index].alt}`;
    }

    function stopCycle() {
      clearInterval(timer);
      timer = undefined;
    }

    function open(source) {
      clearTimeout(closeTimer);
      if (suppressOpen || !panel.hidden) return;
      openedBy = source;
      if (!slides.length) build();
      document.querySelectorAll(".preview-toggle[aria-expanded='true']").forEach(other => {
        if (other !== toggle) other.dispatchEvent(new CustomEvent("preview-close"));
      });
      panel.style.top = `${toggle.offsetTop + toggle.offsetHeight + 10}px`;
      panel.hidden = false;
      toggle.setAttribute("aria-expanded", "true");
      show(0);
      if (!reduceMotion.matches && slides.length > 1) timer = setInterval(() => show(index + 1), 2200);
    }

    function close() {
      stopCycle();
      pinned = false;
      panel.hidden = true;
      toggle.setAttribute("aria-expanded", "false");
    }

    function closeSoon() {
      if (pinned) return;
      clearTimeout(closeTimer);
      closeTimer = setTimeout(() => {
        const hovered = panel.matches(":hover") || toggle.matches(":hover");
        const focused = card.contains(document.activeElement);
        if (!hovered && (openedBy === "pointer" || !focused)) close();
      }, 150);
    }

    toggle.addEventListener("mouseenter", () => open("pointer"));
    toggle.addEventListener("focus", () => open("keyboard"));
    toggle.addEventListener("click", () => {
      if (panel.hidden) { open("pointer"); pinned = true; }
      else if (pinned) close();
      else pinned = true;
    });
    toggle.addEventListener("mouseleave", closeSoon);
    toggle.addEventListener("preview-close", close);
    panel.addEventListener("mouseenter", () => clearTimeout(closeTimer));
    panel.addEventListener("mouseleave", closeSoon);
    card.addEventListener("focusout", event => {
      if (!card.contains(event.relatedTarget)) { pinned = false; closeSoon(); }
    });
    card.addEventListener("keydown", event => {
      if (event.key === "Escape" && !panel.hidden) {
        close();
        suppressOpen = true;
        toggle.focus({ preventScroll: true });
        suppressOpen = false;
      }
    });
    card.append(panel);
    return toggle;
  }

  function render() {
    const terms = search.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const matches = packs.filter(pack => {
      const content = [pack.title, pack.summary, pack.industry, pack.function, ...pack.features, ...(pack.tags || [])].join(" ").toLocaleLowerCase();
      return terms.every(term => content.includes(term)) && Object.entries(selection).every(([key, value]) => !value || pack[key] === value);
    });
    matches.sort((first, second) => Number(Boolean(first.workInProgress)) - Number(Boolean(second.workInProgress)));
    grid.replaceChildren(...matches.map(packCard));
    empty.hidden = matches.length !== 0;
    const planned = matches.filter(pack => pack.workInProgress).length;
    status.textContent = `${matches.length} ${matches.length === 1 ? "pack" : "packs"} shown · ${packs.length} in the collection · ${planned} work in progress`;
  }

  function reset() {
    search.value = "";
    Object.keys(selection).forEach(key => { selection[key] = ""; });
    updateChips();
    render();
    search.focus();
  }

  async function load() {
    error.hidden = true;
    empty.hidden = true;
    status.textContent = "Loading the collection…";
    search.disabled = true;
    document.querySelector("#reset-filters").disabled = true;
    document.querySelector("#retry-load").disabled = true;
    filters.replaceChildren();
    grid.replaceChildren();
    try {
      const response = await fetch("./packs.json", { credentials: "omit", cache: "no-cache" });
      if (!response.ok) throw new Error(`Catalog request failed (${response.status}).`);
      packs = validateCatalog(await response.json());
      buildFilters();
      render();
      search.disabled = false;
      document.querySelector("#reset-filters").disabled = false;
    } catch (failure) {
      error.hidden = false;
      status.textContent = "Collection unavailable.";
      console.error("Snow Packs:", failure.message);
    } finally {
      document.querySelector("#retry-load").disabled = false;
    }
  }

  search.addEventListener("input", render);
  document.querySelector("#reset-filters").addEventListener("click", reset);
  document.querySelector("#reset-empty").addEventListener("click", reset);
  document.querySelector("#retry-load").addEventListener("click", load);
  load();
})();
