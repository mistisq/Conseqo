(() => {
  "use strict";

  const STORAGE_KEY = "conseqo-state-v1";
  const AI_API_ENDPOINT = "https://conseqo-api.workers.dev/generate";
  const INVOICE_API_ENDPOINT = "https://conseqo-api.workers.dev/invoice";
  const DEMO_CHECKOUT_ENABLED = true;
  const PRO_KEY = "conseqo_pro";
  const FREE_DEPTH_LIMIT = 10;
  const NODE_WIDTH = 246;
  const ROOT_WIDTH = 290;
  const NODE_GAP_X = 30;

  const $ = (selector, scope = document) => scope.querySelector(selector);
  const state = loadState();
  const elements = {
    welcome: $("#welcome"), workspace: $("#workspace"), form: $("#scenario-form"),
    input: $("#scenario-input"), title: $("#tree-title"), viewport: $("#canvas-viewport"),
    world: $("#canvas-world"), nodes: $("#tree-nodes"), connections: $("#connections"),
    count: $("#node-count"), zoom: $(".zoom-value"), modal: $("#upgrade-modal"),
    toast: $("#toast"), tierLabel: $("[data-tier-label]"), emptyHint: $("#canvas-empty-hint")
  };

  let toastTimeout = 0;
  let pointers = new Map();
  let dragOrigin = null;
  let pinchOrigin = null;
  let view = { x: 0, y: 0, scale: 1 };
  let tree = null;

  function loadState() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      return { isPro: localStorage.getItem(PRO_KEY) === "true" || stored.isPro === true, trees: Array.isArray(stored.trees) ? stored.trees.slice(0, 10) : [], activeTreeId: typeof stored.activeTreeId === "string" ? stored.activeTreeId : null };
    } catch (error) {
      console.warn("Could not restore Conseqo state.", error);
      return { isPro: false, trees: [], activeTreeId: null };
    }
  }

  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); localStorage.setItem(PRO_KEY, state.isPro ? "true" : "false"); }
    catch (error) { console.warn("Could not save Conseqo state.", error); showToast("Your browser could not save this session."); }
    updateTier();
  }

  function updateTier() {
    elements.tierLabel.textContent = state.isPro ? "Pro" : "Free";
    const pill = $(".tier-pill");
    pill.setAttribute("aria-label", state.isPro ? "Pro plan active" : "Free plan. View Pro upgrade");
    pill.classList.toggle("is-pro", state.isPro);
  }

  function initTelegram() {
    const telegram = window.Telegram && window.Telegram.WebApp;
    if (!telegram) return;
    try {
      telegram.ready(); telegram.expand();
      const theme = telegram.themeParams;
      if (theme) {
        if (theme.bg_color) document.documentElement.style.setProperty("--bg", theme.bg_color);
        if (theme.text_color) document.documentElement.style.setProperty("--text", theme.text_color);
        if (theme.hint_color) document.documentElement.style.setProperty("--muted", theme.hint_color);
      }
    } catch (error) { console.info("Telegram WebApp initialization unavailable; browser mode active.", error); }
  }

  function createId() { return "node-" + Math.random().toString(36).slice(2, 10); }
  function cleanText(value, max = 180) { return String(value || "").replace(/\s+/g, " ").trim().slice(0, max); }

  function makeNode({ title, description, depth, kind = "choice", risk = "Medium", likelihood = "Possible", parentId = null, children = [], branchIndex = 0 }) {
    return { id: createId(), title, description, depth, kind, risk, likelihood, parentId, children, expanded: false, branchIndex };
  }

  function createTree(prompt) {
    const root = makeNode({ title: cleanText(prompt, 180), description: "Your starting point. Choose a direction to explore how this situation could unfold.", depth: 0, kind: "root", risk: "Starting point", likelihood: "Scenario" });
    return { id: createId(), prompt: cleanText(prompt, 180), rootId: root.id, nodes: [root], createdAt: Date.now() };
  }

  // Simulation is isolated so a future API adapter can replace it without changing UI logic.
  function simulateRootChoices(prompt) {
    return [
      { title: "Take the bold step", description: "Commit to the change and give the new direction a genuine chance. Momentum may open opportunities you cannot see yet.", risk: "High", likelihood: "Uncertain" },
      { title: "Test it on a small scale", description: "Run a limited experiment first. Gather evidence, protect your options, and learn before making a larger commitment.", risk: "Low", likelihood: "Promising" },
      { title: "Pause and gather clarity", description: "Take time to compare priorities, talk to people you trust, and identify what would make the decision feel right.", risk: "Medium", likelihood: "Steady" }
    ];
  }

  function simulateConsequences(parent, prompt) {
    const templates = [
      [
        { title: "Early momentum builds", description: "The first visible results create energy. You discover which parts of the plan work and where support is needed.", risk: "Medium", likelihood: "Promising" },
        { title: "A new constraint appears", description: "Time, resources, or competing priorities make the next step harder. Adjusting the pace helps keep the plan sustainable.", risk: "High", likelihood: "Possible" },
        { title: "An unexpected opportunity opens", description: "A useful connection or new option appears once you are in motion. You can decide whether it fits your original goal.", risk: "Low", likelihood: "Possible" }
      ],
      [
        { title: "The experiment gives a clear signal", description: "A small test reveals what people respond to and which assumptions need another look before you invest more.", risk: "Low", likelihood: "Promising" },
        { title: "You find a better version", description: "Feedback points toward a simpler approach. Refining the idea makes the next decision more grounded.", risk: "Low", likelihood: "Likely" },
        { title: "The signal stays mixed", description: "Results are inconclusive. A second, more focused test may help separate a timing issue from a deeper mismatch.", risk: "Medium", likelihood: "Possible" }
      ],
      [
        { title: "Your priorities become clearer", description: "A little distance helps you separate outside expectations from what matters most to you.", risk: "Low", likelihood: "Promising" },
        { title: "Waiting has a trade-off", description: "The situation continues to evolve while you consider it. Set a review point so reflection does not become an indefinite delay.", risk: "Medium", likelihood: "Possible" },
        { title: "A conversation changes the picture", description: "Someone offers information or a perspective you had not considered. Your available choices become more specific.", risk: "Low", likelihood: "Possible" }
      ]
    ];
    const index = parent.branchIndex % templates.length;
    return templates[index];
  }

  async function generateNextNodes({ prompt, parent, isRoot }) {
    if (AI_API_ENDPOINT && !/placeholder|example|workers.dev\\/generate$/i.test(AI_API_ENDPOINT)) {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 4500);
      try {
        const response = await fetch(AI_API_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scenario: prompt, parent: { title: parent.title, description: parent.description, depth: parent.depth }, isRoot }), signal: controller.signal });
        if (response.ok) { const payload = await response.json(); if (Array.isArray(payload.choices) && payload.choices.length >= 2) return payload.choices.slice(0, 3); }
      } catch (error) { console.info("AI endpoint unavailable; using simulated outcomes.", error); }
      finally { clearTimeout(timeout); }
    }
    return isRoot ? simulateRootChoices(prompt) : simulateConsequences(parent, prompt);
  }
  function simulateNextChoices(node, prompt) {
    return generateNextNodes({ prompt, parent: node, isRoot: false }).then(outcomes => outcomes.map((outcome, index) => makeNode({ ...outcome, depth: node.depth + 1, parentId: node.id, branchIndex: index })));
  }

  function getNode(id) { return tree && tree.nodes.find(node => node.id === id); }

  async function expandNode(nodeId) {
    const node = getNode(nodeId);
    if (!node || node.kind === "root" || node.expanded) return;
    if (!state.isPro && node.depth >= FREE_DEPTH_LIMIT) { openUpgrade(); return; }
    pendingExpansions.add(nodeId); $("#generation-overlay").classList.remove("hidden");
    try { const children = await simulateNextChoices(node, tree.prompt); node.expanded = true; node.children = children.map(child => child.id); tree.nodes.push(...children); persistActiveTree(); renderTree(); showToast("New possibilities added to your map."); }
    catch (error) { console.error("Branch generation failed.", error); showToast("Could not generate paths. Please try again."); }
    finally { pendingExpansions.delete(nodeId); $("#generation-overlay").classList.add("hidden"); }
  }

  function persistActiveTree() {
    if (!tree) return;
    const index = state.trees.findIndex(item => item.id === tree.id);
    if (index >= 0) state.trees[index] = tree;
    else state.trees.unshift(tree);
    state.trees = state.trees.slice(0, state.isPro ? 10 : 2);
    state.activeTreeId = tree.id;
    saveState();
  }

  function buildNodeElement(node) {
    const element = document.createElement(node.kind === "root" ? "article" : "button");
    element.className = "tree-node " + (node.kind === "root" ? "root-node" : "choice-node") + (node.fresh ? " is-new" : "");
    element.style.left = node.x + "px"; element.style.top = node.y + "px";
    element.dataset.nodeId = node.id;
    if (node.kind !== "root") {
      element.type = "button"; element.dataset.action = "expand-node";
      element.setAttribute("aria-label", node.expanded ? node.title + ", expanded" : "Explore: " + node.title);
      if (node.expanded) element.classList.add("selected");
    }
    const top = document.createElement("div"); top.className = "node-topline";
    const kind = document.createElement("span"); kind.className = "node-kind"; kind.textContent = node.kind === "root" ? "YOUR SCENARIO" : "POSSIBLE OUTCOME";
    const depth = document.createElement("span"); depth.className = "node-depth"; depth.textContent = node.kind === "root" ? "START" : "LEVEL " + node.depth;
    top.append(kind, depth);
    const title = document.createElement("h3"); title.className = "node-title"; title.textContent = node.title;
    const description = document.createElement("p"); description.className = "node-description"; description.textContent = node.description;
    element.append(top, title, description);
    if (node.kind !== "root") {
      const meta = document.createElement("div"); meta.className = "node-meta";
      const risk = document.createElement("span"); risk.className = "node-tag risk-" + node.risk.toLowerCase(); risk.textContent = "Risk: " + node.risk;
      const likelihood = document.createElement("span"); likelihood.className = "node-tag"; likelihood.textContent = node.likelihood;
      meta.append(risk, likelihood); element.append(meta);
      const expand = document.createElement("div"); expand.className = "node-expand";
      const label = document.createElement("span"); label.textContent = node.expanded ? "Explore the next level" : "Explore this outcome";
      const icon = document.createElement("span"); icon.className = "expand-icon"; icon.textContent = node.expanded ? "↗" : "+";
      expand.append(label, icon); element.append(expand);
      if (node.children.length) {
        const childCount = document.createElement("div"); childCount.className = "node-children"; childCount.textContent = node.children.length + " paths revealed"; element.append(childCount);
      }
    } else {
      const meta = document.createElement("div"); meta.className = "node-meta";
      const tag = document.createElement("span"); tag.className = "node-tag risk-low"; tag.textContent = "Decision starting point"; meta.append(tag); element.append(meta);
    }
    return element;
  }

  function layoutTree() {
    const root = getNode(tree.rootId);
    if (!root) return { width: 0, height: 0 };
    const positions = new Map();
    const columnX = depth => depth === 0 ? 0 : ROOT_WIDTH + NODE_GAP_X + (depth - 1) * (NODE_WIDTH + NODE_GAP_X);
    let leafY = 0;
    function position(node, depth) {
      const children = node.children.map(getNode).filter(Boolean);
      if (!children.length) {
        const y = leafY;
        leafY += 205;
        positions.set(node.id, { x: columnX(depth), y, width: NODE_WIDTH, height: 160 });
        return y + 80;
      }
      const centers = children.map(child => position(child, depth + 1));
      const center = (Math.min(...centers) + Math.max(...centers)) / 2;
      const y = center - 75;
      positions.set(node.id, { x: columnX(depth), y, width: depth === 0 ? ROOT_WIDTH : NODE_WIDTH, height: 160 });
      return center;
    }
    position(root, 0);
    tree.nodes.forEach(node => { const p = positions.get(node.id); if (p) Object.assign(node, p); });
    return { width: Math.max(...tree.nodes.map(n => n.x + n.width)) + 100, height: Math.max(...tree.nodes.map(n => n.y + n.height)) + 100 };
  }

  function renderTree() {
    if (!tree) return;
    elements.nodes.replaceChildren();
    const bounds = layoutTree();
    tree.nodes.forEach(node => { elements.nodes.append(buildNodeElement(node)); node.fresh = false; });
    elements.connections.replaceChildren();
    elements.connections.setAttribute("width", String(bounds.width));
    elements.connections.setAttribute("height", String(bounds.height));
    elements.connections.setAttribute("viewBox", "0 0 " + bounds.width + " " + bounds.height);
    tree.nodes.forEach(node => node.children.forEach(childId => {
      const child = getNode(childId);
      if (!child) return;
      const sx = node.x + node.width, sy = node.y + node.height / 2;
      const ex = child.x, ey = child.y + child.height / 2;
      const bend = Math.max(38, (ex - sx) * .48);
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", "M " + sx + " " + sy + " C " + (sx + bend) + " " + sy + ", " + (ex - bend) + " " + ey + ", " + ex + " " + ey);
      path.setAttribute("class", "connection-path" + (node.expanded ? " active" : ""));
      elements.connections.append(path);
    }));
    elements.title.textContent = tree.prompt;
    elements.count.textContent = tree.nodes.length + " nodes mapped";
    elements.emptyHint.classList.toggle("hidden", tree.nodes.length > 1);
    applyView();
  }

  function applyView() { elements.world.style.transform = "translate(" + view.x + "px, " + view.y + "px) scale(" + view.scale + ")"; elements.zoom.textContent = Math.round(view.scale * 100) + "%"; }

  function fitCanvas() {
    if (!tree) return;
    const minX = Math.min(...tree.nodes.map(n => n.x)), minY = Math.min(...tree.nodes.map(n => n.y));
    const maxX = Math.max(...tree.nodes.map(n => n.x + n.width)), maxY = Math.max(...tree.nodes.map(n => n.y + n.height));
    const w = elements.viewport.clientWidth, h = elements.viewport.clientHeight;
    const scale = Math.max(.35, Math.min(1.1, Math.min(w / (maxX - minX + 90), h / (maxY - minY + 90))));
    view.scale = scale;
    view.x = (w - (maxX - minX + 90) * scale) / 2 - minX * scale + 35 * scale;
    view.y = Math.max(24, (h - (maxY - minY + 90) * scale) / 2) - minY * scale + 35 * scale;
    applyView();
  }

  function setZoom(nextScale, anchorX, anchorY) {
    const scale = Math.max(.35, Math.min(2.2, nextScale));
    const rect = elements.viewport.getBoundingClientRect();
    const px = anchorX ?? rect.width / 2, py = anchorY ?? rect.height / 2;
    const worldX = (px - view.x) / view.scale, worldY = (py - view.y) / view.scale;
    view.scale = scale; view.x = px - worldX * scale; view.y = py - worldY * scale; applyView();
  }

  function showWorkspace() {
    elements.welcome.classList.add("hidden"); elements.workspace.classList.remove("hidden");
    renderTree(); requestAnimationFrame(fitCanvas);
  }

  async function startTree(prompt) {
    const text = cleanText(prompt, 500);
    if (!text) { elements.input.focus(); showToast("Describe a situation to get started."); return; }
    tree = createTree(text); persistActiveTree(); showWorkspace();
    const root = getNode(tree.rootId); $("#generation-overlay").classList.remove("hidden");
    try { const choices = await generateNextNodes({ prompt: text, parent: root, isRoot: true }); const children = choices.map((choice, index) => makeNode({ ...choice, depth: 1, parentId: root.id, branchIndex: index })); root.children = children.map(child => child.id); tree.nodes.push(...children); persistActiveTree(); renderTree(); requestAnimationFrame(fitCanvas); }
    catch (error) { console.error("Initial generation failed.", error); showToast("Could not generate initial paths."); }
    finally { $("#generation-overlay").classList.add("hidden"); }
  }

  function newTree() { tree = null; elements.workspace.classList.add("hidden"); elements.welcome.classList.remove("hidden"); elements.input.value = ""; elements.input.focus(); view = { x: 0, y: 0, scale: 1 }; }

  function openUpgrade() { elements.modal.classList.remove("hidden"); $("[data-action='close-modal']", elements.modal).focus(); }
  function closeUpgrade() { elements.modal.classList.add("hidden"); }

  async function buyPro() {
    const tg = window.Telegram && window.Telegram.WebApp;
    if (tg && typeof tg.openInvoice === "function" && INVOICE_API_ENDPOINT && !/placeholder|example|workers.dev\\/invoice$/i.test(INVOICE_API_ENDPOINT)) {
      try {
        const response = await fetch(INVOICE_API_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ product: "conseqo_pro", stars: 10, initData: tg.initData || "" }) });
        if (!response.ok) throw new Error("Invoice endpoint failed.");
        const invoice = await response.json(); if (!invoice.url) throw new Error("Invoice URL missing.");
        tg.openInvoice(invoice.url, status => { if (status === "paid") unlockPro(); else if (status === "cancelled") showToast("Checkout cancelled."); else showToast("Payment is processing."); }); return;
      } catch (error) { console.info("Telegram checkout fallback.", error); }
    }
    if (DEMO_CHECKOUT_ENABLED) unlockPro(); else showToast("Pro checkout is not configured yet.");
  }
  function unlockPro() { state.isPro = true; saveState(); closeUpgrade(); showToast("Pro activated. Unlimited depth unlocked."); renderTree(); }

  function showToast(message) {
    elements.toast.textContent = message; elements.toast.classList.add("visible");
    clearTimeout(toastTimeout); toastTimeout = window.setTimeout(() => elements.toast.classList.remove("visible"), 2800);
  }

  function handleAction(element) {
    switch (element.dataset.action) {
      case "home": case "new-tree": newTree(); break;
      case "upgrade": openUpgrade(); break;
      case "example": elements.input.value = element.dataset.prompt || ""; elements.input.focus(); break;
      case "expand-node": expandNode(element.dataset.nodeId); break;
      case "close-modal": closeUpgrade(); break;
      case "buy-pro": buyPro(); break;
      case "zoom-in": setZoom(view.scale * 1.2); break;
      case "zoom-out": setZoom(view.scale / 1.2); break;
      case "zoom-reset": view = { x: 0, y: 0, scale: 1 }; applyView(); break;
      case "fit": fitCanvas(); break;
    }
  }

  // Keep a single delegated document click handler for all action controls.
  document.addEventListener("click", event => {
    const target = event.target.closest("[data-action]");
    if (!target || !document.contains(target)) return;
    event.preventDefault(); handleAction(target);
  });

  elements.form.addEventListener("submit", event => { event.preventDefault(); startTree(elements.input.value); });

  function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  elements.viewport.addEventListener("pointerdown", event => {
    if (event.target.closest(".tree-node")) return;
    elements.viewport.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 1) { dragOrigin = { x: event.clientX, y: event.clientY, vx: view.x, vy: view.y }; elements.viewport.classList.add("is-dragging"); }
    else if (pointers.size === 2) {
      const [a, b] = Array.from(pointers.values());
      pinchOrigin = { distance: distance(a, b), scale: view.scale, midpoint: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, vx: view.x, vy: view.y };
      dragOrigin = null;
    }
  });

  elements.viewport.addEventListener("pointermove", event => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2 && pinchOrigin) {
      const [a, b] = Array.from(pointers.values()), rect = elements.viewport.getBoundingClientRect();
      const midpointX = (a.x + b.x) / 2 - rect.left, midpointY = (a.y + b.y) / 2 - rect.top;
      const wx = (pinchOrigin.midpoint.x - rect.left - pinchOrigin.vx) / pinchOrigin.scale;
      const wy = (pinchOrigin.midpoint.y - rect.top - pinchOrigin.vy) / pinchOrigin.scale;
      view.scale = Math.max(.35, Math.min(2.2, pinchOrigin.scale * distance(a, b) / Math.max(1, pinchOrigin.distance)));
      view.x = midpointX - wx * view.scale; view.y = midpointY - wy * view.scale; applyView();
    } else if (pointers.size === 1 && dragOrigin) {
      view.x = dragOrigin.vx + event.clientX - dragOrigin.x; view.y = dragOrigin.vy + event.clientY - dragOrigin.y; applyView();
    }
  });

  function releasePointer(event) {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinchOrigin = null;
    if (pointers.size === 1) {
      const p = Array.from(pointers.values())[0]; dragOrigin = { x: p.x, y: p.y, vx: view.x, vy: view.y };
    } else { dragOrigin = null; elements.viewport.classList.remove("is-dragging"); }
  }
  elements.viewport.addEventListener("pointerup", releasePointer);
  elements.viewport.addEventListener("pointercancel", releasePointer);
  elements.viewport.addEventListener("lostpointercapture", releasePointer);

  elements.viewport.addEventListener("wheel", event => {
    event.preventDefault();
    const rect = elements.viewport.getBoundingClientRect();
    setZoom(view.scale * Math.exp(-event.deltaY * .0014), event.clientX - rect.left, event.clientY - rect.top);
  }, { passive: false });

  elements.modal.addEventListener("click", event => { if (event.target === elements.modal) closeUpgrade(); });
  document.addEventListener("keydown", event => { if (event.key === "Escape" && !elements.modal.classList.contains("hidden")) closeUpgrade(); });

  updateTier(); initTelegram();
  if (state.activeTreeId) {
    const saved = state.trees.find(item => item.id === state.activeTreeId);
    if (saved && Array.isArray(saved.nodes) && saved.nodes.length) { tree = saved; showWorkspace(); }
  }
})();