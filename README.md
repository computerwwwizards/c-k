# c-k

A lightweight, JSON-driven diagramming tool for mapping ideas using **C-K Theory** (Concept-Knowledge Theory).

Define your root concept, partitions, knowledge items, and cross-space links in plain JSON on the left, and explore an interactive, movable C-K graph on the right.

---

## What This Project Is

* **A JSON-to-Diagram Editor:** Write and edit structured JSON to generate visual Concept-Knowledge graphs automatically.
* **An Interactive Canvas:** Drag, organize, zoom, and save custom node coordinates across separate **Concept Space (C)** and **Knowledge Space (K)** columns.
* **Built for Real C-K Mechanics:** Supports root tracking (`rootId`), concept partitions (`expansive` vs. `restrictive`), knowledge validation states (`validated` vs. `pending`), and orphan concept detection.
* **A Practical Thinking Tool:** Built for software engineers, designers, and researchers who want a fast, code-friendly way to map design explorations without drawing boxes manually.

## What This Project Is Not

* **Not an Official University or Consultancy Product:** This is an independent software project created from scratch.
* **Not a Full Academic Textbook:** While the layout supports C-K structures and cross-space links, it does not teach the methodology or enforce strict corporate workshop rules.
* **Not Pre-Loaded with Copyrighted Case Studies:** All included sample diagrams and JSON templates are original examples created specifically for this repository.

---

## Quick Start

1. Clone the repository:
   ```bash
   git clone https://github.com
   cd c-k
   ```
2. Open or run the application *(replace with your exact run command, e.g., open `index.html` in your browser or run `npm install && npm run dev`)*.
3. Paste or edit your C-K JSON in the left panel to update the diagram live.
4. Drag nodes on the canvas to refine your layout, or click **Reset Layout** / **Fit All** to reorganize the view.

---

## JSON Schema & Example

Your diagram is driven by four top-level properties:

* `rootId`: The starting concept ID (e.g., `"c0"`).
* `concepts`: Array of Concept Space nodes (`id`, `label`, and optional `partition` set to `"expansive"` or `"restrictive"`).
* `knowledge`: Array of Knowledge Space nodes (`id`, `label`, and `status` such as `"validated"` or `"pending"`).
* `links`: Directional connections (`from` and `to`) representing C→C, C→K, K→C, and K→K operators.

```json
{
  "rootId": "c0",
  "concepts": [
    { "id": "c0", "label": "C0: Zero-footprint urban transport" },
    { "id": "c1", "label": "C1: Foldable bike-tent", "partition": "expansive" },
    { "id": "c2", "label": "C2: Autonomous micro-pod", "partition": "restrictive" },
    { "id": "c3", "label": "C3: Self-inflating airframe", "partition": "expansive" },
    { "id": "c4", "label": "C4: Solar fabric canopy", "partition": "expansive" },
    { "id": "c5", "label": "C5: Modular battery swap", "partition": "restrictive" },
    { "id": "c6", "label": "C6: Sidewalk platoon mode", "partition": "expansive" },
    { "id": "c7", "label": "C7: Orphan drone idea", "partition": "restrictive" }
  ],
  "knowledge": [
    { "id": "k1", "label": "K1: Carbon hinge tolerances", "status": "validated" },
    { "id": "k2", "label": "K2: Drop-stitch pneumatic stiffness", "status": "validated" },
    { "id": "k3", "label": "K3: Flexible perovskite solar yield", "status": "pending" },
    { "id": "k4", "label": "K4: EU micro-mobility width laws", "status": "validated" }
  ],
  "links": [
    { "from": "c0", "to": "c1" },
    { "from": "c0", "to": "c2" },
    { "from": "c1", "to": "c3" },
    { "from": "c1", "to": "c4" },
    { "from": "c2", "to": "c5" },
    { "from": "c5", "to": "c6" },
    { "from": "k1", "to": "c1" },
    { "from": "k2", "to": "c3" },
    { "from": "c4", "to": "k3" },
    { "from": "k4", "to": "c6" }
  ]
}
```

---

## Attribution & Legal Disclaimer

* **Methodology Credit:** C-K Theory (Concept-Knowledge Theory) is an academic design theory originally formulated by Armand Hatchuel and Benoît Weil at Mines Paris - PSL. Reference to "C-K" or "Concept-Knowledge" in this repository is strictly descriptive of the underlying public scientific methodology.
* **No Affiliation or Endorsement:** This project is completely independent and is **not** affiliated with, sponsored by, or endorsed by Mines Paris - PSL, its researchers, or any commercial innovation consultancy.
* **Original Content:** All source code, user interface layouts, and default example diagrams in this repository are original works by the project author(s). Users are responsible for ensuring they have the rights to any third-party text or diagrams they import into the tool.

---

## License

Distributed under the **MIT License**. See `LICENSE` for more information.
