import * as d3 from "d3";
import type {
  Dataset,
  LaidOutPhilosopher,
  Philosopher,
  Region,
  Topic,
  Tradition,
} from "../types";

interface TimelineHandles {
  resize: () => void;
}

const MARGIN = { top: 28, right: 28, bottom: 44, left: 96 };
const X_DOMAIN: [number, number] = [-700, 2050];
const DOT_R = 5;
const DOT_R_HOVER = 7;
const DOT_R_FOCUS = 8;

const TOPICS: Topic[] = [
  { id: "metaphysics", labelKo: "형이상학 · 존재론", color: "#6b8cae" },
  { id: "epistemology", labelKo: "인식론", color: "#e67e22" },
  { id: "ethics", labelKo: "윤리 · 실천", color: "#b8860b" },
  { id: "politics", labelKo: "정치 · 사회", color: "#8b3a3a" },
  { id: "language", labelKo: "언어 · 논리", color: "#34495e" },
  { id: "religion", labelKo: "종교 · 구원", color: "#8e4ec6" },
];

export function renderTimeline(
  container: HTMLElement,
  dataset: Dataset,
): TimelineHandles {
  const { traditions, philosophers } = dataset;
  const traditionById = new Map<string, Tradition>(
    traditions.map((t) => [t.id, t]),
  );
  const philById = new Map<string, Philosopher>(
    philosophers.map((p) => [p.id, p]),
  );

  const westTraditions = orderTraditions(traditions, philosophers, "west");
  const eastTraditions = orderTraditions(traditions, philosophers, "east");

  const tooltipEl = document.getElementById("tooltip") as HTMLDivElement;
  const sidePanel = document.getElementById("side-panel") as HTMLElement;
  const sidePanelBody = document.getElementById(
    "side-panel-body",
  ) as HTMLElement;
  const sidePanelClose = document.getElementById(
    "side-panel-close",
  ) as HTMLButtonElement;

  container.innerHTML = "";

  const svg = d3
    .select(container)
    .append("svg")
    .attr("role", "img")
    .attr("aria-label", "동서양 철학 사상사 타임라인");

  const defs = svg.append("defs");
  defs
    .append("clipPath")
    .attr("id", "plot-clip")
    .append("rect")
    .attr("x", 0)
    .attr("y", 0);

  const gRoot = svg.append("g");

  const gBackground = gRoot.append("g").attr("class", "bg-layer");
  const gPlot = gRoot
    .append("g")
    .attr("class", "plot-layer")
    .attr("clip-path", "url(#plot-clip)");
  const gXAxis = gRoot.append("g").attr("class", "axis axis-x");
  const gOverlay = gRoot.append("g").attr("class", "overlay-layer");

  const gHulls = gPlot.append("g").attr("class", "hulls");
  const gEdges = gPlot.append("g").attr("class", "edges");
  const gLives = gPlot.append("g").attr("class", "lives");
  const gDots = gPlot.append("g").attr("class", "dots");
  const gTopicLabels = gPlot.append("g").attr("class", "topic-labels");

  const xScale = d3.scaleLinear().domain(X_DOMAIN);

  let currentX = xScale.copy();
  let selected: string | null = null;
  let dims = { width: 0, height: 0, innerW: 0, innerH: 0 };
  let laidOut: LaidOutPhilosopher[] = [];

  const zoom = d3
    .zoom<SVGSVGElement, unknown>()
    .scaleExtent([1, 40])
    .translateExtent([
      [0, 0],
      [0, 0],
    ])
    .extent([
      [0, 0],
      [0, 0],
    ])
    .filter((event: Event) => {
      // Allow wheel & drag; ignore right-click.
      if (event.type === "mousedown" && (event as MouseEvent).button !== 0)
        return false;
      return true;
    })
    .on("zoom", (event) => {
      currentX = event.transform.rescaleX(xScale);
      redraw();
    });

  svg.call(zoom as any);

  svg.on("click", (event) => {
    if (event.target === svg.node()) {
      clearSelection();
    }
  });

  sidePanelClose.addEventListener("click", clearSelection);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") clearSelection();
  });

  resize();

  function resize() {
    const rect = container.getBoundingClientRect();
    const width = Math.max(640, rect.width);
    const height = Math.max(420, rect.height);
    const innerW = width - MARGIN.left - MARGIN.right;
    const innerH = height - MARGIN.top - MARGIN.bottom;
    dims = { width, height, innerW, innerH };

    svg.attr("viewBox", `0 0 ${width} ${height}`);

    xScale.range([0, innerW]);

    defs.select("#plot-clip rect").attr("width", innerW).attr("height", innerH);

    gRoot.attr("transform", `translate(${MARGIN.left},${MARGIN.top})`);

    zoom
      .translateExtent([
        [0, 0],
        [innerW, innerH],
      ])
      .extent([
        [0, 0],
        [innerW, innerH],
      ]);

    // Preserve current zoom transform across resizes so panel-open-triggered
    // resizes don't reset user's pan/zoom.
    const t = d3.zoomTransform(svg.node() as SVGSVGElement);
    currentX = t.rescaleX(xScale);

    drawStatic();
    redraw();
  }

  // ----- Layout -----

  function laneCenter(region: "east" | "west", traditionId: string): number {
    const list = region === "west" ? westTraditions : eastTraditions;
    const idx = list.findIndex((t) => t.id === traditionId);
    const n = list.length;
    const halfH = dims.innerH / 2;
    if (region === "west") {
      // Upper half: top = oldest, bottom (near center) = newest.
      const step = halfH / (n + 1);
      return step * (idx + 1);
    } else {
      // Lower half: top (near center) = oldest, bottom = newest.
      const step = halfH / (n + 1);
      return halfH + step * (idx + 1);
    }
  }

  function buildLayout(): LaidOutPhilosopher[] {
    const lineColors = computeLineColors(philosophers, traditionById);
    // jitter per tradition to avoid exact overlap; deterministic from id.
    return philosophers.map((p) => {
      const baseY = laneCenter(p.region, p.tradition);
      const jitter = hashJitter(p.id) * 16 - 8;
      return {
        ...p,
        x: 0, // set at redraw from currentX
        y: baseY + jitter,
        lineColor: lineColors.get(p.id) ?? traditionById.get(p.tradition)!.color,
      };
    });
  }

  // ----- Static layers (axis, hemispheres, tradition labels) -----

  function drawStatic() {
    gBackground.selectAll("*").remove();
    gOverlay.selectAll("*").remove();

    // Middle horizontal rule (east/west divider).
    gBackground
      .append("line")
      .attr("class", "axis-line")
      .attr("x1", 0)
      .attr("x2", dims.innerW)
      .attr("y1", dims.innerH / 2)
      .attr("y2", dims.innerH / 2);

    // Region labels (rotated on left).
    gOverlay
      .append("text")
      .attr("class", "region-label")
      .attr("transform", `translate(-64, ${dims.innerH / 4}) rotate(-90)`)
      .attr("text-anchor", "middle")
      .text("서양 · WEST");

    gOverlay
      .append("text")
      .attr("class", "region-label")
      .attr("transform", `translate(-64, ${(3 * dims.innerH) / 4}) rotate(-90)`)
      .attr("text-anchor", "middle")
      .text("동양 · EAST");

    // Tradition labels at the left, near their lane center.
    const traditionLabelData: Array<{
      id: string;
      labelKo: string;
      color: string;
      y: number;
    }> = [];
    westTraditions.forEach((t) => {
      traditionLabelData.push({
        id: t.id,
        labelKo: t.labelKo,
        color: t.color,
        y: laneCenter("west", t.id),
      });
    });
    eastTraditions.forEach((t) => {
      traditionLabelData.push({
        id: t.id,
        labelKo: t.labelKo,
        color: t.color,
        y: laneCenter("east", t.id),
      });
    });

    const labelG = gOverlay
      .append("g")
      .attr("class", "tradition-labels")
      .selectAll("g")
      .data(traditionLabelData, (d: any) => d.id)
      .join("g")
      .attr("transform", (d) => `translate(-6, ${d.y})`);

    labelG
      .append("text")
      .attr("class", "tradition-label")
      .attr("text-anchor", "end")
      .attr("dominant-baseline", "middle")
      .attr("fill", (d) => d.color)
      .text((d) => d.labelKo);
  }

  // ----- Redraw (zoom-dependent) -----

  function redraw() {
    laidOut = buildLayout().map((p) => ({
      ...p,
      x: currentX(p.birth),
    }));

    // X axis (ticks labeled as year, negatives show BC).
    const axis = d3
      .axisBottom(currentX)
      .ticks(10)
      .tickFormat((d) => {
        const v = +d;
        if (v === 0) return "0";
        return v < 0 ? `BC ${-v}` : `${v}`;
      });
    gXAxis
      .attr("transform", `translate(0, ${dims.innerH})`)
      .call(axis as any);

    // Topic clusters: convex hull per (primary-topic × region).
    drawClusters();

    // Life segments (thin line from birth to death).
    const lives = gLives
      .selectAll<SVGLineElement, LaidOutPhilosopher>("line.philosopher-life")
      .data(laidOut, (d) => d.id);

    lives.join(
      (enter) =>
        enter
          .append("line")
          .attr("class", "philosopher-life")
          .attr("stroke", (d) => traditionById.get(d.tradition)!.color),
      (update) => update,
      (exit) => exit.remove(),
    )
      .attr("x1", (d) => currentX(d.birth))
      .attr("x2", (d) => currentX(d.death))
      .attr("y1", (d) => d.y)
      .attr("y2", (d) => d.y);

    // Dots.
    const dotSel = gDots
      .selectAll<SVGCircleElement, LaidOutPhilosopher>("circle.philosopher-dot")
      .data(laidOut, (d) => d.id)
      .join(
        (enter) =>
          enter
            .append("circle")
            .attr("class", "philosopher-dot")
            .attr("r", DOT_R)
            .attr("fill", (d) => d.lineColor)
            .on("mouseenter", function (_event, d) {
              d3.select(this).attr("r", selected === d.id ? DOT_R_FOCUS : DOT_R_HOVER);
              showTooltip(d);
            })
            .on("mousemove", function (event) {
              moveTooltip(event);
            })
            .on("mouseleave", function (_event, d) {
              d3.select(this).attr("r", selected === d.id ? DOT_R_FOCUS : DOT_R);
              hideTooltip();
            })
            .on("click", function (event, d) {
              event.stopPropagation();
              selectPhilosopher(d.id);
            }),
        (update) => update,
        (exit) => exit.remove(),
      )
      .attr("cx", (d) => d.x)
      .attr("cy", (d) => d.y);

    // Influence edges (only when selection exists).
    if (selected) {
      drawEdges(selected);
    } else {
      gEdges.selectAll("*").remove();
    }

    applyDimming(dotSel);
  }

  function drawClusters() {
    interface Cluster {
      key: string;
      topic: Topic;
      hullPath: string;
      labelX: number;
      labelY: number;
    }
    const clusters: Cluster[] = [];
    const regions: Region[] = ["west", "east"];

    for (const t of TOPICS) {
      for (const region of regions) {
        const members = laidOut.filter(
          (p) =>
            p.region === region && !!p.topics && p.topics[0] === t.id,
        );
        if (members.length === 0) continue;
        const pts = members.map(
          (p) => [p.x, p.y] as [number, number],
        );

        let hullPath = "";
        if (pts.length >= 3) {
          const hull = d3.polygonHull(pts);
          if (hull) {
            const cx = d3.mean(hull, (d) => d[0]) ?? 0;
            const cy = d3.mean(hull, (d) => d[1]) ?? 0;
            const padding = 26;
            const padded = hull.map(([x, y]) => {
              const dx = x - cx;
              const dy = y - cy;
              const dist = Math.sqrt(dx * dx + dy * dy) || 1;
              return [
                x + (dx / dist) * padding,
                y + (dy / dist) * padding,
              ] as [number, number];
            });
            const line = d3
              .line<[number, number]>()
              .x((d) => d[0])
              .y((d) => d[1])
              .curve(d3.curveCatmullRomClosed.alpha(0.85));
            hullPath = line(padded) ?? "";
          }
        } else if (pts.length === 2) {
          const [a, b] = pts;
          const mx = (a[0] + b[0]) / 2;
          const my = (a[1] + b[1]) / 2;
          const dx = b[0] - a[0];
          const dy = b[1] - a[1];
          const halfLen = Math.sqrt(dx * dx + dy * dy) / 2;
          const theta = Math.atan2(dy, dx);
          const rx = halfLen + 26;
          const ry = 22;
          const steps = 32;
          const pts2: [number, number][] = [];
          for (let i = 0; i < steps; i++) {
            const th = (i / steps) * 2 * Math.PI;
            const ex = Math.cos(th) * rx;
            const ey = Math.sin(th) * ry;
            const rotX = ex * Math.cos(theta) - ey * Math.sin(theta);
            const rotY = ex * Math.sin(theta) + ey * Math.cos(theta);
            pts2.push([mx + rotX, my + rotY]);
          }
          const line = d3
            .line<[number, number]>()
            .x((d) => d[0])
            .y((d) => d[1])
            .curve(d3.curveCatmullRomClosed.alpha(0.85));
          hullPath = line(pts2) ?? "";
        } else {
          const [x, y] = pts[0];
          const r = 22;
          hullPath = `M ${x + r},${y} A ${r},${r} 0 1,1 ${x - r},${y} A ${r},${r} 0 1,1 ${x + r},${y} Z`;
        }

        const labelX = d3.mean(pts, (d) => d[0]) ?? 0;
        const labelY =
          region === "west"
            ? Math.min(...pts.map((p) => p[1])) - 14
            : Math.max(...pts.map((p) => p[1])) + 26;

        clusters.push({
          key: `${t.id}-${region}`,
          topic: t,
          hullPath,
          labelX,
          labelY,
        });
      }
    }

    gHulls
      .selectAll<SVGPathElement, Cluster>("path.cluster-hull")
      .data(clusters, (d) => d.key)
      .join(
        (enter) => enter.append("path").attr("class", "cluster-hull"),
        (update) => update,
        (exit) => exit.remove(),
      )
      .attr("d", (d) => d.hullPath)
      .attr("fill", (d) => d.topic.color)
      .attr("stroke", (d) => d.topic.color)
      .classed("dimmed-soft", () => selected !== null);

    gTopicLabels
      .selectAll<SVGTextElement, Cluster>("text.topic-label")
      .data(clusters, (d) => d.key)
      .join(
        (enter) =>
          enter
            .append("text")
            .attr("class", "topic-label")
            .attr("text-anchor", "middle"),
        (update) => update,
        (exit) => exit.remove(),
      )
      .attr("x", (d) => d.labelX)
      .attr("y", (d) => d.labelY)
      .attr("fill", (d) => d.topic.color)
      .text((d) => d.topic.labelKo)
      .classed("dimmed-soft", () => selected !== null);
  }

  function applyDimming(
    dotSel: d3.Selection<SVGCircleElement, LaidOutPhilosopher, any, any>,
  ) {
    if (!selected) {
      dotSel.classed("dimmed", false).attr("r", DOT_R);
      gLives.selectAll("line").classed("dimmed", false);
      return;
    }
    const related = relatedIds(selected);
    dotSel
      .classed("dimmed", (d) => !related.has(d.id))
      .attr("r", (d) =>
        d.id === selected ? DOT_R_FOCUS : related.has(d.id) ? DOT_R : DOT_R,
      );
    gLives
      .selectAll<SVGLineElement, LaidOutPhilosopher>("line")
      .classed("dimmed", (d) => !related.has(d.id));
  }

  function drawEdges(focusId: string) {
    const focus = laidOut.find((p) => p.id === focusId);
    if (!focus) return;

    const edges: Array<{ source: LaidOutPhilosopher; target: LaidOutPhilosopher }> = [];
    // Incoming influences (focus <- source).
    for (const srcId of focus.influences) {
      const src = laidOut.find((p) => p.id === srcId);
      if (src) edges.push({ source: src, target: focus });
    }
    // Outgoing (people who were influenced by focus).
    for (const p of laidOut) {
      if (p.influences.includes(focusId)) {
        edges.push({ source: focus, target: p });
      }
    }

    gEdges
      .selectAll<SVGPathElement, typeof edges[number]>("path.influence-edge")
      .data(edges, (d) => `${d.source.id}->${d.target.id}`)
      .join(
        (enter) =>
          enter
            .append("path")
            .attr("class", "influence-edge")
            .attr("stroke", (d) => traditionById.get(d.source.tradition)!.color),
        (update) => update,
        (exit) => exit.remove(),
      )
      .attr("d", (d) => bezierPath(d.source, d.target));
  }

  function bezierPath(
    a: { x: number; y: number },
    b: { x: number; y: number },
  ): string {
    const dx = Math.abs(b.x - a.x);
    const curve = Math.max(30, dx * 0.25);
    const midY = (a.y + b.y) / 2;
    const sign = b.y > a.y ? 1 : -1;
    // S-curve that bulges toward the hemisphere of the target.
    const c1x = a.x + curve * 0.4;
    const c1y = a.y + sign * curve * 0.3;
    const c2x = b.x - curve * 0.4;
    const c2y = b.y - sign * curve * 0.3;
    // Fallback when too close.
    if (dx < 2) {
      return `M${a.x},${a.y} Q${a.x + 30},${midY} ${b.x},${b.y}`;
    }
    return `M${a.x},${a.y} C${c1x},${c1y} ${c2x},${c2y} ${b.x},${b.y}`;
  }

  // ----- Selection / panel -----

  function selectPhilosopher(id: string) {
    selected = id;
    renderSidePanel(id);
    sidePanel.classList.add("open");
    sidePanel.setAttribute("aria-hidden", "false");
    document.body.classList.add("panel-open");
    redraw();
  }

  function clearSelection() {
    selected = null;
    sidePanel.classList.remove("open");
    sidePanel.setAttribute("aria-hidden", "true");
    document.body.classList.remove("panel-open");
    redraw();
  }

  function renderSidePanel(id: string) {
    const p = philById.get(id);
    if (!p) return;
    const tradition = traditionById.get(p.tradition)!;

    const incoming = p.influences
      .map((pid) => philById.get(pid))
      .filter((x): x is Philosopher => !!x);
    const outgoing = philosophers.filter((other) =>
      other.influences.includes(id),
    );

    const linkMarkup = (arr: Philosopher[]) =>
      arr.length === 0
        ? `<div class="sp-empty">—</div>`
        : `<div class="sp-link-list">${arr
            .map((o) => {
              const t = traditionById.get(o.tradition)!;
              return `<button class="sp-link" data-id="${escapeHtml(o.id)}">
                  <span class="sp-link-dot" style="background:${t.color}"></span>
                  <span>${escapeHtml(o.nameKo)}</span>
                  <span class="sp-link-meta">${formatYear(o.birth)}–${formatYear(o.death)} · ${escapeHtml(t.labelKo)}</span>
                </button>`;
            })
            .join("")}</div>`;

    const quotesMarkup = (qs: Philosopher["quotes"]) =>
      !qs || qs.length === 0
        ? ""
        : `<div class="sp-section">
            <div class="sp-section-title">명언</div>
            <div class="sp-quote-list">${qs
              .map(
                (q) => `<blockquote class="sp-quote">
                  <p class="sp-quote-text">${escapeHtml(q.text)}</p>
                  ${q.source ? `<cite class="sp-quote-source">— ${escapeHtml(q.source)}</cite>` : ""}
                </blockquote>`,
              )
              .join("")}</div>
          </div>`;

    const eventsMarkup = (evs: Philosopher["events"]) =>
      !evs || evs.length === 0
        ? ""
        : `<div class="sp-section">
            <div class="sp-section-title">주요 사건</div>
            <ol class="sp-event-list">${[...evs]
              .sort((a, b) => a.year - b.year)
              .map(
                (e) => `<li class="sp-event">
                  <span class="sp-event-year">${formatYear(e.year)}</span>
                  <span class="sp-event-text">${escapeHtml(e.text)}</span>
                </li>`,
              )
              .join("")}</ol>
          </div>`;

    sidePanelBody.innerHTML = `
      <div class="sp-name">${escapeHtml(p.nameKo)}</div>
      <div class="sp-name-en">${escapeHtml(p.name)}</div>
      <div class="sp-meta">
        <span class="sp-swatch" style="background:${tradition.color}"></span>
        ${escapeHtml(tradition.labelKo)} · ${escapeHtml(p.region === "west" ? "서양" : "동양")} ·
        ${formatYear(p.birth)} – ${formatYear(p.death)}
      </div>
      <p class="sp-desc">${escapeHtml(p.desc)}</p>

      ${quotesMarkup(p.quotes)}
      ${eventsMarkup(p.events)}

      <div class="sp-section">
        <div class="sp-section-title">받은 영향</div>
        ${linkMarkup(incoming)}
      </div>
      <div class="sp-section">
        <div class="sp-section-title">준 영향</div>
        ${linkMarkup(outgoing)}
      </div>
    `;

    sidePanelBody.querySelectorAll<HTMLButtonElement>("button.sp-link").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.id;
        if (id) selectPhilosopher(id);
      });
    });
  }

  // ----- Tooltip -----

  function showTooltip(p: Philosopher) {
    const t = traditionById.get(p.tradition)!;
    tooltipEl.innerHTML = `
      <div class="tt-name">${escapeHtml(p.nameKo)}</div>
      <div class="tt-meta">${escapeHtml(p.name)} · ${formatYear(p.birth)}–${formatYear(p.death)} · ${escapeHtml(t.labelKo)}</div>
      <div class="tt-desc">${escapeHtml(p.desc)}</div>
    `;
    tooltipEl.classList.add("visible");
    tooltipEl.setAttribute("aria-hidden", "false");
  }

  function moveTooltip(event: MouseEvent) {
    tooltipEl.style.left = `${event.clientX}px`;
    tooltipEl.style.top = `${event.clientY}px`;
  }

  function hideTooltip() {
    tooltipEl.classList.remove("visible");
    tooltipEl.setAttribute("aria-hidden", "true");
  }

  // ----- Helpers -----

  function relatedIds(focusId: string): Set<string> {
    const p = philById.get(focusId);
    if (!p) return new Set();
    const s = new Set<string>([focusId]);
    p.influences.forEach((i) => s.add(i));
    philosophers.forEach((o) => {
      if (o.influences.includes(focusId)) s.add(o.id);
    });
    return s;
  }

  // Public resize handler for window events.
  const resizeObserver = new ResizeObserver(() => resize());
  resizeObserver.observe(container);

  return {
    resize,
  };
}

// ---------- Standalone helpers ----------

function orderTraditions(
  traditions: Tradition[],
  philosophers: Philosopher[],
  region: "east" | "west",
): Tradition[] {
  const inRegion = traditions.filter((t) => t.region === region);
  const median = (ids: number[]) => {
    if (!ids.length) return 0;
    const sorted = [...ids].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };
  return inRegion
    .map((t) => ({
      t,
      medianBirth: median(
        philosophers.filter((p) => p.tradition === t.id).map((p) => p.birth),
      ),
    }))
    .sort((a, b) => a.medianBirth - b.medianBirth)
    .map((x) => x.t);
}

function computeLineColors(
  philosophers: Philosopher[],
  traditionById: Map<string, Tradition>,
): Map<string, string> {
  const out = new Map<string, string>();
  const byId = new Map(philosophers.map((p) => [p.id, p]));

  function resolve(id: string, seen: Set<string>): string {
    const cached = out.get(id);
    if (cached) return cached;
    if (seen.has(id)) {
      return traditionById.get(byId.get(id)!.tradition)!.color;
    }
    seen.add(id);
    const p = byId.get(id);
    if (!p) return "#888";
    const ownColor = traditionById.get(p.tradition)!.color;
    if (p.influences.length === 0) {
      out.set(id, ownColor);
      return ownColor;
    }
    const firstParent = p.influences[0];
    const parentColor = resolve(firstParent, seen);
    const blended = mixHex(parentColor, ownColor, 0.55);
    out.set(id, blended);
    return blended;
  }

  for (const p of philosophers) {
    resolve(p.id, new Set());
  }
  return out;
}

function mixHex(a: string, b: string, t: number): string {
  const ac = hexToRgb(a);
  const bc = hexToRgb(b);
  const r = Math.round(ac.r * (1 - t) + bc.r * t);
  const g = Math.round(ac.g * (1 - t) + bc.g * t);
  const bl = Math.round(ac.b * (1 - t) + bc.b * t);
  return `#${[r, g, bl].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return { r, g, b };
}

function hashJitter(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  const n = Math.abs(h) / 2147483647;
  return n;
}

function formatYear(y: number): string {
  if (y < 0) return `BC ${-y}`;
  return `${y}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
