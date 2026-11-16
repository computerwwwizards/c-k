// ============================================================================
// LAYER 0: URL COMPRESSION & TUPLE PACKING (The "Mermaid-style" Exporter)
// ============================================================================
const UrlCompressor = {
  // SCHEMA: [rootId, [concepts], [knowledge], [links]]
  // Concept Tuple: [id, label, partition, x, y]
  // Knowledge Tuple: [id, label, status, x, y]
  // Link Tuple: [from, to]

  async pack(domain, positions) {
    const cTuples = (domain.concepts ||).map(c => {
      const p = positions[c.id] || { x: 0, y: 0 };
      return [c.id, c.label, c.partition || "", Math.round(p.x), Math.round(p.y)];
    });

    const kTuples = (domain.knowledge ||).map(k => {
      const p = positions[k.id] || { x: 0, y: 0 };
      return [k.id, k.label, k.status || "", Math.round(p.x), Math.round(p.y)];
    });

    const lTuples = (domain.links ||).map(l => [l.from, l.to]);

    const minified = [domain.rootId, cTuples, kTuples, lTuples];
    const jsonStr = JSON.stringify(minified);

    // Native Browser Compression (Deflate-Raw + Base64URL)
    const stream = new Blob([jsonStr]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    const buffer = await new Response(stream).arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
    
    // Make URL-safe (replace +/ with -_ and strip =)
    return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },

  async unpack(hash) {
    try {
      // Restore Base64 padding and standard characters
      let base64 = hash.replace(/-/g, "+").replace(/_/g, "/");
      while (base64.length % 4) base64 += "=";

      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      const decompressed = await new Response(stream).json();

      // Rehydrate to Full JSON + Position Store
      const [rootId, cTuples, kTuples, lTuples] = decompressed;
      
      const domain = {
        rootId,
        concepts: cTuples.map(t => ({ id: t[0], label: t[1], partition: t[2] || undefined })),
        knowledge: kTuples.map(t => ({ id: t[0], label: t[1], status: t[2] || undefined })),
        links: lTuples.map(t => ({ from: t[0], to: t[1] }))
      };

      const positions = {};
      cTuples.forEach(t => positions[t[0]] = { x: t[3], y: t[4] });
      kTuples.forEach(t => positions[t[0]] = { x: t[3], y: t[4] });

      return { domain, positions };
    } catch (e) {
      console.error("URL Decode Failed:", e);
      return null;
    }
  }
};

// ============================================================================
// LAYER 1: PURE C-K VALIDATOR & OPERATOR INFERENCE
// ============================================================================
const CKValidator = {
  analyze(domain) {
    const concepts = Array.isArray(domain.concepts) ? domain.concepts :;
    const knowledge = Array.isArray(domain.knowledge) ? domain.knowledge :;
    const links = Array.isArray(domain.links) ? domain.links :;

    const spaceMap = new Map();
    concepts.forEach((c) => spaceMap.set(c.id, "C"));
    knowledge.forEach((k) => spaceMap.set(k.id, "K"));

    const parentCount = new Map();
    const childCount = new Map();
    const cAdjacency = new Map();
    concepts.forEach((c) => cAdjacency.set(c.id,));

    let crossSpaceLinkCount = 0;

    const typedLinks = links
      .filter((l) => spaceMap.has(l.from) && spaceMap.has(l.to))
      .map((link) => {
        const fromSpace = spaceMap.get(link.from);
        const toSpace = spaceMap.get(link.to);
        const operator = fromSpace + toSpace;

        if (operator === "CC") {
          parentCount.set(link.to, (parentCount.get(link.to) || 0) + 1);
          childCount.set(link.from, (childCount.get(link.from) || 0) + 1);
          cAdjacency.get(link.from).push(link.to);
        }
        if (operator === "KC" || operator === "CK") crossSpaceLinkCount++;

        return { id: `${link.from}->${link.to}`, from: link.from, to: link.to, operator };
      });

    // Cycle detection
    const state = new Map();
    const inCycle = new Set();
    function dfsCycle(nodeId, stack) {
      state.set(nodeId, 1);
      stack.push(nodeId);
      for (const nextId of cAdjacency.get(nodeId) ||) {
        const nextState = state.get(nextId) || 0;
        if (nextState === 0) dfsCycle(nextId, stack);
        else if (nextState === 1) {
          const loopStart = stack.indexOf(nextId);
          for (let i = loopStart; i < stack.length; i++) inCycle.add(stack[i]);
        }
      }
      stack.pop();
      state.set(nodeId, 2);
    }
    concepts.forEach((c) => { if (!state.get(c.id)) dfsCycle(c.id,); });

    const violations = {};
    const leafIds = new Set();
    const diagnostics =;

    concepts.forEach((c) => {
      const errs =;
      const parents = parentCount.get(c.id) || 0;
      const children = childCount.get(c.id) || 0;

      if (c.id === domain.rootId && parents > 0) errs.push("Root Cannot Have C-Parent");
      if (c.id !== domain.rootId && parents === 0) errs.push("Orphan Concept");
      if (parents > 1) errs.push("Tree Violation (>1 C-Parent)");
      if (inCycle.has(c.id)) errs.push("Cycle in C-Space");

      if (errs.length > 0) violations[c.id] = errs;
      else if (children === 0 && c.id !== domain.rootId) leafIds.add(c.id);
    });

    const warnings =;
    if (concepts.length > 1 && crossSpaceLinkCount === 0) warnings.push("Info: Pure C-brainstorming (no K-C links).");

    return { typedLinks, violations, leafIds, warnings, diagnostics };
  }
};

// ============================================================================
// LAYER 2: COORDINATE STORE & WORLD-SPACE LAYOUT
// ============================================================================
const COORD_STORAGE_KEY = "ck_world_positions_v3";

const PositionStore = {
  data: {}, // In-memory cache
  load() {
    if (Object.keys(this.data).length > 0) return this.data;
    try {
      this.data = JSON.parse(localStorage.getItem(COORD_STORAGE_KEY)) || {};
      return this.data;
    } catch { return {}; }
  },
  save(id, pos) {
    this.data[id] = { x: Math.round(pos.x), y: Math.round(pos.y) };
    localStorage.setItem(COORD_STORAGE_KEY, JSON.stringify(this.data));
  },
  import(newPositions) {
    this.data = newPositions;
    localStorage.setItem(COORD_STORAGE_KEY, JSON.stringify(this.data));
  },
  clear() {
    this.data = {};
    localStorage.removeItem(COORD_STORAGE_KEY);
  }
};

const LayoutEngine = {
  compute(domain, savedPositions) {
    const coords = {};
    const concepts = Array.isArray(domain.concepts) ? domain.concepts :;
    const knowledge = Array.isArray(domain.knowledge) ? domain.knowledge :;
    const links = Array.isArray(domain.links) ? domain.links :;

    const childrenMap = new Map();
    concepts.forEach((c) => childrenMap.set(c.id,));
    links.forEach((l) => {
      if (childrenMap.has(l.from) && childrenMap.has(l.to)) childrenMap.get(l.from).push(l.to);
    });

    const depthMap = new Map();
    if (domain.rootId) {
      const queue = [{ id: domain.rootId, depth: 0 }];
      depthMap.set(domain.rootId, 0);
      while (queue.length > 0) {
        const curr = queue.shift();
        for (const childId of childrenMap.get(curr.id) ||) {
          if (!depthMap.has(childId)) {
            depthMap.set(childId, curr.depth + 1);
            queue.push({ id: childId, depth: curr.depth + 1 });
          }
        }
      }
    }

    const levelCounts = new Map();
    concepts.forEach((c) => {
      if (savedPositions[c.id]) { coords[c.id] = savedPositions[c.id]; return; }
      const d = depthMap.get(c.id) || 0;
      const idx = levelCounts.get(d) || 0;
      levelCounts.set(d, idx + 1);
      coords[c.id] = { x: -260 - idx * 240, y: 100 + d * 130 };
    });

    knowledge.forEach((k, idx) => {
      if (savedPositions[k.id]) { coords[k.id] = savedPositions[k.id]; return; }
      coords[k.id] = { x: 240 + (idx % 2) * 240, y: 100 + Math.floor(idx / 2) * 120 };
    });

    return coords;
  }
};

// ============================================================================
// LAYER 3: RENDERER, UI & EXPORT LOGIC
// ============================================================================
const editorEl = document.getElementById("json-editor");
const statusEl = document.getElementById("status-bar");
const resetBtn = document.getElementById("reset-coords-btn");
const canvasWrapEl = document.getElementById("canvas-wrap");
const canvasEl = document.getElementById("ck-canvas");
const cColEl = document.querySelector(".c-col");

// Inject Export Button into Toolbar
const toolbar = document.getElementById("toolbar");
const exportBtn = document.createElement("button");
exportBtn.textContent = "🔗 Copy Link";
exportBtn.style.cssText = "margin-left: 8px; background: #8b5cf6; color: white;";
toolbar.appendChild(exportBtn);

const cy = cytoscape({
  container: canvasEl,
  userPanningEnabled: true,
  userZoomingEnabled: true,
  minZoom: 0.1,
  maxZoom: 4.0,
  wheelSensitivity: 1.0,
  pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
  style: [
    {
      selector: "node",
      style: {
        "label": "data(displayLabel)",
        "text-wrap": "wrap",
        "text-max-width": "175px",
        "text-valign": "center",
        "text-halign": "center",
        "font-size": "12px",
        "color": "#0f172a",
        "shape": "round-rectangle",
        "width": 200,
        "height": 72,
        "background-color": "#eff6ff",
        "border-width": 2,
        "border-color": "#3b82f6"
      }
    },
    { selector: "node[?isRoot]", style: { "background-color": "#dbeafe", "border-color": "#1d4ed8", "border-width": 3, "font-weight": "bold" } },
    { selector: "node[?isLeaf]", style: { "shape": "barrel", "background-color": "#fffbeb", "border-color": "#d97706", "border-width": 3 } },
    { selector: 'node[space = "K"]', style: { "shape": "rectangle", "background-color": "#f0fdf4", "border-color": "#22c55e" } },
    { selector: "node[?hasViolation]", style: { "shape": "round-rectangle", "background-color": "#fef2f2", "border-color": "#ef4444", "border-width": 3 } },
    { selector: "edge", style: { "width": 2, "curve-style": "bezier", "target-arrow-shape": "triangle", "line-color": "#64748b", "target-arrow-color": "#64748b" } },
    { selector: 'edge[operator = "KC"], edge[operator = "CK"]', style: { "line-style": "dashed", "line-color": "#9333ea", "target-arrow-color": "#9333ea" } }
  ]
});

// Floating Zoom Controls
(function setupControls() {
  if (document.getElementById("zoom-in-btn")) return;
  const bar = document.createElement("div");
  bar.style.cssText = "position:absolute;bottom:18px;right:18px;z-index:20;display:flex;gap:6px;background:#0f172a;padding:6px;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.2);";
  
  const btnCss = "background:#334155;color:#fff;border:none;padding:7px 12px;border-radius:5px;cursor:pointer;font-weight:700;";
  
  const zIn = document.createElement("button"); zIn.textContent = "+"; zIn.style.cssText = btnCss;
  const zOut = document.createElement("button"); zOut.textContent = "-"; zOut.style.cssText = btnCss;
  const fit = document.createElement("button"); fit.textContent = "Fit"; fit.style.cssText = btnCss + "background:#3b82f6;";

  zIn.onclick = () => { cy.zoom({ level: cy.zoom() * 1.35, renderedPosition: { x: cy.width()/2, y: cy.height()/2 } }); };
  zOut.onclick = () => { cy.zoom({ level: cy.zoom() / 1.35, renderedPosition: { x: cy.width()/2, y: cy.height()/2 } }); };
  fit.onclick = () => { cy.fit(undefined, 60); };

  bar.append(zIn, zOut, fit);
  canvasWrapEl.appendChild(bar);
})();

function syncBackdropDivider() {
  if (!cColEl) return;
  const pct = Math.max(0, Math.min(100, (cy.pan().x / canvasEl.clientWidth) * 100));
  cColEl.style.flex = `0 0 ${pct}%`;
}
cy.on("pan zoom resize", syncBackdropDivider);

cy.on("drag", "node", (evt) => {
  const node = evt.target;
  const margin = 120;
  if (node.data("space") === "C" && node.position("x") > -margin) node.position("x", -margin);
  if (node.data("space") === "K" && node.position("x") < margin) node.position("x", margin);
});

cy.on("dragfree", "node", (evt) => PositionStore.save(evt.target.id(), evt.target.position()));

// EXPORT HANDLER
exportBtn.addEventListener("click", async () => {
  try {
    const domain = JSON.parse(editorEl.value);
    const positions = PositionStore.load();
    const hash = await UrlCompressor.pack(domain, positions);
    
    // Update URL without reloading
    const newUrl = `${window.location.origin}${window.location.pathname}#ck=${hash}`;
    history.pushState(null, null, newUrl);
    
    await navigator.clipboard.writeText(newUrl);
    
    const prevText = exportBtn.textContent;
    exportBtn.textContent = "✅ Copied!";
    exportBtn.style.background = "#16a34a";
    setTimeout(() => {
      exportBtn.textContent = prevText;
      exportBtn.style.background = "#8b5cf6";
    }, 2000);
  } catch (err) {
    alert("Export failed: " + err.message);
  }
});

function syncDiagram(shouldFit = false) {
  try {
    const domain = JSON.parse(editorEl.value);
    const { typedLinks, violations, leafIds, warnings } = CKValidator.analyze(domain);
    const coords = LayoutEngine.compute(domain, PositionStore.load());

    const elements = [
      ...(domain.concepts ||).map(c => {
        const errs = violations[c.id];
        const isLeaf = leafIds.has(c.id);
        return {
          data: {
            id: c.id, space: "C", isRoot: c.id === domain.rootId, isLeaf, hasViolation: Boolean(errs),
            displayLabel: errs ? `${c.label}\n⚠ ${errs.join(", ")}` : `${c.label}${c.partition ? ` (${c.partition})` : ""}${isLeaf ? " ★ TIP" : ""}`
          },
          position: coords[c.id]
        };
      }),
      ...(domain.knowledge ||).map(k => ({
        data: { id: k.id, space: "K", displayLabel: `${k.label}\n[${k.status || "info"}]` },
        position: coords[k.id]
      })),
      ...typedLinks.map(l => ({ data: { id: l.id, source: l.from, target: l.to, operator: l.operator } }))
    ];

    cy.batch(() => { cy.elements().remove(); cy.add(elements); });

    if (shouldFit) cy.fit(undefined, 60);
    syncBackdropDivider();

    statusEl.className = "";
    if (Object.keys(violations).length > 0) statusEl.textContent = `Synced — ${Object.keys(violations).length} violation(s).`;
    else statusEl.textContent = `Synced — Valid (${leafIds.size} tip[s]).`;
  } catch (err) {
    statusEl.className = "error";
    statusEl.textContent = "JSON Error: " + err.message;
  }
}

editorEl.addEventListener("input", () => syncDiagram(false));
resetBtn.addEventListener("click", () => { PositionStore.clear(); syncDiagram(true); });

// IMPORT HANDLER (On Load)
(async function checkUrlHash() {
  const hash = window.location.hash;
  if (hash.startsWith("#ck=")) {
    try {
      const raw = hash.substring(4); // Remove '#ck='
      const data = await UrlCompressor.unpack(raw);
      if (data) {
        editorEl.value = JSON.stringify(data.domain, null, 2);
        PositionStore.import(data.positions);
        syncDiagram(true);
        statusEl.textContent = "Diagram loaded from URL!";
        // Clear hash so reload doesn't stick
        history.replaceState(null, null, window.location.pathname); 
      }
    } catch (err) {
      console.error("Import failed", err);
    }
  } else {
    // Initial load if no URL
    syncDiagram(true);
  }
})();
