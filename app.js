// ============================================================================
// 1. URL COMPRESSION (The "Share Link" Logic)
// ============================================================================
const UrlCompressor = {
  // Packs the domain + positions into a compressed Base64 string
  async pack(domain, positions) {
    // Helper to safely get arrays
    const getArr = (arr) => Array.isArray(arr) ? arr : [];

    // Minify Concepts: [id, label, partition, x, y]
    const cTuples = getArr(domain.concepts).map(c => {
      const p = positions[c.id] || { x: 0, y: 0 };
      return [c.id, c.label, c.partition || "", Math.round(p.x), Math.round(p.y)];
    });

    // Minify Knowledge: [id, label, status, x, y]
    const kTuples = getArr(domain.knowledge).map(k => {
      const p = positions[k.id] || { x: 0, y: 0 };
      return [k.id, k.label, k.status || "", Math.round(p.x), Math.round(p.y)];
    });

    // Minify Links: [from, to]
    const lTuples = getArr(domain.links).map(l => [l.from, l.to]);

    // Structure: [RootID, Concepts, Knowledge, Links]
    const minified = [domain.rootId, cTuples, kTuples, lTuples];
    const jsonStr = JSON.stringify(minified);

    // Browser-native compression (Deflate + Base64)
    const stream = new Blob([jsonStr]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    const buffer = await new Response(stream).arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
    
    // Make URL-safe (replace +/ with -_)
    return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },

  // Unpacks the string back into JSON + Positions
  async unpack(hash) {
    try {
      let base64 = hash.replace(/-/g, "+").replace(/_/g, "/");
      while (base64.length % 4) base64 += "=";

      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      const decompressed = await new Response(stream).json();

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
      console.error("Decode Failed:", e);
      return null;
    }
  }
};

// ============================================================================
// 2. LOGIC & VALIDATION (The Brains)
// ============================================================================
const CKValidator = {
  analyze(domain) {
    const concepts = Array.isArray(domain.concepts) ? domain.concepts : [];
    const knowledge = Array.isArray(domain.knowledge) ? domain.knowledge : [];
    const links = Array.isArray(domain.links) ? domain.links : [];

    const spaceMap = new Map();
    concepts.forEach(c => spaceMap.set(c.id, "C"));
    knowledge.forEach(k => spaceMap.set(k.id, "K"));

    const parentCount = new Map();
    const childCount = new Map();
    const cAdjacency = new Map();
    concepts.forEach(c => cAdjacency.set(c.id, []));

    const typedLinks = links
      .filter(l => spaceMap.has(l.from) && spaceMap.has(l.to))
      .map(link => {
        const fromSpace = spaceMap.get(link.from);
        const toSpace = spaceMap.get(link.to);
        const operator = fromSpace + toSpace;

        if (operator === "CC") {
          parentCount.set(link.to, (parentCount.get(link.to) || 0) + 1);
          childCount.set(link.from, (childCount.get(link.from) || 0) + 1);
          cAdjacency.get(link.from).push(link.to);
        }

        return { id: `${link.from}->${link.to}`, from: link.from, to: link.to, operator };
      });

    // Cycle Detection
    const state = new Map(); // 0:unvisited, 1:visiting, 2:visited
    const inCycle = new Set();
    
    function dfsCycle(nodeId, stack) {
      state.set(nodeId, 1);
      stack.push(nodeId);
      
      const neighbors = cAdjacency.get(nodeId) || [];
      for (const nextId of neighbors) {
        const nextState = state.get(nextId) || 0;
        if (nextState === 0) {
          dfsCycle(nextId, stack);
        } else if (nextState === 1) {
          // Cycle found
          const loopStart = stack.indexOf(nextId);
          for (let i = loopStart; i < stack.length; i++) inCycle.add(stack[i]);
        }
      }
      stack.pop();
      state.set(nodeId, 2);
    }
    
    concepts.forEach(c => {
      if (!state.get(c.id)) dfsCycle(c.id, []);
    });

    const violations = {};
    const leafIds = new Set();

    concepts.forEach(c => {
      const errs = [];
      const parents = parentCount.get(c.id) || 0;
      const children = childCount.get(c.id) || 0;

      if (c.id === domain.rootId && parents > 0) errs.push("Root cannot have C-Parent");
      if (c.id !== domain.rootId && parents === 0) errs.push("Orphan Concept");
      if (parents > 1) errs.push("Tree Violation (>1 Parent)");
      if (inCycle.has(c.id)) errs.push("Cycle Detected");

      if (errs.length > 0) violations[c.id] = errs;
      else if (children === 0 && c.id !== domain.rootId) leafIds.add(c.id);
    });

    return { typedLinks, violations, leafIds };
  }
};

// ============================================================================
// 3. LAYOUT & STORAGE (The Positioning System)
// ============================================================================
const COORD_KEY = "ck_coords_v4";

const PositionStore = {
  data: {},
  load() {
    if (Object.keys(this.data).length > 0) return this.data;
    try {
      this.data = JSON.parse(localStorage.getItem(COORD_KEY)) || {};
      return this.data;
    } catch { return {}; }
  },
  save(id, pos) {
    this.data[id] = { x: Math.round(pos.x), y: Math.round(pos.y) };
    localStorage.setItem(COORD_KEY, JSON.stringify(this.data));
  },
  import(newPositions) {
    this.data = newPositions;
    localStorage.setItem(COORD_KEY, JSON.stringify(this.data));
  },
  clear() {
    this.data = {};
    localStorage.removeItem(COORD_KEY);
  }
};

const LayoutEngine = {
  compute(domain, savedPositions) {
    const coords = {};
    const concepts = Array.isArray(domain.concepts) ? domain.concepts : [];
    const knowledge = Array.isArray(domain.knowledge) ? domain.knowledge : [];
    const links = Array.isArray(domain.links) ? domain.links : [];

    // Calculate depth for auto-layout
    const childrenMap = new Map();
    links.forEach(l => {
      if (!childrenMap.has(l.from)) childrenMap.set(l.from, []);
      childrenMap.get(l.from).push(l.to);
    });

    const depthMap = new Map();
    if (domain.rootId) {
      const queue = [{ id: domain.rootId, depth: 0 }];
      depthMap.set(domain.rootId, 0);
      
      while (queue.length > 0) {
        const curr = queue.shift();
        const kids = childrenMap.get(curr.id) || [];
        kids.forEach(kidId => {
          if (!depthMap.has(kidId)) {
            depthMap.set(kidId, curr.depth + 1);
            queue.push({ id: kidId, depth: curr.depth + 1 });
          }
        });
      }
    }

    const levelCounts = new Map();

    // Assign Concept Positions
    concepts.forEach(c => {
      if (savedPositions[c.id]) {
        coords[c.id] = savedPositions[c.id];
      } else {
        const d = depthMap.get(c.id) || 0;
        const idx = levelCounts.get(d) || 0;
        levelCounts.set(d, idx + 1);
        // "C" nodes go on the LEFT (negative X)
        coords[c.id] = { x: -250 - (idx * 220), y: 100 + (d * 140) };
      }
    });

    // Assign Knowledge Positions
    knowledge.forEach((k, idx) => {
      if (savedPositions[k.id]) {
        coords[k.id] = savedPositions[k.id];
      } else {
        // "K" nodes go on the RIGHT (positive X)
        coords[k.id] = { x: 250 + ((idx % 3) * 220), y: 100 + (Math.floor(idx / 3) * 140) };
      }
    });

    return coords;
  }
};

// ============================================================================
// 4. UI INITIALIZATION (The Glue)
// ============================================================================
const editorEl = document.getElementById("json-editor");
const statusEl = document.getElementById("status-bar");
const resetBtn = document.getElementById("reset-coords-btn");
const canvasEl = document.getElementById("ck-canvas");
const canvasWrapEl = document.getElementById("canvas-wrap");
const cColEl = document.querySelector(".c-col"); // The blue backdrop

// Add Export Button to Toolbar
const toolbar = document.getElementById("toolbar");
if (!document.getElementById("export-btn")) {
  const btn = document.createElement("button");
  btn.id = "export-btn";
  btn.textContent = "🔗 Copy Link";
  btn.style.cssText = "margin-left: 10px; background: #8b5cf6; color: white; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer;";
  toolbar.appendChild(btn);
  
  btn.addEventListener("click", async () => {
    try {
      const domain = JSON.parse(editorEl.value);
      const positions = PositionStore.load();
      const hash = await UrlCompressor.pack(domain, positions);
      
      const newUrl = `${window.location.origin}${window.location.pathname}#ck=${hash}`;
      history.pushState(null, null, newUrl);
      await navigator.clipboard.writeText(newUrl);
      
      const oldText = btn.textContent;
      btn.textContent = "✅ Copied!";
      btn.style.background = "#22c55e";
      setTimeout(() => { btn.textContent = oldText; btn.style.background = "#8b5cf6"; }, 2000);
    } catch (e) {
      alert("Error exporting: " + e.message);
    }
  });
}

// Cytoscape Setup
const cy = cytoscape({
  container: canvasEl,
  minZoom: 0.1,
  maxZoom: 3.0,
  wheelSensitivity: 0.4,
  style: [
    {
      selector: "node",
      style: {
        "label": "data(displayLabel)",
        "text-wrap": "wrap",
        "text-max-width": "180px",
        "text-valign": "center",
        "text-halign": "center",
        "font-size": "12px",
        "color": "#1e293b",
        "shape": "round-rectangle",
        "width": 200,
        "height": 70,
        "background-color": "#eff6ff",
        "border-width": 2,
        "border-color": "#60a5fa"
      }
    },
    { selector: "node[?isRoot]", style: { "background-color": "#dbeafe", "border-width": 4, "border-color": "#2563eb", "font-weight": "bold" } },
    { selector: "node[space='K']", style: { "background-color": "#f0fdf4", "border-color": "#4ade80", "shape": "cut-rectangle" } },
    { selector: "node[?hasViolation]", style: { "background-color": "#fef2f2", "border-color": "#ef4444", "border-width": 3 } },
    { selector: "edge", style: { "width": 2, "curve-style": "bezier", "target-arrow-shape": "triangle", "line-color": "#94a3b8", "target-arrow-color": "#94a3b8" } },
    { selector: "edge[operator='KC'], edge[operator='CK']", style: { "line-style": "dashed", "line-color": "#a855f7", "target-arrow-color": "#a855f7" } }
  ]
});

// Zoom Controls
(function addZoomControls() {
  if (document.getElementById("zoom-controls")) return;
  const div = document.createElement("div");
  div.id = "zoom-controls";
  div.style.cssText = "position:absolute; bottom:20px; right:20px; display:flex; gap:5px; z-index:100;";
  
  const mkBtn = (txt, fn) => {
    const b = document.createElement("button");
    b.textContent = txt;
    b.onclick = fn;
    b.style.cssText = "width:30px; height:30px; background:#334155; color:white; border:none; border-radius:4px; cursor:pointer; font-weight:bold;";
    return b;
  };

  div.append(
    mkBtn("+", () => cy.zoom({ level: cy.zoom() * 1.2, renderedPosition: { x: cy.width()/2, y: cy.height()/2 } })),
    mkBtn("-", () => cy.zoom({ level: cy.zoom() / 1.2, renderedPosition: { x: cy.width()/2, y: cy.height()/2 } })),
    mkBtn("Fit", () => cy.fit(undefined, 50))
  );
  canvasWrapEl.appendChild(div);
})();

// Sync Logic
function syncDiagram(shouldFit = false) {
  try {
    const jsonStr = editorEl.value.trim();
    if (!jsonStr) return; // Don't parse empty string

    const domain = JSON.parse(jsonStr);
    const { typedLinks, violations, leafIds } = CKValidator.analyze(domain);
    const coords = LayoutEngine.compute(domain, PositionStore.load());

    const elements = [];

    // Add Concepts
    (Array.isArray(domain.concepts) ? domain.concepts : []).forEach(c => {
      const errs = violations[c.id];
      const isLeaf = leafIds.has(c.id);
      let label = c.label;
      if (c.partition) label += `\n(${c.partition})`;
      if (errs) label += `\n⚠ ${errs.join(", ")}`;
      else if (isLeaf) label += `\n★ Tip`;

      elements.push({
        data: {
          id: c.id,
          space: "C",
          isRoot: c.id === domain.rootId,
          hasViolation: !!errs,
          displayLabel: label
        },
        position: coords[c.id]
      });
    });

    // Add Knowledge
    (Array.isArray(domain.knowledge) ? domain.knowledge : []).forEach(k => {
      elements.push({
        data: {
          id: k.id,
          space: "K",
          displayLabel: `${k.label}\n[${k.status || "info"}]`
        },
        position: coords[k.id]
      });
    });

    // Add Links
    typedLinks.forEach(l => {
      elements.push({
        data: { id: l.id, source: l.from, target: l.to, operator: l.operator }
      });
    });

    cy.batch(() => {
      cy.elements().remove();
      cy.add(elements);
    });

    if (shouldFit) cy.fit(undefined, 50);
    updateBackdrop();

    const errCount = Object.keys(violations).length;
    statusEl.textContent = errCount > 0 
      ? `Synced with ${errCount} violation(s).` 
      : "Synced and Valid.";
    statusEl.className = errCount > 0 ? "error" : "";

  } catch (err) {
    statusEl.textContent = "JSON Syntax Error";
    statusEl.className = "error";
  }
}

// Backdrop Sync
function updateBackdrop() {
  if (!cColEl) return;
  const panX = cy.pan().x;
  // Simple heuristic: map panX to percentage for the split bg
  const pct = Math.max(0, Math.min(100, (panX / canvasEl.clientWidth) * 100));
  cColEl.style.flex = `0 0 ${pct}%`;
}

// Event Listeners
cy.on("pan zoom", updateBackdrop);
cy.on("dragfree", "node", (e) => PositionStore.save(e.target.id(), e.target.position()));

editorEl.addEventListener("input", () => syncDiagram(false));
resetBtn.addEventListener("click", () => { PositionStore.clear(); syncDiagram(true); });

// ============================================================================
// 5. BOOTSTRAP (Load Data)
// ============================================================================
(async function init() {
  const hash = window.location.hash;
  
  if (hash.startsWith("#ck=")) {
    // 1. Load from URL Share Link
    const raw = hash.substring(4);
    const result = await UrlCompressor.unpack(raw);
    if (result) {
      editorEl.value = JSON.stringify(result.domain, null, 2);
      PositionStore.import(result.positions);
      statusEl.textContent = "Loaded from shared link.";
    }
  } 
  // 2. Otherwise: We do nothing.
  // The app will read whatever text is currently inside the HTML <textarea>
  
  syncDiagram(true);
})();
