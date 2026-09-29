/**
 * AgentKit Diagram Reader Runtime (Archify-informed)
 * Pure vanilla JavaScript, zero runtime dependencies.
 */
(function() {
  function escapeXml(unsafe) {
    if (typeof unsafe !== 'string') return '';
    return unsafe
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function initDiagram(container) {
    if (!container || container.__ak_initialized) return;
    container.__ak_initialized = true;

    const dataEl = container.querySelector('script[type="application/json"].ak-diagram-data');
    if (!dataEl) return;

    let irData;
    try {
      irData = JSON.parse(dataEl.textContent);
    } catch (e) {
      console.error('Failed to parse diagram data:', e);
      return;
    }

    const state = {
      focusedNodeId: null,
      activeReach: null, // 'upstream' | 'downstream'
      activeRoute: null,
      activeLensIndex: -1,
      currentChapterIndex: 0,
      isPresentation: false
    };

    // DOM Elements
    const root = container;
    const searchInput = container.querySelector('.ak-diagram-search-input');
    const nodes = Array.from(container.querySelectorAll('.ak-node'));
    const edges = Array.from(container.querySelectorAll('.ak-edge'));
    const themeBtn = container.querySelector('.ak-btn-theme');
    const presentBtn = container.querySelector('.ak-btn-present');
    const shareBtn = container.querySelector('.ak-btn-share');
    const reachDownBtn = container.querySelector('.ak-btn-reach-down');
    const reachUpBtn = container.querySelector('.ak-btn-reach-up');
    const routeBtn = container.querySelector('.ak-btn-route');
    const lensBtn = container.querySelector('.ak-btn-lens');
    const chapterPrevBtn = container.querySelector('.ak-btn-prev-chapter');
    const chapterNextBtn = container.querySelector('.ak-btn-next-chapter');
    const chapterLabel = container.querySelector('.ak-chapter-label');
    const motionBtn = container.querySelector('.ak-btn-motion');
    const svgEl = container.querySelector('.ak-diagram-svg');

    // Replay the finite entrance/trace motion by re-arming data-motion on the svg.
    function replayMotion() {
      if (!svgEl) return;
      svgEl.removeAttribute('data-motion');
      void svgEl.getBoundingClientRect();
      svgEl.setAttribute('data-motion', 'play');
    }
    if (motionBtn) motionBtn.addEventListener('click', replayMotion);

    // Build Graph Adjacency & Distinct Roles
    const outgoing = new Map();
    const incoming = new Map();
    const allRoles = new Set();

    nodes.forEach(n => {
      const role = n.getAttribute('data-role');
      if (role) allRoles.add(role);
    });
    const rolesList = Array.from(allRoles).sort();

    edges.forEach(edgeEl => {
      const from = edgeEl.getAttribute('data-from');
      const to = edgeEl.getAttribute('data-to');
      const edgeId = edgeEl.getAttribute('data-edge-id') || `${from}->${to}`;
      if (from && to) {
        if (!outgoing.has(from)) outgoing.set(from, []);
        outgoing.get(from).push({ to, edgeEl, edgeId });

        if (!incoming.has(to)) incoming.set(to, []);
        incoming.get(to).push({ from, edgeEl, edgeId });
      }
    });

    function clearHighlights() {
      nodes.forEach(n => {
        n.classList.remove('is-focused', 'is-dimmed');
      });
      edges.forEach(e => {
        e.classList.remove('is-highlighted', 'is-dimmed', 'is-active-trace');
      });
      state.focusedNodeId = null;
      state.activeReach = null;
      state.activeRoute = null;
    }

    function focusNodes(nodeIds) {
      const ids = (nodeIds || []).filter(Boolean);
      clearHighlights();
      if (ids.length === 0) {
        state.focusedNodeId = null;
        return;
      }
      state.focusedNodeId = ids[0];

      const focusSet = new Set(ids);
      const connectedNodeIds = new Set(ids);
      ids.forEach(id => {
        (outgoing.get(id) || []).forEach(e => connectedNodeIds.add(e.to));
        (incoming.get(id) || []).forEach(e => connectedNodeIds.add(e.from));
      });

      nodes.forEach(n => {
        const id = n.getAttribute('data-node-id');
        if (focusSet.has(id)) {
          n.classList.add('is-focused');
        } else if (!connectedNodeIds.has(id)) {
          n.classList.add('is-dimmed');
        }
      });

      edges.forEach(e => {
        const from = e.getAttribute('data-from');
        const to = e.getAttribute('data-to');
        if (focusSet.has(from) || focusSet.has(to)) {
          e.classList.add('is-highlighted');
        } else {
          e.classList.add('is-dimmed');
        }
      });
    }

    function focusNode(nodeId) {
      focusNodes(nodeId ? [nodeId] : []);
    }

    function traceReach(nodeId, direction) {
      const targetId = nodeId || state.focusedNodeId || (nodes[0] ? nodes[0].getAttribute('data-node-id') : null);
      if (!targetId) return;
      clearHighlights();
      state.focusedNodeId = targetId;
      state.activeReach = direction;

      const reachedNodes = new Set([targetId]);
      const reachedEdges = new Set();
      const queue = [targetId];

      while (queue.length > 0) {
        const current = queue.shift();
        const neighbors = (direction === 'downstream') ? (outgoing.get(current) || []) : (incoming.get(current) || []);
        neighbors.forEach(item => {
          const nextNode = (direction === 'downstream') ? item.to : item.from;
          reachedEdges.add(item.edgeEl);
          if (!reachedNodes.has(nextNode)) {
            reachedNodes.add(nextNode);
            queue.push(nextNode);
          }
        });
      }

      nodes.forEach(n => {
        const id = n.getAttribute('data-node-id');
        if (id === targetId) {
          n.classList.add('is-focused');
        } else if (!reachedNodes.has(id)) {
          n.classList.add('is-dimmed');
        }
      });

      edges.forEach(e => {
        if (reachedEdges.has(e)) {
          e.classList.add('is-highlighted', 'is-active-trace');
        } else {
          e.classList.add('is-dimmed');
        }
      });
    }

    function traceShortestRoute(sourceId, targetId) {
      if (!sourceId || !targetId || sourceId === targetId) return;
      clearHighlights();

      const queue = [[sourceId]];
      const visited = new Set([sourceId]);
      let shortestPath = null;

      while (queue.length > 0) {
        const path = queue.shift();
        const current = path[path.length - 1];
        if (current === targetId) {
          shortestPath = path;
          break;
        }
        const neighbors = outgoing.get(current) || [];
        const sorted = [...neighbors].sort((a, b) => a.to.localeCompare(b.to));
        for (const item of sorted) {
          if (!visited.has(item.to)) {
            visited.add(item.to);
            queue.push([...path, item.to]);
          }
        }
      }

      if (!shortestPath) return;

      const pathNodes = new Set(shortestPath);
      const pathEdges = new Set();

      for (let i = 0; i < shortestPath.length - 1; i++) {
        const u = shortestPath[i];
        const v = shortestPath[i + 1];
        const edgeObj = (outgoing.get(u) || []).find(e => e.to === v);
        if (edgeObj) pathEdges.add(edgeObj.edgeEl);
      }

      nodes.forEach(n => {
        const id = n.getAttribute('data-node-id');
        if (!pathNodes.has(id)) n.classList.add('is-dimmed');
        else if (id === sourceId || id === targetId) n.classList.add('is-focused');
      });

      edges.forEach(e => {
        if (pathEdges.has(e)) e.classList.add('is-highlighted', 'is-active-trace');
        else e.classList.add('is-dimmed');
      });
    }

    function cycleRoleLens() {
      if (rolesList.length === 0) return;
      state.activeLensIndex = (state.activeLensIndex + 1) % (rolesList.length + 1);

      if (state.activeLensIndex === rolesList.length) {
        clearHighlights();
        state.activeLens = null;
        return;
      }

      const roleName = rolesList[state.activeLensIndex];
      clearHighlights();
      state.activeLens = roleName;

      nodes.forEach(n => {
        const role = n.getAttribute('data-role');
        if (role !== roleName) {
          n.classList.add('is-dimmed');
        } else {
          n.classList.add('is-focused');
        }
      });
    }

    function cycleRoute() {
      if (nodes.length < 2) return;
      const src = nodes[0].getAttribute('data-node-id');
      const dst = nodes[nodes.length - 1].getAttribute('data-node-id');
      traceShortestRoute(src, dst);
    }

    function togglePresentation() {
      state.isPresentation = !state.isPresentation;
      root.classList.toggle('is-presentation', state.isPresentation);
    }

    function setChapter(index) {
      const views = (irData.meta && irData.meta.views) || [];
      if (views.length === 0) return;
      if (index < 0) index = 0;
      if (index >= views.length) index = views.length - 1;
      state.currentChapterIndex = index;
      const chapter = views[index];

      if (chapterLabel) {
        chapterLabel.textContent = `${index + 1}/${views.length}: ${chapter.title || chapter.id}`;
      }

      clearHighlights();
      if (chapter.focus_nodes && chapter.focus_nodes.length > 0) {
        focusNodes(chapter.focus_nodes);
      } else if (chapter.highlight_route && chapter.highlight_route.length >= 2) {
        traceShortestRoute(chapter.highlight_route[0], chapter.highlight_route[chapter.highlight_route.length - 1]);
      }
    }
    const PRESET_THEME_PALETTES = {
      'classic:light': {
        '--ak-bg': '#ffffff', '--ak-surface': '#f8fafc', '--ak-surface-border': '#e2e8f0',
        '--ak-text-primary': '#0f172a', '--ak-text-secondary': '#475569', '--ak-text-muted': '#94a3b8',
        '--ak-accent': '#2563eb', '--ak-accent-light': '#dbeafe',
        '--ak-node-bg': '#ffffff', '--ak-node-border': '#cbd5e1',
        '--ak-edge-stroke': '#64748b', '--ak-edge-active': '#2563eb',
        '--ak-badge-bg': '#f1f5f9', '--ak-font-sans': 'system-ui, -apple-system, sans-serif',
        '--ak-font-mono': 'ui-monospace, monospace'
      },
      'classic:dark': {
        '--ak-bg': '#090d16', '--ak-surface': '#0f172a', '--ak-surface-border': '#1e293b',
        '--ak-text-primary': '#f8fafc', '--ak-text-secondary': '#94a3b8', '--ak-text-muted': '#64748b',
        '--ak-accent': '#38bdf8', '--ak-accent-light': '#0369a1',
        '--ak-node-bg': '#0f172a', '--ak-node-border': '#334155',
        '--ak-edge-stroke': '#475569', '--ak-edge-active': '#38bdf8',
        '--ak-badge-bg': '#1e293b', '--ak-font-sans': 'system-ui, -apple-system, sans-serif',
        '--ak-font-mono': 'ui-monospace, monospace'
      },
      'signal-flow:light': {
        '--ak-bg': '#f0fdf4', '--ak-surface': '#dcfce7', '--ak-surface-border': '#86efac',
        '--ak-text-primary': '#14532d', '--ak-text-secondary': '#166534', '--ak-text-muted': '#4ade80',
        '--ak-accent': '#059669', '--ak-accent-light': '#d1fae5',
        '--ak-node-bg': '#ffffff', '--ak-node-border': '#10b981',
        '--ak-edge-stroke': '#059669', '--ak-edge-active': '#047857',
        '--ak-badge-bg': '#dcfce7', '--ak-font-sans': 'system-ui, -apple-system, sans-serif',
        '--ak-font-mono': 'ui-monospace, monospace'
      },
      'signal-flow:dark': {
        '--ak-bg': '#031c18', '--ak-surface': '#064e3b', '--ak-surface-border': '#047857',
        '--ak-text-primary': '#ecfdf5', '--ak-text-secondary': '#a7f3d0', '--ak-text-muted': '#34d399',
        '--ak-accent': '#34d399', '--ak-accent-light': '#065f46',
        '--ak-node-bg': '#064e3b', '--ak-node-border': '#10b981',
        '--ak-edge-stroke': '#34d399', '--ak-edge-active': '#6ee7b7',
        '--ak-badge-bg': '#064e3b', '--ak-font-sans': 'system-ui, -apple-system, sans-serif',
        '--ak-font-mono': 'ui-monospace, monospace'
      },
      'blueprint:light': {
        '--ak-bg': '#f0f9ff', '--ak-surface': '#e0f2fe', '--ak-surface-border': '#7dd3fc',
        '--ak-text-primary': '#0369a1', '--ak-text-secondary': '#0284c7', '--ak-text-muted': '#38bdf8',
        '--ak-accent': '#0284c7', '--ak-accent-light': '#bae6fd',
        '--ak-node-bg': '#ffffff', '--ak-node-border': '#0ea5e9',
        '--ak-edge-stroke': '#0284c7', '--ak-edge-active': '#0369a1',
        '--ak-badge-bg': '#e0f2fe', '--ak-font-sans': 'ui-monospace, monospace',
        '--ak-font-mono': 'ui-monospace, monospace'
      },
      'blueprint:dark': {
        '--ak-bg': '#081d33', '--ak-surface': '#0c2a4a', '--ak-surface-border': '#1e4976',
        '--ak-text-primary': '#e0f2fe', '--ak-text-secondary': '#bae6fd', '--ak-text-muted': '#38bdf8',
        '--ak-accent': '#38bdf8', '--ak-accent-light': '#0369a1',
        '--ak-node-bg': '#0c213a', '--ak-node-border': '#38bdf8',
        '--ak-edge-stroke': '#7dd3fc', '--ak-edge-active': '#38bdf8',
        '--ak-badge-bg': '#0c213a', '--ak-font-sans': 'ui-monospace, monospace',
        '--ak-font-mono': 'ui-monospace, monospace'
      },
      'editorial:light': {
        '--ak-bg': '#faf8f5', '--ak-surface': '#f3efe6', '--ak-surface-border': '#e2dacb',
        '--ak-text-primary': '#1c1917', '--ak-text-secondary': '#57534e', '--ak-text-muted': '#a8a29e',
        '--ak-accent': '#991b1b', '--ak-accent-light': '#fecaca',
        '--ak-node-bg': '#ffffff', '--ak-node-border': '#d6cfc4',
        '--ak-edge-stroke': '#78716c', '--ak-edge-active': '#991b1b',
        '--ak-badge-bg': '#f3efe6', '--ak-font-sans': 'system-ui, serif',
        '--ak-font-mono': 'ui-monospace, monospace'
      },
      'editorial:dark': {
        '--ak-bg': '#1c1917', '--ak-surface': '#292524', '--ak-surface-border': '#44403c',
        '--ak-text-primary': '#fafaf9', '--ak-text-secondary': '#d6d3d1', '--ak-text-muted': '#78716c',
        '--ak-accent': '#ef4444', '--ak-accent-light': '#7f1d1d',
        '--ak-node-bg': '#292524', '--ak-node-border': '#78716c',
        '--ak-edge-stroke': '#a8a29e', '--ak-edge-active': '#f87171',
        '--ak-badge-bg': '#292524', '--ak-font-sans': 'system-ui, serif',
        '--ak-font-mono': 'ui-monospace, monospace'
      }
    };

    function exportShareCard() {
      const svg = root.querySelector('.ak-diagram-svg');
      if (!svg) return;

      const title = (irData.meta && irData.meta.title) || 'AgentKit System Map';
      const preset = root.getAttribute('data-preset') || 'classic';
      const theme = root.getAttribute('data-theme') || 'light';

      const VAR_WHITELIST = [
        '--ak-bg', '--ak-surface', '--ak-surface-border',
        '--ak-text-primary', '--ak-text-secondary', '--ak-text-muted',
        '--ak-accent', '--ak-accent-light',
        '--ak-node-bg', '--ak-node-border',
        '--ak-edge-stroke', '--ak-edge-active',
        '--ak-badge-bg', '--ak-font-sans', '--ak-font-mono'
      ];

      const paletteKey = `${preset}:${theme}`;
      const fallbackPalette = PRESET_THEME_PALETTES[paletteKey] || PRESET_THEME_PALETTES['classic:light'];

      let computed = null;
      if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
        try { computed = window.getComputedStyle(root); } catch (e) { computed = null; }
      }

      const resolvedVars = {};
      VAR_WHITELIST.forEach(varName => {
        let val = '';
        if (computed && typeof computed.getPropertyValue === 'function') {
          val = computed.getPropertyValue(varName);
        }
        resolvedVars[varName] = (val && val.trim()) ? val.trim() : (fallbackPalette[varName] || '#000000');
      });

      const cardBg = resolvedVars['--ak-bg'];
      const cardSurface = resolvedVars['--ak-surface'];
      const cardBorder = resolvedVars['--ak-surface-border'];
      const textPrimary = resolvedVars['--ak-text-primary'];
      const textMuted = resolvedVars['--ak-text-muted'];
      const accent = resolvedVars['--ak-accent'];

      const cssDeclarations = Object.entries(resolvedVars)
        .map(([k, v]) => `${k}: ${v};`)
        .join(' ');

      const styleBlock = `<style>
        svg {
          ${cssDeclarations}
          font-family: var(--ak-font-sans);
        }
      </style>`;

      // Construct canonical 1200x630 Share Card SVG with self-contained resolved variables
      const shareCardSvg = `<svg viewBox="0 0 1200 630" width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
        <defs>
          ${styleBlock}
        </defs>
        <rect width="1200" height="630" fill="${cardBg}" rx="12" stroke="${cardBorder}" stroke-width="2"/>
        <g transform="translate(48, 56)">
          <text x="0" y="0" font-family="system-ui, sans-serif" font-size="28" font-weight="700" fill="${textPrimary}">${escapeXml(title)}</text>
          <text x="0" y="28" font-family="system-ui, sans-serif" font-size="14" fill="${textMuted}">AgentKit System Map • Preset: ${escapeXml(preset)} • Theme: ${escapeXml(theme)}</text>
        </g>
        <g transform="translate(48, 120)">
          <rect width="1104" height="450" fill="${cardSurface}" rx="8" stroke="${cardBorder}" stroke-width="1.5"/>
          <svg x="20" y="20" width="1064" height="410" viewBox="${svg.getAttribute('viewBox') || '0 0 1000 600'}">
            ${svg.innerHTML}
          </svg>
        </g>
        <g transform="translate(1050, 595)">
          <text x="0" y="0" font-family="system-ui, sans-serif" font-size="12" font-weight="600" fill="${accent}">AgentKit • Archify v2.16</text>
        </g>
      </svg>`;

      const blob = new Blob([shareCardSvg], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-share-card-1200x630.svg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    // Attach Node Click Handlers
    nodes.forEach(nodeEl => {
      nodeEl.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = nodeEl.getAttribute('data-node-id');
        if (state.focusedNodeId === id) {
          clearHighlights();
        } else {
          focusNode(id);
        }
      });
    });

    const viewport = container.querySelector('.ak-diagram-viewport');
    if (viewport) {
      viewport.addEventListener('click', () => {
        clearHighlights();
      });
    }

    // Search Input (Searches Label, ID, Description, Role)
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const q = e.target.value.trim().toLowerCase();
        if (!q) {
          clearHighlights();
          return;
        }
        clearHighlights();
        nodes.forEach(n => {
          const label = (n.getAttribute('data-label') || '').toLowerCase();
          const id = (n.getAttribute('data-node-id') || '').toLowerCase();
          const desc = (n.getAttribute('data-desc') || '').toLowerCase();
          const role = (n.getAttribute('data-role') || '').toLowerCase();
          if (label.includes(q) || id.includes(q) || desc.includes(q) || role.includes(q)) {
            n.classList.remove('is-dimmed');
            n.classList.add('is-focused');
          } else {
            n.classList.add('is-dimmed');
          }
        });
      });
    }

    // Control Buttons
    if (themeBtn) {
      themeBtn.addEventListener('click', () => {
        const currentTheme = root.getAttribute('data-theme') || 'light';
        const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
        root.setAttribute('data-theme', nextTheme);
        themeBtn.textContent = nextTheme === 'dark' ? '☀️' : '🌙';
      });
    }

    if (presentBtn) presentBtn.addEventListener('click', togglePresentation);
    if (shareBtn) shareBtn.addEventListener('click', exportShareCard);
    if (reachDownBtn) reachDownBtn.addEventListener('click', () => traceReach(null, 'downstream'));
    if (reachUpBtn) reachUpBtn.addEventListener('click', () => traceReach(null, 'upstream'));
    if (routeBtn) routeBtn.addEventListener('click', cycleRoute);
    if (lensBtn) lensBtn.addEventListener('click', cycleRoleLens);

    if (chapterPrevBtn) {
      chapterPrevBtn.addEventListener('click', () => setChapter(state.currentChapterIndex - 1));
    }
    if (chapterNextBtn) {
      chapterNextBtn.addEventListener('click', () => setChapter(state.currentChapterIndex + 1));
    }

    // Global Scoped Keyboard Shortcuts
    document.addEventListener('keydown', (e) => {
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
        if (e.key === 'Escape') activeEl.blur();
        return;
      }

      if (e.key === '/') {
        if (searchInput) {
          e.preventDefault();
          searchInput.focus();
        }
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        togglePresentation();
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        cycleRoute();
      } else if (e.key === 'l' || e.key === 'L') {
        e.preventDefault();
        cycleRoleLens();
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        replayMotion();
      } else if (e.key === '[') {
        e.preventDefault();
        setChapter(state.currentChapterIndex - 1);
      } else if (e.key === ']') {
        e.preventDefault();
        setChapter(state.currentChapterIndex + 1);
      } else if (e.key === 'Escape') {
        if (state.isPresentation) {
          togglePresentation();
        } else {
          clearHighlights();
        }
      }
    });

    if (irData.meta && irData.meta.views && irData.meta.views.length > 0) {
      setChapter(0);
    }
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        document.querySelectorAll('.ak-diagram-root').forEach(initDiagram);
      });
    } else {
      document.querySelectorAll('.ak-diagram-root').forEach(initDiagram);
    }
  }

  if (typeof window !== 'undefined') {
    window.AgentKitDiagram = { init: initDiagram };
  }
})();
