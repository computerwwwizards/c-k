// ============================================================================
// LAYER 1: PURE C-K VALIDATOR, DIAGNOSTICS & TREE-TIP DETECTOR
// ============================================================================
const CKValidator = {
  analyze(domain) {
    const concepts = Array.isArray(domain.concepts) ? domain.concepts : [];
    const knowledge = Array.isArray(domain.knowledge) ? domain.knowledge : [];
    const links = Array.isArray(domain.links) ? domain.links : [];

    const spaceMap = new Map();
    const labelMap = new Map();
    const duplicateIds = [];

    concepts.forEach((c) => {
      if (spaceMap.has(c.id)) duplicateIds.push(c.id);
      spaceMap.set(c.id, "C");
      labelMap.set(c.id, c.label || c.id);
    });

    knowledge.forEach((k) => {
      if (spaceMap.has(k.id)) duplicateIds.push(k.id);
      spaceMap.set(k.id, "K");
      labelMap.set(k.id, k.label || k.id);
    });

    const parentMap = new Map();
    const childCount = new Map();
    const cAdjacency = new Map();
    concepts.forEach((c) => {
      parentMap.set(c.id, []);
      cAdjacency.set(c.id, []);
    });

    let crossSpaceLinkCount = 0;
    const danglingLinks = [];
    const typedLinks = [];

    links.forEach((link, index) => {
      const hasFrom = spaceMap.has(link.from);
      const hasTo = spaceMap.has(link.to);

      if (!hasFrom || !hasTo) {
        danglingLinks.push({
          index,
          from: link.from,
          to: link.to,
          missingFrom: !hasFrom,
          missingTo: !hasTo
        });
        return;
      }

      const fromSpace = spaceMap.get(link.from);
      const toSpace = spaceMap.get(link.to);
      const operator = fromSpace + toSpace;

      if (operator === "CC") {
        parentMap.get(link.to).push(link.from);
        childCount.set(link.from, (childCount.get(link.from) || 0) + 1);
        cAdjacency.get(link.from).push(link.to);
      }
      if (operator === "KC" || operator === "CK") {
        crossSpaceLinkCount++;
      }

      typedLinks.push({
        id: `${link.from}->${link.to}`,
        from: link.from,
        to: link.to,
        operator
      });
    });

    const state = new Map();
    const inCycle = new Map();

    function dfsCycle(nodeId, stack) {
      state.set(nodeId, 1);
      stack.push(nodeId);

      const neighbors = cAdjacency.get(nodeId) || [];
      for (const nextId of neighbors) {
        const nextState = state.get(nextId) || 0;
        if (nextState === 0) {
          dfsCycle(nextId, stack);
        } else if (nextState === 1) {
          const loopStart = stack.indexOf(nextId);
          const loopNodes = stack.slice(loopStart).concat(nextId);
          const loopPath = loopNodes.join(" -> ");
          for (let i = loopStart; i < stack.length; i++) {
            inCycle.set(stack[i], loopPath);
          }
        }
      }

      stack.pop();
      state.set(nodeId, 2);
    }

    concepts.forEach((c) => {
      if (!state.get(c.id)) dfsCycle(c.id, []);
    });

    const violations = {}; 
    const diagnostics = [];
    const leafIds = new Set();

    if (!domain.rootId || !spaceMap.has(domain.rootId)) {
      diagnostics.push({
        code: "MISSING_OR_INVALID_ROOT",
        nodeId: domain.rootId || null,
        problem: `domain.rootId ("${domain.rootId}") does not match any Concept ID in concepts[].`,
        fix: `Set "rootId" to the top-level Concept ID (e.g., "${concepts[0]?.id || "c0"}").`
      });
    }

    duplicateIds.forEach((dupId) => {
      diagnostics.push({
        code: "DUPLICATE_NODE_ID",
        nodeId: dupId,
        problem: `Node ID "${dupId}" is declared more than once across concepts[] or knowledge[].`,
        fix: `Rename duplicate "${dupId}" so every Concept and Knowledge item has a unique "id".`
      });
    });

    danglingLinks.forEach((dl) => {
      const missingParts = [];
      if (dl.missingFrom) missingParts.push(`source "${dl.from}"`);
      if (dl.missingTo) missingParts.push(`target "${dl.to}"`);
      diagnostics.push({
        code: "DANGLING_LINK_REFERENCE",
        linkIndex: dl.index,
        link: { from: dl.from, to: dl.to },
        problem: `links[${dl.index}] references non-existent ${missingParts.join(" and ")}.`,
        fix: `Either add the missing node(s) to concepts[]/knowledge[] or remove/fix links[${dl.index}].`
      });
    });

    concepts.forEach((c) => {
      const uiErrs = [];
      const parents = parentMap.get(c.id) || [];
      const children = childCount.get(c.id) || 0;

      if (c.id === domain.rootId && parents.length > 0) {
        uiErrs.push("Root Has C-Parent");
        diagnostics.push({
          code: "ROOT_HAS_CONCEPT_PARENT",
          nodeId: c.id,
          label: labelMap.get(c.id),
          problem: `Root concept "${c.id}" has incoming C->C link(s).`,
          fix: `Remove link(s) or change "rootId".`
        });
      }

      if (c.id !== domain.rootId && parents.length === 0) {
        uiErrs.push("Orphan Concept");
        diagnostics.push({
          code: "ORPHAN_CONCEPT",
          nodeId: c.id,
          label: labelMap.get(c.id),
          problem: `Non-root Concept "${c.id}" has 0 incoming C->C links.`,
          fix: `Add a parent C->C link in links[].`
        });
      }

      if (parents.length > 1) {
        uiErrs.push("Tree Violation (>1 C-Parent)");
        diagnostics.push({
          code: "MULTIPLE_CONCEPT_PARENTS",
          nodeId: c.id,
          label: labelMap.get(c.id),
          problem: `Concept "${c.id}" has ${parents.length} Concept parents.`,
          fix: `Keep only ONE C->C link pointing to "${c.id}".`
        });
      }

      if (inCycle.has(c.id)) {
        const cyclePath = inCycle.get(c.id);
        uiErrs.push("Cycle in C-Space");
        diagnostics.push({
          code: "CONCEPT_CYCLE_DETECTED",
          nodeId: c.id,
          label: labelMap.get(c.id),
          problem: `Concept "${c.id}" is part of a directed C->C loop (${cyclePath}).`,
          fix: `Break the loop (${cyclePath}) by removing the back-edge.`
        });
      }

      if (uiErrs.length > 0) {
        violations[c.id] = uiErrs;
      } else if (children === 0 && c.id !== domain.rootId) {
        leafIds.add(c.id);
      }
    });

    const warnings = [];
    if (concepts.length > 1 && crossSpaceLinkCount === 0) {
      warnings.push("Pure C-brainstorming so far (0 K<->C links between spaces).");
    }

    return { typedLinks, violations, diagnostics, leafIds, warnings };
  }
};

// ============================================================================
// LAYER 1B: CONSOLE REPORTER FOR LLM DEBUGGING PROMPTS
// ============================================================================
const CKReporter = {
  lastSignature: "",
  logToConsole(diagnostics, warnings, syntaxError = null) {
    const signature = syntaxError ? `SYNTAX:${syntaxError.message}` : JSON.stringify({ diagnostics, warnings });
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;

    if (syntaxError) {
      console.error("[C-K ENGINE LLM ERROR REPORT]\nSyntax Error: " + syntaxError.message);
      return;
    }

    if (diagnostics.length === 0) {
      console.info(`%c[C-K Validator] VALID MODEL — 0 violations.`, "color: #16a34a; font-weight: bold;");
      return;
    }

    const lines = [`[C-K MODEL VALIDATION ERRORS — ${diagnostics.length} ISSUE(S) FOUND]`];
    diagnostics.forEach((d, idx) => {
      const targetTag = d.nodeId ? `Node "${d.nodeId}"` : `Link #${d.linkIndex}`;
      lines.push(`${idx + 1}. [${d.code}] on ${targetTag}\n   - Problem: ${d.problem}\n   - Fix: ${d.fix}`);
    });

    console.group(`%c[C-K Validator] ${diagnostics.length} Violation(s)`, "color: #dc2626; font-weight: bold;");
    console.error(lines.join("\n"));
    console.groupEnd();
  }
};

// ============================================================================
// LAYER 2: COORDINATE STORE & WORLD-SPACE TWO-COLUMN LAYOUT
// ============================================================================
const COORD_STORAGE_KEY = "ck_world_positions_v3";

const PositionStore = {
  load() {
    try { return JSON.parse(localStorage.getItem(COORD_STORAGE_KEY)) || {}; } catch { return {}; }
  },
  save(id, pos) {
    const store = this.load();
    store[id] = { x: Math.round(pos.x), y: Math.round(pos.y) };
    localStorage.setItem(COORD_STORAGE_KEY, JSON.stringify(store));
  },
  clear() { localStorage.removeItem(COORD_STORAGE_KEY); }
};

const LayoutEngine = {
  compute(domain, savedPositions) {
    const coords = {};
    const concepts = Array.isArray(domain.concepts) ? domain.concepts : [];
    const knowledge = Array.isArray(domain.knowledge) ? domain.knowledge : [];
    const links = Array.isArray(domain.links) ? domain.links : [];

    const childrenMap = new Map();
    concepts.forEach((c) => childrenMap.set(c.id, []));
    links.forEach((l) => {
      if (childrenMap.has(l.from) && childrenMap.has(l.to)) childrenMap.get(l.from).push(l.to);
    });

    const depthMap = new Map();
    if (domain.rootId && childrenMap.has(domain.rootId)) {
      const queue = [{ id: domain.rootId, depth: 0 }];
      depthMap.set(domain.rootId, 0);
      while (queue.length > 0) {
        const curr = queue.shift();
        const kids = childrenMap.get(curr.id) || [];
        for (const childId of kids) {
          if (!depthMap.has(childId)) {
            depthMap.set(childId, curr.depth + 1);
            queue.push({ id: childId, depth: curr.depth + 1 });
          }
        }
      }
    }

    const levelCounts = new Map();
    concepts.forEach((c) => {
      if (savedPositions[c.id]) {
        coords[c.id] = savedPositions[c.id];
        return;
      }
      const d = depthMap.has(c.id) ? depthMap.get(c.id) : 0;
      const idxInLevel = levelCounts.get(d) || 0;
      levelCounts.set(d, idxInLevel + 1);
      coords[c.id] = { x: -260 - idxInLevel * 240, y: 100 + d * 130 };
    });

    knowledge.forEach((k, idx) => {
      if (savedPositions[k.id]) {
        coords[k.id] = savedPositions[k.id];
        return;
      }
      const col = idx % 2;
      const row = Math.floor(idx / 2);
      coords[k.id] = { x: 240 + col * 240, y: 100 + row * 120 };
    });

    return coords;
  }
};

// ============================================================================
// LAYER 3: FAST ZOOM CANVAS RENDERER, THEMING & FLOATING CONTROLS
// ============================================================================
const editorEl = document.getElementById("json-editor");
const statusEl = document.getElementById("status-bar");
const resetBtn = document.getElementById("reset-coords-btn");
const canvasWrapEl = document.getElementById("canvas-wrap");
const canvasEl = document.getElementById("ck-canvas");
const cColEl = document.querySelector(".c-col");

const LIGHT_STYLE = [
  { selector: "node", style: { "label": "data(displayLabel)", "text-wrap": "wrap", "text-max-width": "175px", "text-valign": "center", "text-halign": "center", "font-size": "12px", "shape": "round-rectangle", "width": 200, "height": 72, "border-width": 2, "color": "#0f172a", "background-color": "#eff6ff", "border-color": "#3b82f6" } },
  { selector: "node[?isRoot]", style: { "background-color": "#dbeafe", "border-color": "#1d4ed8", "border-width": 3, "font-weight": "bold" } },
  { selector: "node[?isLeaf]", style: { "shape": "barrel", "background-color": "#fffbeb", "border-color": "#d97706", "border-width": 3 } },
  { selector: 'node[space = "K"]', style: { "shape": "rectangle", "background-color": "#f0fdf4", "border-color": "#22c55e" } },
  { selector: "node[?hasViolation]", style: { "shape": "round-rectangle", "background-color": "#fef2f2", "border-color": "#ef4444", "border-width": 3 } },
  
  // Base Edge (C->C, K->K)
  { selector: "edge", style: { "width": 2, "curve-style": "bezier", "target-arrow-shape": "triangle", "line-color": "#64748b", "target-arrow-color": "#64748b" } },
  
  // KC: Knowledge -> Concept (Continuous line, Emerald)
  { selector: 'edge[operator = "KC"]', style: { "line-style": "solid", "line-color": "#059669", "target-arrow-color": "#059669", "target-arrow-shape": "triangle" } },
  
  // CK: Concept -> Knowledge (Dashed line, Fuchsia, Vee Arrow)
  { selector: 'edge[operator = "CK"]', style: { "line-style": "dashed", "line-color": "#d946ef", "target-arrow-color": "#d946ef", "target-arrow-shape": "vee" } }
];

const DARK_STYLE = [
  { selector: "node", style: { "label": "data(displayLabel)", "text-wrap": "wrap", "text-max-width": "175px", "text-valign": "center", "text-halign": "center", "font-size": "12px", "shape": "round-rectangle", "width": 200, "height": 72, "border-width": 2, "color": "#f5f5f5", "background-color": "#262626", "border-color": "#525252" } },
  { selector: "node[?isRoot]", style: { "background-color": "#333333", "border-color": "#737373", "border-width": 3, "font-weight": "bold" } },
  { selector: "node[?isLeaf]", style: { "shape": "barrel", "background-color": "#382e1c", "border-color": "#d97706", "border-width": 3 } },
  { selector: 'node[space = "K"]', style: { "shape": "rectangle", "background-color": "#1e3323", "border-color": "#22c55e" } },
  { selector: "node[?hasViolation]", style: { "shape": "round-rectangle", "background-color": "#451a1a", "border-color": "#ef4444", "border-width": 3 } },
  
  // Base Edge (C->C, K->K)
  { selector: "edge", style: { "width": 2, "curve-style": "bezier", "target-arrow-shape": "triangle", "line-color": "#737373", "target-arrow-color": "#737373" } },
  
  // KC: Knowledge -> Concept (Continuous line, Emerald)
  { selector: 'edge[operator = "KC"]', style: { "line-style": "solid", "line-color": "#10b981", "target-arrow-color": "#10b981", "target-arrow-shape": "triangle" } },
  
  // CK: Concept -> Knowledge (Dashed line, Fuchsia, Vee Arrow)
  { selector: 'edge[operator = "CK"]', style: { "line-style": "dashed", "line-color": "#e879f9", "target-arrow-color": "#e879f9", "target-arrow-shape": "vee" } }
];

let isDarkMode = true;

const cy = cytoscape({
  container: canvasEl,
  userPanningEnabled: true,
  userZoomingEnabled: true,
  boxSelectionEnabled: false,
  minZoom: 0.1,
  maxZoom: 4.0,
  wheelSensitivity: 2.5,
  pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
  style: DARK_STYLE
});

function applyTheme() {
  if (canvasWrapEl) {
    canvasWrapEl.style.backgroundColor = isDarkMode ? "#191919" : "#ffffff";
  }
  cy.style().fromJson(isDarkMode ? DARK_STYLE : LIGHT_STYLE).update();
}
applyTheme();

function zoomByFactor(factor) {
  const rect = canvasEl.getBoundingClientRect();
  const nextZoom = Math.max(cy.minZoom(), Math.min(cy.maxZoom(), cy.zoom() * factor));
  cy.zoom({
    level: nextZoom,
    renderedPosition: { x: rect.width / 2, y: rect.height / 2 }
  });
}

function fitAllNodes() {
  if (cy.elements().length > 0) cy.fit(cy.elements(), 60);
}

function setupZoomAndThemeControls() {
  let zoomInBtn = document.getElementById("zoom-in-btn");
  let zoomOutBtn = document.getElementById("zoom-out-btn");
  let fitBtn = document.getElementById("fit-btn") || document.getElementById("fit-all-btn");
  let themeBtn = document.getElementById("theme-toggle-btn");

  const controlsContainer = document.getElementById("zoom-controls");

  if (controlsContainer && !themeBtn) {
    themeBtn = document.createElement("button");
    themeBtn.id = "theme-toggle-btn";
    themeBtn.type = "button";
    themeBtn.textContent = isDarkMode ? "☀️ Light" : "🌙 Dark";
    themeBtn.title = "Toggle Dark/Light Mode";
    
    themeBtn.style.cssText = "margin-right: 8px; cursor: pointer; padding: 4px 8px;";
    controlsContainer.insertBefore(themeBtn, controlsContainer.firstChild);
  }

  if (themeBtn) {
    themeBtn.addEventListener("click", () => {
      isDarkMode = !isDarkMode;
      themeBtn.textContent = isDarkMode ? "☀️ Light" : "🌙 Dark";
      applyTheme();
    });
  }

  if (zoomInBtn) zoomInBtn.addEventListener("click", () => zoomByFactor(1.35));
  if (zoomOutBtn) zoomOutBtn.addEventListener("click", () => zoomByFactor(1 / 1.35));
  if (fitBtn) fitBtn.addEventListener("click", fitAllNodes);
}

function syncBackdropDivider() {
  if (!cColEl) return;
  const screenDividerX = cy.pan().x;
  const totalW = canvasEl.clientWidth || 1;
  const clampedPct = Math.max(0, Math.min(100, (screenDividerX / totalW) * 100));
  cColEl.style.flex = `0 0 ${clampedPct}%`;
}

cy.on("pan zoom resize", syncBackdropDivider);

cy.on("drag", "node", (evt) => {
  const node = evt.target;
  const pos = node.position();
  const margin = 120;
  if (node.data("space") === "C" && pos.x > -margin) {
    node.position("x", -margin);
  } else if (node.data("space") === "K" && pos.x < margin) {
    node.position("x", margin);
  }
});

cy.on("dragfree", "node", (evt) => {
  const node = evt.target;
  PositionStore.save(node.id(), node.position());
  if (statusEl) {
    statusEl.className = "";
    statusEl.textContent = `Saved "${node.id()}" coordinates.`;
  }
});

function syncDiagram(shouldFit = false) {
  try {
    const domain = JSON.parse(editorEl.value);
    const { typedLinks, violations, diagnostics, leafIds, warnings } = CKValidator.analyze(domain);

    CKReporter.logToConsole(diagnostics, warnings, null);

    const coords = LayoutEngine.compute(domain, PositionStore.load());
    const concepts = Array.isArray(domain.concepts) ? domain.concepts : [];
    const knowledge = Array.isArray(domain.knowledge) ? domain.knowledge : [];

    const elements = [
      ...concepts.map((c) => {
        const errs = violations[c.id];
        const isLeaf = leafIds.has(c.id);
        const isRoot = c.id === domain.rootId;
        const metaTag = c.partition ? ` (${c.partition})` : "";
        const tipBadge = isLeaf ? " ★ TIP" : "";

        return {
          data: {
            id: c.id,
            space: "C",
            isRoot,
            isLeaf,
            hasViolation: Boolean(errs),
            displayLabel: errs ? `${c.label}${metaTag}\n⚠ ${errs.join(", ")}` : `${c.label}${metaTag}${tipBadge}`
          },
          position: coords[c.id]
        };
      }),
      ...knowledge.map((k) => ({
        data: {
          id: k.id,
          space: "K",
          isRoot: false,
          isLeaf: false,
          hasViolation: false,
          displayLabel: `${k.label}\n[${k.status || "info"}]`
        },
        position: coords[k.id]
      })),
      ...typedLinks.map((l) => ({
        data: { id: l.id, source: l.from, target: l.to, operator: l.operator }
      }))
    ];

    cy.batch(() => {
      cy.elements().remove();
      cy.add(elements);
    });

    if (shouldFit) fitAllNodes();
    syncBackdropDivider();

    if (statusEl) {
      statusEl.className = "";
      if (diagnostics.length > 0) {
        statusEl.textContent = `Synced — ${diagnostics.length} issue(s) found (check Console).`;
      } else if (warnings.length > 0) {
        statusEl.textContent = `Valid C-Tree (${leafIds.size} tip[s]) — ${warnings[0]}`;
      } else {
        statusEl.textContent = `Synced — Valid (${leafIds.size} tip[s]).`;
      }
    }
  } catch (err) {
    CKReporter.logToConsole([], [], err);
    if (statusEl) {
      statusEl.className = "error";
      statusEl.textContent = "JSON Syntax Error: " + err.message;
    }
  }
}

// ============================================================================
// LAYER 4: COMPRESSION, TUPLE-PACKING & URL SYNC
// ============================================================================
const URLSync = {
  pack(domain, coords) {
    const c = (domain.concepts || []).map(n => [n.id, n.label || "", n.partition || ""]);
    const k = (domain.knowledge || []).map(n => [n.id, n.label || "", n.status || ""]);
    const l = (domain.links || []).map(n => [n.from, n.to]);
    const p = Object.keys(coords).map(id => [id, Math.round(coords[id].x), Math.round(coords[id].y)]);
    
    return [domain.rootId || "", c, k, l, p];
  },

  unpack(packed) {
    const [rootId, c, k, l, p] = packed;
    const domain = {
      rootId,
      concepts: c.map(n => ({ id: n[0], label: n[1], ...(n[2] ? { partition: n[2] } : {}) })),
      knowledge: k.map(n => ({ id: n[0], label: n[1], ...(n[2] ? { status: n[2] } : {}) })),
      links: l.map(n => ({ from: n[0], to: n[1] }))
    };
    const coords = {};
    p.forEach(n => { coords[n[0]] = { x: n[1], y: n[2] }; });
    return { domain, coords };
  },

  async compress(jsonString) {
    const stream = new Blob([jsonString]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    const buffer = await new Response(stream).arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const binString = Array.from(bytes, byte => String.fromCharCode(byte)).join("");
    return btoa(binString).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },

  async decompress(base64Str) {
    let b64 = base64Str.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const binString = atob(b64);
    const bytes = Uint8Array.from(binString, m => m.codePointAt(0));
    
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return await new Response(stream).text();
  },

  async exportToUrl() {
    try {
      if (statusEl) {
        statusEl.className = "";
        statusEl.textContent = "Compressing graph and coordinates...";
      }

      const domain = JSON.parse(editorEl.value);
      const coords = PositionStore.load();
      
      const packed = this.pack(domain, coords);
      const jsonStr = JSON.stringify(packed);
      const hash = await this.compress(jsonStr);

      const newUrl = window.location.pathname + window.location.search + "#" + hash;
      window.history.replaceState(null, "", newUrl);
      
      await navigator.clipboard.writeText(window.location.href);

      if (statusEl) {
        statusEl.className = "";
        statusEl.textContent = `Exported! URL copied to clipboard. (Packed size: ${hash.length} chars)`;
      }
    } catch (err) {
      console.error(err);
      if (statusEl) {
        statusEl.className = "error";
        statusEl.textContent = "Export Failed: " + err.message;
      }
    }
  },

  async loadFromUrl() {
    const hash = window.location.hash.substring(1);
    if (!hash) return false;

    try {
      const jsonStr = await this.decompress(hash);
      const packed = JSON.parse(jsonStr);
      const { domain, coords } = this.unpack(packed);

      if (editorEl) editorEl.value = JSON.stringify(domain, null, 2);

      PositionStore.clear();
      Object.entries(coords).forEach(([id, pos]) => PositionStore.save(id, pos));

      syncDiagram(true);

      if (statusEl) {
        statusEl.className = "";
        statusEl.textContent = "Loaded diagram and saved coordinates from URL!";
      }
      return true;
    } catch (err) {
      console.error("Failed to parse URL hash", err);
      if (statusEl) {
        statusEl.className = "error";
        statusEl.textContent = "Failed to load from URL. Hash might be corrupted.";
      }
      return false;
    }
  }
};

// ============================================================================
// EVENT LISTENERS & INITIALIZATION
// ============================================================================

if (editorEl) {
  editorEl.addEventListener("input", () => syncDiagram(false));
}

if (resetBtn) {
  resetBtn.addEventListener("click", () => {
    PositionStore.clear();
    syncDiagram(true);
    if (statusEl) statusEl.textContent = "Reset positions & fitted entire diagram.";
  });
}

window.addEventListener("resize", () => {
  cy.resize();
  syncBackdropDivider();
});

const exportBtn = document.getElementById("export");
if (exportBtn) {
  exportBtn.addEventListener("click", () => URLSync.exportToUrl());
}

window.addEventListener("DOMContentLoaded", async () => {
  setupZoomAndThemeControls();
  
  const loadedFromHash = await URLSync.loadFromUrl();
  if (!loadedFromHash) {
    syncDiagram(true);
  }
});
