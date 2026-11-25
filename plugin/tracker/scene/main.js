// src/scene/looks.ts
var KNOWN = {
  main: { color: "#8b5cf6" },
  explore: { color: "#10b981" },
  plan: { color: "#3b82f6" },
  "code-reviewer": { color: "#f97316" },
  "general-purpose": { color: "#ec4899" }
};
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function hslToHex(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}
function looksFor(type) {
  const known = KNOWN[type] ?? KNOWN[type.toLowerCase()];
  if (known) return { ...known };
  return { color: hslToHex(hash(type) % 360, 0.62, 0.55) };
}
var SKINS = ["#f6d3b3", "#eab38c", "#d39a6a", "#b07247", "#8a5332", "#5e3a22"];
var HAIRS = ["#1f1a17", "#3b2a20", "#6b3e26", "#a0522d", "#d6a75c", "#8f8f99"];
var HAIR_STYLES = ["short", "long", "bun", "bald", "curly"];
var PANTS = ["#4a4766", "#2f3b52", "#5a4a3a", "#3f3f46"];
var pick = (list, h) => list[h % list.length];
function humanLook(id, type) {
  const h = hash(id);
  const skin = pick(SKINS, h);
  const hair = pick(HAIRS, hash("hair:" + id));
  const hairStyle = pick(HAIR_STYLES, hash("style:" + id));
  if (type === "boss") return { skin, hair, hairStyle, shirt: "#3d3a5c", pants: "#2e2b45", tie: "#d9455f" };
  return { skin, hair, hairStyle, shirt: looksFor(type).color, pants: pick(PANTS, hash("pants:" + id)) };
}
function poseClass(look, isBoss) {
  if (look.pose === "type") return "pose-type";
  if (look.fx === "stuck") return "pose-slump";
  if (look.pose === "raise_hand") return "pose-wave";
  if (isBoss && look.fx === "tap") return "pose-lean";
  return "pose-idle";
}
function agentLook(status, waiting = false, looping = false) {
  const present = status !== "handing_off" && status !== "gone";
  if (waiting && present) return { pose: "raise_hand", mood: "worried", screen: "code", fx: "alert", dim: false };
  if (looping && present) return { pose: "type", mood: "worried", screen: "err", fx: "loop", dim: false };
  switch (status) {
    case "quiet":
      return { pose: "scratch", mood: "worried", screen: "err", fx: "stuck", dim: false };
    case "spawning":
    case "handing_off":
      return { pose: "stand", mood: "happy", screen: "code", fx: "none", dim: false };
    case "working":
    case "gone":
    default:
      return { pose: "type", mood: "focus", screen: "code", fx: "none", dim: false };
  }
}
function bossLook(status) {
  switch (status) {
    case "idle":
      return { pose: "stand", mood: "sleepy", screen: "code", fx: "zzz", dim: true };
    case "needs_you":
      return { pose: "raise_hand", mood: "worried", screen: "code", fx: "alert", dim: false };
    case "waiting_on_team":
      return { pose: "stand", mood: "happy", screen: "code", fx: "tap", dim: false };
    case "working":
    case "delegating":
    default:
      return { pose: "type", mood: "happy", screen: "code", fx: "none", dim: false };
  }
}
function truncate(text, max) {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return t.slice(0, Math.max(0, max - 1)).trimEnd() + "\u2026";
}
function liveTokens(s) {
  return typeof s.contextTokens === "number" && Number.isFinite(s.contextTokens) ? s.contextTokens : void 0;
}
var RUNNING_AFTER_MS = 3e4;
function toolNote(o, now) {
  if (o.looping) return { text: `\u21BB looping? ${o.looping.tool} \xD7${o.looping.count}`, kind: "looping" };
  if (o.tool && now - o.tool.since >= RUNNING_AFTER_MS) return { text: `\u23F3 running ${o.tool.name} \xB7 {t}`, since: o.tool.since, kind: "running" };
  return void 0;
}
function runningKey(state, now) {
  const keys = [];
  for (const s of Object.values(state?.sessions ?? {})) {
    if (s.boss.tool && now - s.boss.tool.since >= RUNNING_AFTER_MS) keys.push(`${s.id}/boss`);
    for (const a of Object.values(s.agents)) if (a.tool && now - a.tool.since >= RUNNING_AFTER_MS) keys.push(`${s.id}/${a.id}`);
  }
  return keys.sort().join(" ");
}
function formatTimer(ms) {
  const s = Math.max(0, Math.floor(ms / 1e3));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// src/scene/layout.ts
function roomTitle(s) {
  return s.name || s.label;
}
function signText(s, roomW, count) {
  const maxChars = Math.max(10, Math.floor((roomW - 40) / 6.6) - count.length);
  let label = roomTitle(s);
  let sub = s.subLabel ? ` \xB7 ${s.subLabel}` : "";
  let branch = s.branch ? `  \u2387 ${s.branch}` : "";
  if (label.length + sub.length + branch.length > maxChars) {
    label = truncate(label, Math.max(8, Math.floor(maxChars * 0.45)));
    const rest = maxChars - label.length;
    sub = sub ? truncate(sub, Math.max(6, Math.floor(rest * 0.45))) : "";
    branch = branch ? truncate(branch, Math.max(6, rest - sub.length)) : "";
  }
  return { label, sub, branch };
}
var MIN_ROOM_W = 320;
var MIN_ROOM_H = 220;
var ROOM_GAP = 10;
var clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function layoutRooms(n, width, height) {
  if (n <= 0) return [];
  const g = ROOM_GAP;
  width = Math.max(1, width);
  height = Math.max(1, height);
  const maxCols = Math.max(1, Math.floor((width - g) / (MIN_ROOM_W + g)));
  const squareish = Math.max(1, Math.round(Math.sqrt(n * width / height / 1.45)));
  const cols = Math.min(maxCols, n, n <= 3 ? n : squareish);
  const rows = Math.ceil(n / cols);
  const w = Math.max(MIN_ROOM_W, Math.floor((width - g * (cols + 1)) / cols));
  const fitH = Math.floor((height - g * (rows + 1)) / rows);
  const h = Math.max(MIN_ROOM_H, Math.min(fitH, Math.round(w * 0.9)));
  const out = [];
  for (let i = 0; i < n; i++) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    out.push({ x: g + c * (w + g), y: g + r * (h + g), w, h });
  }
  return out;
}
var SIGN_H = 22;
var TAG_H = 36;
var HEAD_TOP = 58;
var DESK_BOTTOM = 4;
var MIN_SCALE = 0.4;
var MAX_SCALE = 1.6;
var WS_LEFT = 21;
var WS_RIGHT = 84;
function seatingOrder(session) {
  const visible = Object.values(session.agents).filter((a) => a.status !== "gone");
  const ids = new Set(visible.map((a) => a.id));
  const byStart = (a, b) => a.startedAt - b.startedAt || (a.id < b.id ? -1 : 1);
  const kids = /* @__PURE__ */ new Map();
  for (const a of visible) {
    const p = a.parentId && ids.has(a.parentId) && a.parentId !== a.id ? a.parentId : null;
    const list = kids.get(p) ?? [];
    list.push(a);
    kids.set(p, list);
  }
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  const walk = (parent, depth) => {
    for (const a of (kids.get(parent) ?? []).sort(byStart)) {
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      out.push({ id: a.id, depth, parent });
      walk(a.id, depth + 1);
    }
  };
  walk(null, 0);
  for (const a of visible.sort(byStart)) if (!seen.has(a.id)) out.push({ id: a.id, depth: 0, parent: null });
  return out;
}
function assignSeats(order, prev = {}, opts = {}) {
  const cols = Math.max(1, Math.floor(opts.cols ?? 1));
  const out = {};
  const taken = /* @__PURE__ */ new Set();
  for (const id of order) {
    const s = prev[id];
    if (Number.isInteger(s) && s >= 0 && !taken.has(s)) {
      out[id] = s;
      taken.add(s);
    }
  }
  let next = 0;
  for (const id of order) {
    if (id in out) continue;
    const parent = opts.parentOf?.[id];
    const ps = parent != null ? out[parent] : void 0;
    let slot;
    if (ps !== void 0) {
      const limit = Math.max(ps, ...taken) + cols + 1;
      const pr = Math.floor(ps / cols);
      const pc = ps % cols;
      slot = -1;
      let best = Infinity;
      for (let i = 0; i <= limit; i++) {
        if (taken.has(i)) continue;
        const d = (Math.floor(i / cols) - pr) ** 2 + (i % cols - pc) ** 2;
        if (d < best) {
          best = d;
          slot = i;
        }
      }
    } else {
      while (taken.has(next)) next++;
      slot = next;
    }
    out[id] = slot;
    taken.add(slot);
  }
  return out;
}
function visibleSessions(sessions, faded, existing) {
  return sessions.filter((s) => s.status !== "ended" || !faded.has(s.id) && (!existing || existing.has(s.id)));
}
function roomLayout(session, rect, prevSlots) {
  const { w, h } = rect;
  const wallH = Math.round(h * 0.34);
  const sMax = Math.round(clamp(Math.min(w / 560, h / 330), 0.7, MAX_SCALE) * 20) / 20;
  const bossW = clamp(Math.round(w * 0.28), 96, 240);
  const bossFloorY = wallH + (h - wallH) * 0.55;
  const bossScale = Math.min(
    clamp(bossW / 170, 0.5, 1) * Math.max(1, sMax),
    (bossW * 0.64 - 4) / WS_RIGHT,
    Math.max(0.5, (bossFloorY - SIGN_H - 12 - TAG_H) / HEAD_TOP)
  );
  const dw = clamp(Math.round(h * 0.17), 34, 54);
  const dh = Math.round(dw * 1.6);
  const doorRect = { x: w - dw - 12, y: Math.max(SIGN_H + 10, wallH - dh), w: dw, h: Math.min(dh, wallH - SIGN_H - 10) };
  const door = { x: doorRect.x + dw / 2, y: Math.min(h - 10, wallH + 16) };
  const order = seatingOrder(session);
  const ids = order.map((o) => o.id);
  const parentOf = Object.fromEntries(order.map((o) => [o.id, o.parent]));
  const x0 = bossW + 12;
  const x1 = w - 10;
  const aw = x1 - x0;
  const fit = (cells) => {
    let g2 = { scale: sMax, cols: 1, rows: 1, slotW: 0, slotH: 0, yMin: 0, yMax: 0 };
    for (let s = sMax; s >= MIN_SCALE - 1e-9; s -= 0.05) {
      const scale2 = Math.round(s * 100) / 100;
      const slotW2 = Math.max(115 * scale2, 92);
      const slotH2 = 94 * scale2 + TAG_H + 8;
      const yMin2 = Math.max(wallH + 6, 6 + SIGN_H + 6 + TAG_H + HEAD_TOP * scale2);
      const yMax2 = h - DESK_BOTTOM * scale2 - 6;
      const cols2 = Math.max(1, Math.floor(aw / slotW2));
      const rows2 = yMax2 >= yMin2 ? Math.floor((yMax2 - yMin2) / slotH2) + 1 : 1;
      g2 = { scale: scale2, cols: cols2, rows: rows2, slotW: slotW2, slotH: slotH2, yMin: yMin2, yMax: yMax2 };
      if (cols2 * rows2 >= cells && slotW2 <= aw && yMax2 >= yMin2) break;
    }
    return g2;
  };
  const cellsFor = (sl) => ids.length ? Math.max(...Object.values(sl)) + 1 : 0;
  const est = fit(ids.length);
  let slots = assignSeats(ids, prevSlots, { parentOf, cols: est.cols });
  let g = fit(cellsFor(slots));
  if (g.cols !== est.cols) {
    slots = assignSeats(ids, prevSlots, { parentOf, cols: g.cols });
    g = fit(cellsFor(slots));
  }
  const n = cellsFor(slots);
  const { scale, yMin, yMax } = g;
  let { cols, rows, slotW, slotH } = g;
  const seats = {};
  const crowded = cols * rows < n;
  if (!crowded) {
    const usedRows = Math.max(1, Math.min(rows, Math.ceil(n / cols)));
    const gx = x0 + Math.max(0, aw - cols * slotW) / 2;
    const gy = yMin + Math.max(0, yMax - yMin - (usedRows - 1) * slotH) / 2;
    const mid = (WS_RIGHT - WS_LEFT) / 2 * scale;
    order.forEach(({ id, depth }) => {
      const i = slots[id];
      const c = i % cols;
      const r = Math.floor(i / cols);
      seats[id] = { x: Math.round(gx + c * slotW + slotW / 2 - mid), y: Math.round(gy + r * slotH), depth };
    });
  } else {
    const spanY = Math.max(0, yMax - yMin);
    while (cols * rows < n) {
      const pitchX = aw / (cols + 1) / 115;
      const pitchY = spanY / rows / 94;
      if (pitchX >= pitchY) cols++;
      else rows++;
    }
    const left = x0 + WS_LEFT * scale;
    const right = x1 - WS_RIGHT * scale;
    slotW = cols > 1 ? (right - left) / (cols - 1) : aw;
    slotH = rows > 1 ? spanY / (rows - 1) : slotH;
    order.forEach(({ id, depth }) => {
      const i = slots[id];
      const c = i % cols;
      const r = Math.floor(i / cols);
      seats[id] = { x: Math.round(left + c * (cols > 1 ? slotW : 0)), y: Math.round(yMin + r * (rows > 1 ? slotH : 0)), depth };
    });
  }
  const boss = {
    x: Math.round(bossW * 0.36),
    y: Math.round(Math.min(h - DESK_BOTTOM * bossScale - 8, wallH + (h - wallH) * 0.55))
  };
  const taskChars = slotW < 70 ? 0 : clamp(Math.floor((slotW - 6) / 5), 12, 28);
  return { rect, wallH, bossW, bossScale, scale, slotW, taskChars, boss, doorRect, door, seats, order: order.map((o) => o.id), slots, crowded };
}
function handoffTarget(layout, agent) {
  const parent = agent.parentId ? layout.seats[agent.parentId] : void 0;
  if (parent) return { x: parent.x + 90 * layout.scale, y: parent.y };
  return { x: layout.boss.x + 90 * layout.bossScale, y: layout.boss.y };
}

// src/shared/counts.ts
function workingCount(s) {
  if (s.status === "ended") return 0;
  let n = s.boss.status === "working" || s.boss.status === "delegating" ? 1 : 0;
  for (const a of Object.values(s.agents)) if (a.status === "working" || a.status === "spawning" || a.status === "handing_off") n++;
  return n;
}
function needsYou(s) {
  return s.status !== "ended" && s.boss.status === "needs_you";
}
function waitingOnYou(state) {
  return Object.values(state.sessions).filter(needsYou).length;
}
function officeTitle(waiting) {
  return waiting > 0 ? `(${waiting}) Agent Office` : "Agent Office";
}

// src/core/pricing.ts
var MODELS = {
  "claude-fable-5-2": { inputPerM: 8, outputPerM: 40, cacheReadPerM: 0.2, cacheWritePerM: 16, cacheWrite5mPerM: 10, contextSize: 1e6 },
  "claude-fable-5-1": { inputPerM: 10, outputPerM: 50, cacheReadPerM: 0.25, cacheWritePerM: 20, cacheWrite5mPerM: 12.5, contextSize: 1e6 },
  "claude-opus-5-5": { inputPerM: 4, outputPerM: 20, cacheReadPerM: 0.2, cacheWritePerM: 8, cacheWrite5mPerM: 5, contextSize: 1e6 },
  "claude-sonnet-5-5": { inputPerM: 2, outputPerM: 10, cacheReadPerM: 0.1, cacheWritePerM: 4, cacheWrite5mPerM: 2.5, contextSize: 1e6 },
  "claude-sonnet-4-6": { inputPerM: 3, outputPerM: 15, cacheReadPerM: 0.3, cacheWritePerM: 6, cacheWrite5mPerM: 3.75, contextSize: 1e6 },
  "claude-haiku-5-5": {
    inputPerM: 0.1,
    outputPerM: 0.5,
    cacheReadPerM: 0.01,
    cacheWritePerM: 0.2,
    cacheWrite5mPerM: 0.125,
    contextSize: 1e6,
    long: { over: 1e5, inputPerM: 0.5, outputPerM: 2.5, cacheReadPerM: 0.05, cacheWritePerM: 1, cacheWrite5mPerM: 0.625 }
  }
};
var lookup = (model) => model !== void 0 && Object.prototype.hasOwnProperty.call(MODELS, model) ? MODELS[model] : void 0;
function contextSize(model) {
  return lookup(model)?.contextSize;
}
function estimateCost(stats) {
  const m = lookup(stats.model);
  if (!m) return null;
  return (stats.inputTokens * m.inputPerM + stats.outputTokens * m.outputPerM + stats.cacheRead * m.cacheReadPerM + stats.cacheWrite * m.cacheWritePerM) / 1e6;
}

// src/scene/panel.ts
var DASH = "\u2014";
function formatTokens(n) {
  if (n === void 0 || !Number.isFinite(n)) return DASH;
  n = Math.max(0, n);
  if (n >= 1e6) return (n / 1e6).toFixed(2).replace(/\.?0+$/, "") + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
  return String(Math.round(n));
}
function formatDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1e3));
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${String(Math.floor(s % 3600 / 60)).padStart(2, "0")}m`;
  if (s >= 60) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
  return `${s}s`;
}
function formatCost(c) {
  return c === null || !Number.isFinite(c) ? DASH : `~$${c.toFixed(3)}`;
}
var pad = (n) => String(n).padStart(2, "0");
function clock(ms) {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function hasUsage(st) {
  return st.model !== void 0 || !!(st.inputTokens || st.outputTokens || st.cacheRead || st.cacheWrite);
}
var AGENT_STATUS = {
  working: ["Working", "#10b981"],
  quiet: ["Maybe stuck", "#dc2626"],
  handing_off: ["Handing off", "#f97316"],
  gone: ["Left", "#64748b"],
  spawning: ["Spawning", "#3b82f6"]
};
var BOSS_STATUS = {
  working: ["Working", "#8b5cf6"],
  delegating: ["Delegating", "#8b5cf6"],
  waiting_on_team: ["Waiting on team", "#3b82f6"],
  idle: ["Idle", "#64748b"],
  needs_you: ["Needs you", "#dc2626"]
};
function panelModel(target, now) {
  const { session, agentId } = target;
  if (!session) return null;
  const isBoss = agentId === "boss";
  const agent = isBoss ? void 0 : session.agents[agentId];
  if (!isBoss && !agent) return null;
  const st = isBoss ? session.boss.stats : agent.stats;
  const startedAt = isBoss ? session.boss.startedAt : agent.startedAt;
  const endedAt = isBoss ? session.status === "ended" ? session.lastActivity : void 0 : agent.endedAt;
  let statusLabel;
  let statusColor;
  const toolLine = (o) => {
    const n = toolNote(o, now);
    if (!n) return void 0;
    return n.kind === "looping" ? [`Looping? Same ${o.looping.tool} call ${o.looping.count}\xD7 in a row`, "#e11d48"] : [`Running ${o.tool.name} \xB7 ${formatDuration(now - o.tool.since)} (busy, not stuck)`, "#2563eb"];
  };
  if (isBoss) {
    [statusLabel, statusColor] = BOSS_STATUS[session.boss.status] ?? [String(session.boss.status), "#64748b"];
    const line = session.boss.status !== "idle" && session.boss.status !== "needs_you" && session.status !== "ended" ? toolLine(session.boss) : void 0;
    if (line) [statusLabel, statusColor] = line;
  } else {
    [statusLabel, statusColor] = AGENT_STATUS[agent.status] ?? [String(agent.status), "#64748b"];
    if (agent.status === "quiet") statusLabel += ` \xB7 ${formatDuration(now - st.lastActivity)} quiet`;
    const line = agent.status !== "handing_off" && agent.status !== "gone" ? toolLine(agent) : void 0;
    if (line) [statusLabel, statusColor] = line;
    if (agent.waitingOnYou && agent.status !== "handing_off" && agent.status !== "gone") [statusLabel, statusColor] = ["Waiting on you \xB7 its prompt is open", "#d97706"];
  }
  const noUsage = !hasUsage(st);
  const tok = (n) => noUsage ? DASH : formatTokens(n);
  const size = contextSize(st.model);
  const memoryLabel = size ? `in memory now \xB7 of ${formatTokens(size)}` : "in memory now";
  const pct = typeof st.contextFill === "number" && Number.isFinite(st.contextFill) ? Math.round(st.contextFill * 100) : void 0;
  const tools = Object.entries(st.tools).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : 1));
  const type = isBoss ? "main" : agent.type;
  const agents = Object.values(session.agents);
  const spawned = Math.max(agents.length, session.boss.stats.tools.Agent ?? 0);
  const running2 = agents.filter((a) => a.status !== "gone" && a.status !== "handing_off" && a.status !== "quiet").length;
  const stuck = agents.filter((a) => a.status === "quiet").length;
  return {
    name: isBoss ? "Main agent" : agent.name ?? agent.type,
    type,
    task: isBoss ? [roomTitle(session), session.subLabel].filter(Boolean).join(" \xB7 ") : agent.task ?? "",
    color: looksFor(type).color,
    statusLabel,
    statusColor,
    model: st.model ?? DASH,
    tokens: { input: tok(st.inputTokens), output: tok(st.outputTokens), cacheRead: tok(st.cacheRead), cacheWrite: tok(st.cacheWrite) },
    memory: noUsage ? DASH : formatTokens(liveTokens(st)),
    memoryLabel,
    duration: formatDuration((endedAt ?? now) - startedAt),
    startedAt: clock(startedAt),
    cost: noUsage ? DASH : formatCost(estimateCost(st)),
    contextPct: pct,
    contextLabel: pct === void 0 ? DASH : `${pct}%`,
    tools,
    toolTotal: tools.reduce((n, t) => n + t.count, 0),
    files: st.files,
    recent: st.recent,
    team: isBoss ? { spawned, done: Math.max(0, spawned - running2 - stuck), stuck } : void 0
  };
}
function el(tag, cls, text, parent) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== void 0) e.textContent = text;
  parent?.appendChild(e);
  return e;
}
var InfoPanel = class {
  constructor(root) {
    this.root = root;
  }
  root;
  sel = null;
  last = null;
  /** called after open/close so the host can re-fit the zoom */
  onChange = () => {
  };
  get selection() {
    return this.sel;
  }
  get isOpen() {
    return this.sel !== null;
  }
  open(sel, state, now = Date.now()) {
    const changed = !this.sel || this.sel.sessionId !== sel.sessionId || this.sel.agentId !== sel.agentId;
    this.sel = sel;
    if (changed) {
      this.last = null;
      this.root.scrollTop = 0;
    }
    this.root.hidden = false;
    this.refresh(state, now);
    this.onChange();
  }
  close() {
    if (!this.sel) return;
    this.sel = null;
    this.last = null;
    this.root.hidden = true;
    this.root.replaceChildren();
    this.onChange();
  }
  refresh(state, now = Date.now()) {
    if (!this.sel) return;
    const session = state.sessions[this.sel.sessionId];
    const m = session ? panelModel({ session, agentId: this.sel.agentId }, now) : null;
    if (m) this.last = m;
    if (!this.last) {
      this.draw(null, true);
      return;
    }
    this.draw(this.last, !m);
  }
  draw(m, left) {
    const root = this.root;
    const scrolls = Array.from(root.querySelectorAll(".log")).map((e) => e.scrollTop);
    const billingOpen = root.querySelector("details.billing")?.open ?? false;
    const top = root.scrollTop;
    root.replaceChildren();
    const close = el("button", "p-close", "\xD7", root);
    close.type = "button";
    close.setAttribute("aria-label", "Close panel");
    close.dataset.action = "close";
    if (!m) {
      el("h3", void 0, "This agent has left the office", root);
      return;
    }
    const h = el("h3", void 0, void 0, root);
    const dot = el("span", void 0, "\u25CF", h);
    dot.style.color = m.color;
    h.append(" " + m.name);
    if (m.task) el("div", "sub", m.task, root);
    if (left) el("div", "p-left", "This agent has left the office. Showing last-known numbers.", root);
    const chips = el("div", void 0, void 0, root);
    const status = el("span", "chip", left ? "Left" : m.statusLabel, chips);
    status.style.background = (left ? "#64748b" : m.statusColor) + "22";
    status.style.color = left ? "#64748b" : m.statusColor;
    el("span", "chip chip-model", m.model, chips);
    if (m.type !== m.name) el("span", "chip chip-model", m.type, chips);
    const grid = el("div", "grid", void 0, root);
    const stat = (v, label) => {
      const s = el("div", "stat", void 0, grid);
      el("b", void 0, v, s);
      el("span", void 0, label, s);
    };
    stat(m.memory, m.memoryLabel);
    stat(m.tokens.output, "written by the agent");
    stat(m.duration, `running time \xB7 since ${m.startedAt}`);
    stat(m.cost, "estimated cost");
    el("h4", void 0, `Memory used \xB7 ${m.contextLabel}`, root);
    const bar = el("div", "bar", void 0, root);
    const fill = el("i", void 0, void 0, bar);
    fill.style.width = m.contextPct === void 0 ? "0%" : `${Math.max(0, Math.min(100, m.contextPct))}%`;
    const billing = el("details", "billing", void 0, root);
    billing.open = billingOpen;
    el("summary", void 0, "Billing details", billing);
    el("div", "bill-row", `input ${m.tokens.input} \xB7 output ${m.tokens.output} \xB7 cache read ${m.tokens.cacheRead} \xB7 cache write ${m.tokens.cacheWrite}`, billing);
    el("div", "bill-note", "Totals for the whole run. Each step re-reads the conversation from the cache, so cache read grows much faster than memory.", billing);
    el("h4", void 0, `Tool calls (${m.toolTotal})`, root);
    const tools = el("div", "tools", void 0, root);
    if (!m.tools.length) el("span", void 0, DASH, tools);
    for (const t of m.tools) el("span", void 0, `${t.name} \xD7 ${t.count}`, tools);
    if (m.team) {
      el("h4", void 0, "Team", root);
      el("div", void 0, `${m.team.spawned} subagents spawned \xB7 ${m.team.done} done \xB7 ${m.team.stuck} stuck`, root);
    }
    const list = (title, items) => {
      el("h4", void 0, title, root);
      const log = el("div", "log", void 0, root);
      if (!items.length) el("div", void 0, DASH, log);
      for (const it of items) el("div", void 0, it, log);
    };
    list("Files touched", m.files);
    list("Recent activity", m.recent);
    root.scrollTop = top;
    root.querySelectorAll(".log").forEach((e, i) => {
      if (scrolls[i] !== void 0) e.scrollTop = scrolls[i];
    });
  }
};

// src/scene/tokTicker.ts
var TICK_MS = 900;
var SVGNS = "http://www.w3.org/2000/svg";
function tickValue(from, to, elapsed, dur = TICK_MS) {
  if (elapsed >= dur || dur <= 0) return to;
  const t = Math.max(0, elapsed) / dur;
  return Math.round(from + (to - from) * (1 - Math.pow(1 - t, 3)));
}
var tokLabel = (n) => `\u26A1 ${n === void 0 ? "\u2014" : formatTokens(n)} tok`;
function writeTok(el2, text) {
  let bolt = el2.querySelector("tspan.bolt");
  let val = el2.querySelector("tspan.val");
  if (!bolt || !val) {
    el2.textContent = "";
    bolt = document.createElementNS(SVGNS, "tspan");
    bolt.setAttribute("class", "bolt");
    val = document.createElementNS(SVGNS, "tspan");
    val.setAttribute("class", "val");
    el2.append(bolt, val);
  }
  const i = text.indexOf(" ");
  const b = i < 0 ? "" : text.slice(0, i);
  const v = i < 0 ? text : text.slice(i);
  if (bolt.textContent !== b) bolt.textContent = b;
  if (val.textContent !== v) val.textContent = v;
}
var ticks = /* @__PURE__ */ new WeakMap();
var reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
function setTok(el2, target) {
  const cur = ticks.get(el2);
  if (target === void 0) {
    if (cur?.raf) cancelAnimationFrame(cur.raf);
    ticks.delete(el2);
    delete el2.dataset.ticking;
    writeTok(el2, tokLabel(void 0));
    return;
  }
  if (cur && cur.target === target) return;
  if (!cur || reduced() || typeof requestAnimationFrame !== "function") {
    if (cur?.raf) cancelAnimationFrame(cur.raf);
    ticks.set(el2, { shown: target, target, from: target, start: 0 });
    delete el2.dataset.ticking;
    writeTok(el2, tokLabel(target));
    return;
  }
  if (cur.raf) cancelAnimationFrame(cur.raf);
  const t = { shown: cur.shown, target, from: cur.shown, start: performance.now() };
  ticks.set(el2, t);
  el2.dataset.ticking = "1";
  el2.classList.remove("bump");
  void el2.getBoundingClientRect();
  el2.classList.add("bump");
  const step = (now) => {
    if (ticks.get(el2) !== t) return;
    t.shown = tickValue(t.from, t.target, now - t.start);
    writeTok(el2, tokLabel(t.shown));
    if (t.shown === t.target) {
      t.raf = void 0;
      delete el2.dataset.ticking;
      el2.classList.remove("bump");
      return;
    }
    t.raf = requestAnimationFrame(step);
  };
  t.raf = requestAnimationFrame(step);
}

// src/scene/characters.ts
var NS = "http://www.w3.org/2000/svg";
function svgEl(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  if (parent) parent.appendChild(e);
  return e;
}
function html(g, s) {
  g.insertAdjacentHTML("beforeend", s);
}
var r1 = (n) => Math.round(n * 10) / 10;
var RIG = { head: 8, torso: 21, leg: 22, arm: 19, w: 14, rx: 3 };
var HALF_LEG = RIG.leg / 2;
var STATE_CLASSES = ["walking", "sitting", "carrying", "giving", "cheer", "dancing"];
var POSE_CLASSES = ["pose-type", "pose-slump", "pose-wave", "pose-lean", "pose-idle"];
function stateClasses(pose, animPose) {
  switch (animPose) {
    case "walk":
      return ["walking"];
    case "carry":
      return ["walking", "carrying"];
    case "wave":
      return ["cheer"];
    case null:
      return pose === "pose-wave" ? [pose] : ["sitting", pose];
    default:
      return [];
  }
}
var shade = (hex, k) => {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
  return "#" + [n >> 16, n >> 8 & 255, n & 255].map((v) => c(v).toString(16).padStart(2, "0")).join("");
};
function hairMarkup(o, hy) {
  const r = RIG.head;
  const c = o.hair;
  const cap = `<path d="M ${-r} ${hy} A ${r} ${r} 0 0 1 ${r} ${hy - 1} L ${r * 0.2} ${hy - r * 0.45} L ${-r * 0.6} ${hy + r * 0.55} Z" fill="${c}"/>`;
  switch (o.hairStyle) {
    case "long":
      return { back: `<rect x="${-r - 0.5}" y="${hy - 2}" width="${r * 0.95}" height="${r * 1.7}" rx="2" fill="${c}"/>`, front: cap };
    case "bun":
      return { back: `<circle cx="${-r * 0.8}" cy="${hy - r * 0.75}" r="3.6" fill="${c}"/>`, front: cap };
    case "bald":
      return { back: "", front: `<ellipse cx="${-r * 0.78}" cy="${hy + 0.5}" rx="2" ry="3.6" fill="${c}"/>` };
    case "curly": {
      const curls = [[-0.95, 0.25, 3], [-0.8, -0.35, 3.4], [-0.45, -0.8, 3.4], [0.05, -0.95, 3.2], [0.5, -0.75, 2.8]];
      return { back: "", front: curls.map(([x, y, cr]) => `<circle cx="${r1(x * r)}" cy="${r1(hy + y * r)}" r="${cr}" fill="${c}"/>`).join("") };
    }
    case "short":
    default:
      return { back: "", front: cap };
  }
}
function personMarkup(o, mood = "focus", scale = 1) {
  const S = RIG;
  const L = HALF_LEG;
  const hip = -S.leg;
  const sh = hip - S.torso;
  const hy = sh - S.head + 1;
  const w = S.w;
  const lw = r1(w * 0.42);
  const aw = r1(w * 0.32);
  const leg = (back) => {
    const k = back ? 0.82 : 1;
    return `<g class="limb leg ${back ? "back" : "front"}" style="transform-origin:0px ${hip}px">
        <rect x="${-lw / 2}" y="${hip}" width="${lw}" height="${L + 1}" rx="${S.rx / 2}" fill="${shade(o.pants, k)}"/>
        <g class="shin" style="transform-origin:0px ${hip + L}px">
          <rect x="${-lw / 2}" y="${hip + L}" width="${lw}" height="${L}" rx="${S.rx / 2}" fill="${shade(o.pants, k)}"/>
          <rect x="${-lw / 2}" y="-3" width="${lw + 4}" height="3" rx="1" fill="${shade("#3a3346", k)}"/>
        </g></g>`;
  };
  const arm = (back) => {
    const k = back ? 0.82 : 1;
    return `<g class="limb arm ${back ? "back" : "front"}" style="transform-origin:0px ${sh + 3}px">
        <rect x="${-aw / 2}" y="${sh + 2}" width="${aw}" height="${S.arm - 3}" rx="${S.rx / 2}" fill="${shade(o.shirt, k)}"/>
        <rect x="${-aw / 2}" y="${sh + S.arm - 2}" width="${aw}" height="4" rx="${S.rx / 2}" fill="${shade(o.skin, k)}"/>
        ${back ? "" : `<rect class="paper" x="-4" y="${sh + S.arm}" width="9" height="11" fill="#fff" stroke="#bbb" stroke-width=".6"/>`}
      </g>`;
  };
  const hair = hairMarkup(o, hy);
  const eye = mood === "sleepy" ? `<rect x="${r1(S.head * 0.3)}" y="${hy + 0.5}" width="3" height="1" fill="#2b2540"/>` : `<rect class="blink" x="${r1(S.head * 0.4)}" y="${hy - 1}" width="2" height="2.4" fill="#2b2540"/>`;
  const tie = o.tie ? `<path d="M ${w / 2 - 5} ${sh} l 4.5 0 l -2.2 4 Z" fill="#f8fafc"/><path class="tie" d="M ${w / 2 - 3} ${sh + 1} l 2 0 l 1 ${r1(S.torso * 0.55)} l -2 2 l -2 -2 Z" fill="${o.tie}"/>` : "";
  const props = `<g class="forearms"><rect x="-1" y="${sh + 10}" width="${w / 2 + 3}" height="${aw}" rx="${S.rx / 2}" fill="${shade(o.shirt, 0.9)}"/>
      <rect x="${w / 2}" y="${sh + 10}" width="3.5" height="${aw}" rx="1.5" fill="${o.skin}"/></g>
    <g class="prop"><line x1="16" y1="${sh + 9}" x2="6" y2="${sh + 2}" stroke="${shade(o.shirt, 0.9)}" stroke-width="${aw}" stroke-linecap="round"/>
      <circle cx="5.5" cy="${sh + 1.5}" r="2.6" fill="${o.skin}"/></g>`;
  return `<g class="body"><g class="rig" transform="scale(${scale})">
      ${leg(true)}${leg(false)}
      <g class="upper" style="transform-origin:0px ${hip}px">
        ${arm(true)}
        <rect x="${-w / 2}" y="${sh}" width="${w}" height="${S.torso + 2}" rx="${S.rx}" fill="${o.shirt}"/>${tie}
        <rect x="-2" y="${sh - 3}" width="4" height="4" fill="${shade(o.skin, 0.9)}"/>
        ${hair.back}
        <circle cx="0" cy="${hy}" r="${S.head}" fill="${o.skin}"/>
        <circle cx="${S.head - 0.5}" cy="${hy + 1.5}" r="1.6" fill="${o.skin}"/>
        <circle cx="-1.5" cy="${hy + 1}" r="1.8" fill="${shade(o.skin, 0.88)}"/>
        ${hair.front}${eye}
        ${props}
        ${arm(false)}
      </g>
    </g></g>`;
}
function fxMarkup(fx, s) {
  const top = -HEAD_TOP * s;
  switch (fx) {
    case "stuck":
      return `<text class="sweat" x="${r1(18 * s)}" y="${r1(top + 6)}" font-size="12">\u{1F4A7}</text>
        <g transform="translate(${r1(-30 * s - 6)},${r1(top + 4)})"><g class="bubbleq"><circle r="8" fill="#fff" stroke="#dc2626" stroke-width="1.5"/><text y="4" font-size="11" font-weight="800" fill="#dc2626" text-anchor="middle">?</text></g></g>
        <g transform="translate(0,${r1(4 * s + 2)})"><rect x="-24" y="0" width="48" height="14" rx="7" fill="#dc2626"/><text class="timer" y="10.5" font-size="9" font-weight="700" fill="#fff" text-anchor="middle">\u23F1 0:00</text></g>`;
    case "alert":
      return `<g transform="translate(${r1(-30 * s - 8)},${r1(top + 2)})"><g class="bubbleq"><circle r="9" fill="#fff" stroke="#f59e0b" stroke-width="2"/><text y="4.5" font-size="13" font-weight="900" fill="#d97706" text-anchor="middle">!</text></g></g>`;
    case "zzz":
      return `<g transform="translate(${r1(10 * s)},${r1(top + 12 * s)})" fill="#64748b" font-weight="700">
        <text class="zz" font-size="10">z</text><text class="zz" style="animation-delay:.8s" x="5" y="-5" font-size="12">z</text><text class="zz" style="animation-delay:1.6s" x="10" y="-11" font-size="14">z</text></g>`;
    case "tap":
      return `<g transform="translate(${r1(-30 * s - 8)},${r1(top + 4)})"><g class="bubbleq"><rect x="-11" y="-8" width="22" height="15" rx="7" fill="#fff" stroke="#94a3b8"/><text y="3.5" font-size="10" font-weight="800" fill="#475569" text-anchor="middle">\u2026</text></g></g>`;
    case "loop":
      return `<g transform="translate(${r1(-30 * s - 8)},${r1(top + 3)})"><g class="bubbleq"><circle r="9" fill="#fff" stroke="#e11d48" stroke-width="2"/><text class="loopy" y="4.5" font-size="13" font-weight="900" fill="#e11d48" text-anchor="middle">\u21BB</text></g></g>`;
    default:
      return "";
  }
}
function bustFxMarkup(fx) {
  const bubble = (stroke, color, ch) => `<g transform="translate(-8,-53.6) scale(.6)"><g class="bubbleq"><circle r="9" fill="#fff" stroke="${stroke}" stroke-width="2"/><text y="4.5" font-size="13" font-weight="900" fill="${color}" text-anchor="middle">${ch}</text></g></g>`;
  switch (fx) {
    case "alert":
      return bubble("#f59e0b", "#d97706", "!");
    case "stuck":
      return bubble("#dc2626", "#dc2626", "?");
    case "tap":
      return bubble("#94a3b8", "#475569", "\u2026");
    case "loop":
      return bubble("#e11d48", "#e11d48", "\u21BB");
    default:
      return "";
  }
}
function renderCharacter(opts) {
  const g = svgEl("g", { class: "char" });
  const anim = svgEl("g", { class: "anim" }, g);
  const dir = svgEl("g", { class: "dir" }, anim);
  dir.dataset.sig = "";
  svgEl("g", { class: "fx" }, anim);
  const tag = svgEl("g", { class: "tag" }, anim);
  svgEl("rect", { class: "pill", height: 15, rx: 7.5, fill: "#fff", "stroke-width": 1.5 }, tag);
  svgEl("text", { class: "name", "font-size": 10, "font-weight": 700, "text-anchor": "middle", fill: "#111" }, tag);
  svgEl("text", { class: "task", "font-size": 8, "text-anchor": "middle", fill: "#334155" }, tag);
  svgEl("text", { class: "tok", "font-size": 8, "font-weight": 600, "text-anchor": "middle", fill: "#334155" }, tag);
  updateCharacter(g, opts);
  return g;
}
var lastOpts = /* @__PURE__ */ new WeakMap();
function setStepClasses(g, classes) {
  if (classes) g.dataset.step = classes.join(" ");
  else delete g.dataset.step;
  applyClasses(g);
}
function setCheer(g, on) {
  const n = Math.max(0, (Number(g.dataset.cheer) || 0) + (on ? 1 : -1));
  if (n > 0) g.dataset.cheer = String(n);
  else delete g.dataset.cheer;
  applyClasses(g);
}
function stepClassesOf(g) {
  const s = g.dataset.step;
  return s === void 0 ? null : s.split(" ").filter(Boolean);
}
function applyClasses(g) {
  const pose = g.dataset.pose;
  let classes;
  if (g.dataset.bust) classes = ["bust", ...pose ? [pose] : []];
  else {
    const step = stepClassesOf(g);
    if (step) classes = pose ? [...step, pose] : step;
    else classes = stateClasses(pose ?? "pose-idle", g.dataset.animPose ?? null).filter((c) => pose || !c.startsWith("pose-"));
    if (g.dataset.cheer && !classes.includes("cheer")) classes = [...classes, "cheer"];
  }
  const classSig = classes.join(" ");
  if (g.dataset.state !== classSig) {
    g.dataset.state = classSig;
    g.classList.remove(...STATE_CLASSES, ...POSE_CLASSES, "bust");
    if (classes.length) g.classList.add(...classes);
  }
}
function updateCharacter(g, o) {
  lastOpts.set(g, o);
  const s = o.scale ?? 1;
  const fx = o.fx ?? "none";
  g.dataset.agentId = o.id;
  if (o.sessionId !== void 0) g.dataset.sessionId = o.sessionId;
  g.dataset.pose = o.pose;
  g.dataset.mood = o.mood;
  g.style.setProperty("--L", `${r1(HALF_LEG * s)}px`);
  if (o.bust) g.dataset.bust = "1";
  applyClasses(g);
  const dir = g.querySelector(":scope > .anim > .dir");
  const h = o.human;
  const sig = [h.skin, h.hair, h.hairStyle, h.shirt, h.pants, h.tie ?? "", o.mood, s].join("|");
  if (dir.dataset.sig !== sig) {
    dir.dataset.sig = sig;
    dir.replaceChildren();
    html(dir, personMarkup(h, o.mood, s));
  }
  const fxg = g.querySelector(":scope > .anim > .fx");
  const fxSig = `${fx}|${s}|${o.bust ? "bust" : ""}`;
  if (fxg.dataset.sig !== fxSig) {
    fxg.dataset.sig = fxSig;
    fxg.replaceChildren();
    html(fxg, o.bust ? bustFxMarkup(fx) : fxMarkup(fx, s));
  }
  const timer = fxg.querySelector(".timer");
  if (timer) {
    timer.dataset.since = String(o.since ?? Date.now());
    paintTimer(timer, Date.now());
  }
  const a = -HEAD_TOP * s;
  const tag = g.querySelector(":scope > .anim > .tag");
  const pill2 = tag.querySelector(".pill");
  const name = tag.querySelector(".name");
  const task = tag.querySelector(".task");
  const tok = tag.querySelector(".tok");
  if (name.textContent !== o.name) name.textContent = o.name;
  const w = Math.max(30, o.name.length * 6 + 14);
  pill2.setAttribute("x", String(-w / 2));
  pill2.setAttribute("width", String(w));
  pill2.setAttribute("y", String(r1(a - 36)));
  pill2.setAttribute("stroke", o.color);
  name.setAttribute("y", String(r1(a - 25)));
  const t = o.task ?? "";
  if (o.taskSince !== void 0 && t.includes("{t}")) {
    task.dataset.tpl = t;
    task.dataset.since = String(o.taskSince);
    paintTask(task, Date.now());
  } else {
    delete task.dataset.tpl;
    delete task.dataset.since;
    if (task.textContent !== t) task.textContent = t;
  }
  task.setAttribute("y", String(r1(a - 13)));
  if (!tok.dataset.ticking) writeTok(tok, o.tokens);
  tok.setAttribute("y", String(r1(a - 4)));
}
function paintTimer(t, now) {
  const since = Number(t.dataset.since);
  const txt = "\u23F1 " + formatTimer(now - (Number.isFinite(since) ? since : now));
  if (t.textContent !== txt) t.textContent = txt;
}
function paintTask(t, now) {
  const since = Number(t.dataset.since);
  const txt = (t.dataset.tpl ?? "").replace("{t}", formatTimer(now - (Number.isFinite(since) ? since : now)));
  if (t.textContent !== txt) t.textContent = txt;
}
function tickTimers(root, now = Date.now()) {
  root.querySelectorAll(".timer").forEach((t) => paintTimer(t, now));
  root.querySelectorAll(".task[data-tpl]").forEach((t) => paintTask(t, now));
}
var SEAT_Y = -HALF_LEG;
var DESK_X = 16;
var DESK_W = 66;
var DESK_TOP = Math.round(-HALF_LEG - RIG.torso * 0.55);
var SCR = { x: 48, y: DESK_TOP - 21, w: 26, h: 14 };
function screenMarkup(screen) {
  const err = screen === "err";
  const lines = Array.from({ length: 20 }, (_, i) => {
    const fill = err ? "#f87171" : ["#7ee787", "#79c0ff", "#d2a8ff"][i % 3];
    return `<rect x="${SCR.x + 1.5 + i % 3 * 2}" y="${SCR.y + 1.5 + i * 3}" width="${6 + i * 7 % 14}" height="1.4" rx=".6" fill="${fill}"/>`;
  }).join("");
  return `<rect x="${SCR.x}" y="${SCR.y}" width="${SCR.w}" height="${SCR.h}" fill="${err ? "#3f0d12" : "#0b1220"}"/><g class="scroll">${lines}</g>`;
}
function renderDesk(screen = "code", mug = true) {
  const g = svgEl("g", { class: "desk" });
  const T = DESK_TOP;
  const R = DESK_X + DESK_W;
  html(
    g,
    `<rect x="${DESK_X + 3}" y="${T + 4}" width="3" height="${-T - 4}" fill="#6b442d"/>
    <rect x="${R - 6}" y="${T + 4}" width="3" height="${-T - 4}" fill="#6b442d"/>
    <rect x="${R - 30}" y="${T + 4}" width="27" height="10" fill="#7a4e33"/><rect x="${R - 19}" y="${T + 8}" width="6" height="1.5" rx=".7" fill="#c9a27a"/>
    <rect x="${DESK_X}" y="${T}" width="${DESK_W}" height="4" rx="1" fill="#8a5a3c"/>
    <rect x="${SCR.x + SCR.w / 2 - 1.5}" y="${SCR.y + SCR.h + 1}" width="3" height="${T - SCR.y - SCR.h - 1}" fill="#374151"/>
    <rect x="${SCR.x + SCR.w / 2 - 6}" y="${T - 1.5}" width="12" height="1.5" rx=".7" fill="#374151"/>
    <rect x="${SCR.x - 2}" y="${SCR.y - 2}" width="${SCR.w + 4}" height="${SCR.h + 4}" rx="2" fill="#1f2937"/>
    <g class="screen" clip-path="url(#scr1)"></g>
    <rect x="${DESK_X + 4}" y="${T - 1.5}" width="15" height="1.5" rx=".7" fill="#d1d5db"/>` + (mug ? `<g transform="translate(${DESK_X + 25},${T - 5})"><rect x="-2.5" y="0" width="5" height="5" rx="1" fill="#fff" stroke="#bbb" stroke-width=".6"/><path class="steam" d="M-1 -1 q1 -2 0 -4 M1.2 -1 q1 -2 0 -4" stroke="#bbb" stroke-width=".7" fill="none"/></g>` : "")
  );
  setDeskScreen(g, screen);
  return g;
}
function setDeskScreen(desk, screen) {
  if (desk.dataset.screen === screen) return;
  desk.dataset.screen = screen;
  const scr = desk.querySelector(".screen");
  scr.replaceChildren();
  html(scr, screenMarkup(screen));
}
var VISITOR_X = DESK_X + DESK_W + 14;
function renderVisitorChair() {
  const g = svgEl("g", { class: "chair chair--visitor" });
  const Y = SEAT_Y;
  const backH = r1(RIG.torso * 0.9);
  html(
    g,
    `<ellipse class="v-glow" cx="0" cy="0" rx="18" ry="4.5"/>
    <g transform="scale(-1,1)">
      <rect class="v-back" x="-11" y="${r1(Y - backH)}" width="4" height="${backH}" rx="1"/>
      <rect class="v-seat" x="-11" y="${Y}" width="22" height="4" rx="1.5"/>
      <rect x="-1" y="${Y + 4}" width="2" height="${HALF_LEG - 6}" fill="#3a3346"/>
      <rect x="-8" y="-2" width="16" height="2" fill="#3a3346"/>
    </g>
    <g transform="translate(0,${r1(Y - backH - 12)})"><g class="v-tag">
      <rect x="-21" y="-7" width="42" height="11" rx="5.5"/>
      <text x="0" y="1.2" font-size="6.5" font-weight="700" text-anchor="middle">your turn</text>
    </g></g>`
  );
  return g;
}
function renderChair(boss) {
  const g = svgEl("g", { class: boss ? "chair chair--boss" : "chair" });
  const Y = SEAT_Y;
  if (boss) {
    const backH = RIG.torso * 1.3;
    html(
      g,
      `<rect x="-15" y="${r1(Y - backH)}" width="7" height="${r1(backH)}" rx="3" fill="#2b2540"/>
      <rect x="-14" y="${r1(Y - backH - 4)}" width="8" height="6" rx="3" fill="#3d3a5c"/>
      <rect x="-14" y="${Y}" width="28" height="5" rx="2" fill="#3d3a5c"/>
      <rect x="-1.5" y="${Y + 5}" width="3" height="${HALF_LEG - 8}" fill="#2b2540"/>
      <rect x="-11" y="-3" width="22" height="2" fill="#2b2540"/>
      <circle cx="-10" cy="-1" r="1.4" fill="#111"/><circle cx="10" cy="-1" r="1.4" fill="#111"/>`
    );
  } else {
    const backH = r1(RIG.torso * 0.9);
    html(
      g,
      `<rect x="-11" y="${r1(Y - backH)}" width="4" height="${backH}" rx="1" fill="#5a4a6a"/>
      <rect x="-11" y="${Y}" width="22" height="4" rx="1.5" fill="#6b5b7b"/>
      <rect x="-1" y="${Y + 4}" width="2" height="${HALF_LEG - 6}" fill="#3a3346"/>
      <rect x="-8" y="-2" width="16" height="2" fill="#3a3346"/>`
    );
  }
  return g;
}

// src/scene/rooms.ts
var layouts = /* @__PURE__ */ new WeakMap();
var clipSeq = 0;
function layoutOf(room) {
  return layouts.get(room);
}
function html2(g, s) {
  g.insertAdjacentHTML("beforeend", s);
}
var tokText = (st) => `\u26A1 ${hasUsage(st) ? formatTokens(liveTokens(st)) : "\u2014"} tok`;
function renderRoom(session, rect) {
  const g = svgEl("g", { class: "room" });
  const clipId = `room-clip-${++clipSeq}`;
  const clip = svgEl("clipPath", { id: clipId }, g);
  svgEl("rect", { rx: 10 }, clip);
  const inner = svgEl("g", { class: "room-inner", "clip-path": `url(#${clipId})` }, g);
  svgEl("g", { class: "bg" }, inner);
  svgEl("g", { class: "board" }, inner);
  svgEl("g", { class: "desks" }, inner);
  svgEl("g", { class: "people" }, inner);
  svgEl("g", { class: "anim-fx" }, inner);
  svgEl("rect", { class: "dim", x: 0, y: 0, fill: "#0f172a" }, inner);
  const sign = svgEl("g", { class: "sign" }, inner);
  svgEl("rect", { x: 8, y: 6, height: SIGN_H, rx: 5, fill: "#1e293b" }, sign);
  const text = svgEl("text", { x: 16, y: 6 + 15, "font-size": 11.5, fill: "#e2e8f0" }, sign);
  svgEl("tspan", { class: "label", "font-weight": 700, fill: "#facc15" }, text);
  svgEl("tspan", { class: "sub", fill: "#cbd5e1" }, text);
  svgEl("tspan", { class: "branch", fill: "#93c5fd" }, text);
  svgEl("tspan", { class: "count", fill: "#94a3b8" }, text);
  updateRoom(g, session, rect);
  return g;
}
function drawBackground(bg, l) {
  const { w, h } = l.rect;
  const { wallH, bossW, doorRect: d } = l;
  const parts = [];
  parts.push(`<rect width="${w}" height="${wallH}" fill="#f4ecdf"/>`);
  parts.push(`<rect y="${wallH - 6}" width="${w}" height="8" fill="#e2d4bd"/>`);
  parts.push(`<rect y="${wallH + 2}" width="${w}" height="${h - wallH - 2}" fill="url(#planks)"/>`);
  let x = bossW + 34;
  const free = () => d.x - 10 - x;
  const top = SIGN_H + 14;
  const avail = wallH - top - 12;
  if (avail >= 22 && free() >= 90) {
    const wh = Math.min(avail, 80);
    const ww = Math.round(Math.min(free() * 0.4, wh * 1.7, 130));
    if (ww >= 40) {
      parts.push(`<g transform="translate(${x},${top})"><svg width="${ww}" height="${wh}" viewBox="0 0 190 110" preserveAspectRatio="none" overflow="hidden">
        <rect width="190" height="110" rx="6" fill="#8ec5ff"/>
        <g class="cloud"><ellipse cx="40" cy="35" rx="26" ry="11" fill="#fff"/><ellipse cx="58" cy="30" rx="16" ry="10" fill="#fff"/></g>
        <circle cx="160" cy="28" r="12" fill="#ffd166"/>
        <path d="M0 85 l40-30 30 20 40-35 50 40 30-15v45H0z" fill="#6bbf7a"/>
        <rect width="190" height="110" rx="6" fill="none" stroke="#fff" stroke-width="7"/>
        <path d="M95 0v110M0 55h190" stroke="#fff" stroke-width="4"/></svg></g>`);
      x += ww + 16;
    }
  }
  const cr = Math.round(Math.min(18, avail / 2.4));
  if (cr >= 10 && free() >= cr * 2 + 8) {
    parts.push(`<g transform="translate(${x + cr},${top + cr + 2})"><circle r="${cr}" fill="#fff" stroke="#555" stroke-width="2.5"/>
      <rect class="hand2" x="-1.5" y="${-cr * 0.58}" width="3" height="${cr * 0.58}" fill="#333"/>
      <rect class="hand" x="-1" y="${-cr * 0.8}" width="2" height="${cr * 0.8}" fill="#e11d48"/><circle r="2" fill="#333"/></g>`);
    x += cr * 2 + 16;
  }
  parts.push(`<g transform="translate(${d.x},${d.y})"><rect width="${d.w}" height="${d.h}" fill="#5b4636"/>
    <rect class="doorL" x="2.5" y="2.5" width="${d.w - 5}" height="${d.h - 2.5}" fill="#a47551"/>
    <circle cx="${d.w - 9}" cy="${d.h * 0.53}" r="2.5" fill="#facc15"/></g>`);
  if (d.x - x > 40 && wallH > 80) {
    const s = Math.min(1, wallH / 140);
    parts.push(`<g transform="translate(${d.x - 34 * s},${wallH - 60 * s}) scale(${s})"><rect x="0" y="20" width="26" height="40" rx="3" fill="#e5e7eb"/>
      <g class="cooler"><rect x="3" y="-6" width="20" height="28" rx="8" fill="#93c5fd" opacity=".85"/></g></g>`);
  }
  parts.push(`<rect width="${bossW}" height="${h}" fill="#dbeafe" opacity=".35"/>`);
  parts.push(`<rect x="${bossW - 2}" width="4" height="${h}" fill="#94a3b8" opacity=".6"/>`);
  if (wallH - top >= 44 && bossW >= 110) {
    const s = Math.min(1, (wallH - top - 6) / 50);
    parts.push(`<g transform="translate(14,${top}) scale(${s})"><rect width="70" height="50" fill="#fbbf24" opacity=".9" rx="3"/>
      <text x="35" y="22" font-size="9" text-anchor="middle" fill="#7c2d12">TEAM OF</text><text x="35" y="34" font-size="9" text-anchor="middle" fill="#7c2d12" font-weight="700">THE MONTH</text></g>`);
  }
  const ps = Math.min(0.8, wallH / 140);
  parts.push(`<g transform="translate(${bossW + 16},${wallH - 28 * ps}) scale(${ps})">
    <rect x="-12" y="10" width="24" height="22" rx="3" fill="#b45309"/>
    <ellipse cx="-8" cy="2" rx="8" ry="16" fill="#22c55e" transform="rotate(-25)"/>
    <ellipse cx="8" cy="2" rx="8" ry="16" fill="#16a34a" transform="rotate(25)"/>
    <ellipse cx="0" cy="-4" rx="7" ry="17" fill="#4ade80"/></g>`);
  bg.replaceChildren();
  html2(bg, parts.join(""));
  bg.dataset.wbX = String(x);
}
function drawBoard(board, bg, l, agents) {
  const x = Number(bg.dataset.wbX);
  const top = SIGN_H + 14;
  const ww = Math.min(170, l.doorRect.x - 50 - x);
  const tagTop = Math.min(Infinity, ...Object.values(l.seats).map((p) => p.y - HEAD_TOP * l.scale - TAG_H - 4));
  const wh = Math.min(l.wallH - 12, tagTop, top + 110) - top;
  board.replaceChildren();
  if (!agents.length || ww < 100 || wh < 46) return;
  const g = svgEl("g", { transform: `translate(${x},${top})` }, board);
  svgEl("rect", { width: ww, height: wh, rx: 4, fill: "#fff", stroke: "#9ca3af", "stroke-width": 3 }, g);
  const title = svgEl("text", { x: 8, y: 15, "font-size": 9.5, "font-weight": 700, fill: "#2563eb" }, g);
  title.textContent = "TODAY'S TASKS";
  const rows = Math.min(4, Math.floor((wh - 20) / 13));
  const chars = Math.floor((ww - 20) / 4.7);
  agents.slice(0, rows).forEach((a, i) => {
    const look = agentLook(a.status, !!a.waitingOnYou);
    const t = svgEl("text", { x: 8, y: 30 + i * 13, "font-size": 8.5, fill: look.fx === "stuck" ? "#dc2626" : a.waitingOnYou ? "#b45309" : "#555" }, g);
    t.textContent = `${a.status === "handing_off" ? "\u2713" : a.waitingOnYou ? "\u25B6" : "\u25FB"} ${truncate(a.task ?? a.name ?? a.type, chars)}`;
  });
}
function placeDesk(desks, key, x, y, s, screen, sessionId) {
  const k = CSS.escape(key);
  const transform = `translate(${Math.round(x)},${Math.round(y)}) scale(${s})`;
  let chair = desks.querySelector(`:scope > [data-chair-for="${k}"]:not(.chair--visitor)`);
  if (!chair) {
    chair = renderChair(key === "boss");
    chair.dataset.chairFor = key;
    chair.dataset.sessionId = sessionId;
    desks.appendChild(chair);
  }
  chair.setAttribute("transform", transform);
  let d = desks.querySelector(`:scope > [data-desk-for="${k}"]`);
  if (!d) {
    d = renderDesk(screen);
    d.dataset.deskFor = key;
    d.dataset.sessionId = sessionId;
    desks.appendChild(d);
  }
  setDeskScreen(d, screen);
  d.setAttribute("transform", transform);
  return d;
}
function placeVisitor(desks, x, y, s, waiting, sessionId) {
  let v = desks.querySelector(":scope > .chair--visitor");
  if (!v) {
    v = renderVisitorChair();
    v.dataset.chairFor = "boss";
    v.dataset.sessionId = sessionId;
    desks.appendChild(v);
  }
  v.setAttribute("transform", `translate(${Math.round(x + VISITOR_X * s)},${Math.round(y)}) scale(${s})`);
  v.classList.toggle("waiting", waiting);
}
function placeCharacter(people, opts, x, y) {
  let c = people.querySelector(`:scope > [data-agent-id="${CSS.escape(opts.id)}"]`);
  if (c) updateCharacter(c, opts);
  else {
    c = renderCharacter(opts);
    people.appendChild(c);
  }
  c.setAttribute("transform", `translate(${x},${y})`);
  c.dataset.x = String(x);
  c.dataset.y = String(y);
  return c;
}
function updateRoom(g, session, rect) {
  const l = roomLayout(session, rect, layouts.get(g)?.slots);
  layouts.set(g, l);
  const sid = session.id;
  g.dataset.sessionId = sid;
  g.setAttribute("transform", `translate(${rect.x},${rect.y})`);
  const sizeKey = `${rect.w}x${rect.h}`;
  const inner = g.querySelector(":scope > .room-inner");
  const bg = inner.querySelector(":scope > .bg");
  if (g.dataset.size !== sizeKey) {
    g.dataset.size = sizeKey;
    const cr = g.querySelector("clipPath > rect");
    cr.setAttribute("width", String(rect.w));
    cr.setAttribute("height", String(rect.h));
    const dim = inner.querySelector(":scope > .dim");
    dim.setAttribute("width", String(rect.w));
    dim.setAttribute("height", String(rect.h));
    drawBackground(bg, l);
  }
  const count = l.order.length ? `  \xB7 ${l.order.length} agent${l.order.length === 1 ? "" : "s"}` : "";
  const { label, sub, branch } = signText(session, rect.w, count);
  const sign = inner.querySelector(":scope > .sign");
  const setT = (cls, v) => {
    const t = sign.querySelector(`.${cls}`);
    if (t.textContent !== v) t.textContent = v;
  };
  setT("label", label);
  setT("sub", sub);
  setT("branch", branch);
  setT("count", count);
  const signChars = label.length + sub.length + branch.length + count.length;
  sign.querySelector("rect").setAttribute("width", String(Math.min(rect.w - 16, signChars * 6.4 + 18)));
  const now = Date.now();
  const bossNote = session.status === "ended" ? void 0 : toolNote(session.boss, now);
  const bossBase = bossLook(session.boss.status);
  const boss = bossNote?.kind === "looping" && session.boss.status !== "needs_you" && session.boss.status !== "idle" ? { ...bossBase, mood: "worried", fx: "loop" } : bossBase;
  const ended = session.status === "ended";
  g.classList.toggle("room--dim", boss.dim || ended);
  g.classList.toggle("room--crowded", l.crowded);
  g.dataset.bossStatus = session.boss.status;
  const visible = l.order.map((id) => session.agents[id]).filter((a) => !!a);
  drawBoard(inner.querySelector(":scope > .board"), bg, l, visible);
  const desks = inner.querySelector(":scope > .desks");
  const people = inner.querySelector(":scope > .people");
  const keep = /* @__PURE__ */ new Set(["boss"]);
  const main = looksFor("main");
  placeDesk(desks, "boss", l.boss.x, l.boss.y, l.bossScale, "code", sid);
  placeVisitor(desks, l.boss.x, l.boss.y, l.bossScale, needsYou(session), sid);
  placeCharacter(
    people,
    {
      id: "boss",
      sessionId: sid,
      color: main.color,
      human: humanLook(sid, "boss"),
      mood: boss.mood,
      pose: poseClass(boss, true),
      fx: boss.fx,
      name: "Main agent",
      task: bossNote && session.boss.status !== "idle" && session.boss.status !== "needs_you" ? bossNote.text : session.boss.status.replace(/_/g, " "),
      ...bossNote?.since !== void 0 ? { taskSince: bossNote.since } : {},
      tokens: tokText(session.boss.stats),
      scale: l.bossScale
    },
    l.boss.x,
    l.boss.y
  );
  const bossEl = people.querySelector(':scope > [data-agent-id="boss"]');
  bossEl.classList.add("boss");
  const bossNoted = session.boss.status !== "idle" && session.boss.status !== "needs_you" ? bossNote?.kind : void 0;
  bossEl.classList.toggle("looping", bossNoted === "looping");
  bossEl.classList.toggle("running", bossNoted === "running");
  for (const a of visible) {
    const seat = l.seats[a.id];
    keep.add(a.id);
    const look = looksFor(a.type);
    const note = toolNote(a, now);
    const st = agentLook(a.status, !!a.waitingOnYou, !!a.looping);
    placeDesk(desks, a.id, seat.x, seat.y, l.scale, st.screen, sid);
    const c = placeCharacter(
      people,
      {
        id: a.id,
        sessionId: sid,
        color: look.color,
        human: humanLook(a.id, a.type),
        mood: st.mood,
        pose: poseClass(st, false),
        fx: st.fx,
        since: a.stats.lastActivity,
        name: a.name ?? a.type,
        task: a.waitingOnYou ? "waiting on you" : note ? note.text : truncate(a.task, l.taskChars),
        ...note?.since !== void 0 && !a.waitingOnYou ? { taskSince: note.since } : {},
        tokens: tokText(a.stats),
        scale: l.scale
      },
      seat.x,
      seat.y
    );
    c.dataset.status = a.status;
    c.classList.toggle("waiting", !!a.waitingOnYou);
    c.classList.toggle("looping", !a.waitingOnYou && note?.kind === "looping");
    c.classList.toggle("running", !a.waitingOnYou && note?.kind === "running");
    c.dataset.depth = String(seat.depth);
    if (a.parentId) c.dataset.parentId = a.parentId;
    else delete c.dataset.parentId;
  }
  for (const el2 of Array.from(people.children)) {
    const id = el2.dataset.agentId ?? "";
    if (keep.has(id)) continue;
    if (el2.dataset.departing && session.agents[id]) continue;
    el2.remove();
  }
  for (const el2 of Array.from(desks.children)) if (!keep.has(el2.dataset.deskFor ?? el2.dataset.chairFor ?? "")) el2.remove();
  return l;
}

// src/scene/floor.ts
var Floor = class _Floor {
  /** svg: the floor's root <svg> (sized in px); layer: the <g> rooms go into; viewport: the scrolling element. */
  constructor(svg2, layer2, viewport2) {
    this.svg = svg2;
    this.layer = layer2;
    this.viewport = viewport2;
  }
  svg;
  layer;
  viewport;
  rooms = /* @__PURE__ */ new Map();
  last = { sessions: {} };
  /** ended sessions whose fade-out finished: off the floor while they stay ended */
  faded = /* @__PURE__ */ new Set();
  /**
   * Sessions in floor order: oldest room first, stable by id. The key is the store's floorSince (carried over
   * on a /clear takeover, so the successor gets the same slot and the shift change plays in place), else
   * boss.startedAt.
   */
  static order(state) {
    const key = (s) => s.floorSince ?? s.boss.startedAt;
    return Object.values(state.sessions).sort((a, b) => key(a) - key(b) || (a.id < b.id ? -1 : 1));
  }
  get state() {
    return this.last;
  }
  /** Marks an ended room as faded out: the next render drops it (it returns if the session revives). */
  hideEnded(sessionId) {
    if (this.last.sessions[sessionId]?.status === "ended") this.faded.add(sessionId);
  }
  render(state = this.last) {
    this.last = state;
    for (const id of this.faded) if (state.sessions[id]?.status !== "ended") this.faded.delete(id);
    const sessions = visibleSessions(_Floor.order(state), this.faded, new Set(this.rooms.keys()));
    const rects = layoutRooms(sessions.length, this.viewport.clientWidth, this.viewport.clientHeight);
    const seen = /* @__PURE__ */ new Set();
    sessions.forEach((s, i) => {
      seen.add(s.id);
      const existing = this.rooms.get(s.id);
      if (existing) updateRoom(existing, s, rects[i]);
      else {
        const g = renderRoom(s, rects[i]);
        this.rooms.set(s.id, g);
        this.layer.appendChild(g);
      }
    });
    for (const [id, g] of this.rooms)
      if (!seen.has(id)) {
        g.remove();
        this.rooms.delete(id);
      }
    const w = rects.reduce((m, r) => Math.max(m, r.x + r.w), 0) + ROOM_GAP;
    const h = rects.reduce((m, r) => Math.max(m, r.y + r.h), 0) + ROOM_GAP;
    this.svg.setAttribute("width", String(sessions.length ? w : 0));
    this.svg.setAttribute("height", String(sessions.length ? h : 0));
    return sessions.length;
  }
  roomEl(sessionId) {
    return this.rooms.get(sessionId);
  }
  /** agentId 'boss' selects the room's main agent. */
  characterEl(sessionId, agentId) {
    return this.rooms.get(sessionId)?.querySelector(`.people > [data-agent-id="${CSS.escape(agentId)}"]`) ?? void 0;
  }
  layoutOf(sessionId) {
    const g = this.rooms.get(sessionId);
    return g ? layoutOf(g) : void 0;
  }
};

// src/scene/animator.ts
var ROOM_ACTOR = "";
var ROOM_FADED_EVENT = "agentoffice:room-faded";
var DURATIONS = {
  enter_door: 1200,
  walk_to_desk: 2e3,
  walk_to: 2e3,
  give: 800,
  celebrate: 1200,
  party: 3600,
  exit_door: 2e3,
  shift_change: 2e3,
  fade_in_room: 600,
  fade_out_room: 600
};
var REDUCED_MS = 300;
function stepClasses(kind) {
  switch (kind) {
    case "enter_door":
    case "walk_to_desk":
    case "shift_change":
      return { add: ["walking"], remove: ["sitting"] };
    case "walk_to":
      return { add: ["walking", "carrying"], remove: ["sitting"] };
    case "give":
      return { add: ["giving"], remove: ["walking", "carrying"] };
    case "exit_door":
      return { add: ["walking"], remove: ["giving", "carrying", "sitting", "dancing"] };
    case "party":
      return { add: ["walking"], remove: ["sitting", "carrying", "giving", "dancing"] };
    default:
      return { add: [], remove: [] };
  }
}
function facing(fromX, toX, current) {
  const dx = toX - fromX;
  if (Math.abs(dx) < 1) return current;
  return dx > 0 ? 1 : -1;
}
function planAnimations(events, state) {
  let out = [];
  const add = (sessionId, agentId, kind, targetId) => out.push({ agentId, sessionId, kind, ...targetId !== void 0 ? { targetId } : {}, durationMs: DURATIONS[kind] });
  const dropFadeOut = (sid) => out = out.filter((s) => !(s.kind === "fade_out_room" && s.sessionId === sid));
  for (const e of events) {
    switch (e.kind) {
      case "spawned":
        add(e.sessionId, e.agentId, "enter_door");
        add(e.sessionId, e.agentId, "walk_to_desk");
        break;
      case "handoff":
        add(e.sessionId, e.agentId, "walk_to", e.toId);
        add(e.sessionId, e.agentId, "give", e.toId);
        add(e.sessionId, e.agentId, "celebrate", e.toId);
        break;
      case "left":
        add(e.sessionId, e.agentId, "exit_door");
        break;
      case "party":
        out.push({ agentId: "boss", sessionId: e.sessionId, kind: "party", durationMs: DURATIONS.party, crew: e.crew });
        break;
      case "shift_change":
        dropFadeOut(e.fromSessionId);
        dropFadeOut(e.toSessionId);
        add(e.toSessionId, "boss", "shift_change", e.fromSessionId);
        break;
      case "session_started":
        dropFadeOut(e.sessionId);
        add(e.sessionId, ROOM_ACTOR, "fade_in_room");
        break;
      case "session_ended":
        add(e.sessionId, ROOM_ACTOR, "fade_out_room");
        break;
    }
  }
  return out.filter((s) => !!state.sessions[s.sessionId]);
}
var queues = /* @__PURE__ */ new Map();
var animStats = {
  started: 0,
  finished: 0,
  /** steps whose room/character was no longer rendered */
  skipped: 0,
  cancelled: 0,
  byKind: {},
  log: []
};
var qkey = (sessionId, agentId) => `${sessionId}\0${agentId}`;
var reduced2 = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
var tr = (p) => `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
function roomEl(svg2, sid) {
  return svg2.querySelector(`g.room[data-session-id="${CSS.escape(sid)}"]`);
}
function charEl(room, id) {
  return room.querySelector(`.people > g.char[data-agent-id="${CSS.escape(id)}"]`);
}
function runAnimations(steps, svgRoot) {
  for (const s of steps) {
    if (s.kind === "walk_to" || s.kind === "exit_door") {
      const room = roomEl(svgRoot, s.sessionId);
      const c = room && charEl(room, s.agentId);
      if (c) c.dataset.departing = "1";
    }
    if (s.kind === "shift_change" && s.targetId) cancelQueue(svgRoot, s.targetId, ROOM_ACTOR);
    if (s.kind === "fade_in_room") cancelQueue(svgRoot, s.sessionId, ROOM_ACTOR);
    const k = qkey(s.sessionId, s.agentId);
    let q = queues.get(k);
    if (!q) queues.set(k, q = { busy: false, items: [], running: /* @__PURE__ */ new Set() });
    q.items.push(s);
    queueMicrotask(() => pump(k, svgRoot));
  }
}
function cancelQueue(svg2, sessionId, agentId) {
  if (agentId === ROOM_ACTOR) roomEl(svg2, sessionId)?.style.removeProperty("opacity");
  const q = queues.get(qkey(sessionId, agentId));
  if (!q) return;
  animStats.cancelled += q.items.length + q.running.size;
  q.items = [];
  for (const a of q.running) cancelAnimation(a);
  q.running.clear();
  if (agentId !== ROOM_ACTOR) {
    const room = roomEl(svg2, sessionId);
    const c = room && charEl(room, agentId);
    if (c) restoreSeated(c);
  }
}
var cancelledAnims = /* @__PURE__ */ new WeakSet();
function cancelAnimation(a) {
  cancelledAnims.add(a);
  a.cancel();
}
function pump(k, svg2) {
  const q = queues.get(k);
  if (!q || q.busy) return;
  const step = q.items.shift();
  if (!step) {
    queues.delete(k);
    return;
  }
  q.busy = true;
  const bucket = animStats.byKind[step.kind] ??= { started: 0, finished: 0 };
  animStats.started++;
  bucket.started++;
  play(step, svg2, q).then((ran) => {
    if (!ran) animStats.skipped++;
    animStats.finished++;
    bucket.finished++;
    animStats.log.push(`${ran ? "done" : "skip"} ${step.kind} ${step.agentId || "room"}`);
    if (animStats.log.length > 200) animStats.log.shift();
  }).catch(() => {
    animStats.finished++;
    bucket.finished++;
  }).finally(() => {
    q.busy = false;
    pump(k, svg2);
  });
}
function done(a, ms) {
  return Promise.race([a.finished.then(() => void 0, () => void 0), new Promise((r) => setTimeout(r, ms + 1e3))]);
}
async function tween(ctx, el2, kf, ms, easing = "ease-in-out", keep = true) {
  const a = el2.animate(kf, { duration: ms, easing, fill: "forwards" });
  ctx.q.running.add(a);
  await done(a, ms);
  ctx.q.running.delete(a);
  const cancelled = cancelledAnims.has(a);
  if (keep && !cancelled) {
    const last = kf[kf.length - 1];
    const st = el2.style;
    if (last.transform !== void 0) st.transform = String(last.transform);
    if (last.opacity !== void 0) st.opacity = String(last.opacity);
  }
  if (!cancelled) a.cancel();
  return !cancelled;
}
var animate = tween;
function flourish(el2, kf, ms, opts = {}, remove = el2) {
  const a = el2.animate(kf, { duration: ms, fill: "forwards", ...opts });
  void done(a, ms).then(() => remove.remove());
}
var SETTLE_MS = 450;
var STAND_MS = 350;
var settleTimers = /* @__PURE__ */ new WeakMap();
function settle(c) {
  c.classList.add("settling");
  const t = settleTimers.get(c);
  if (t !== void 0) clearTimeout(t);
  settleTimers.set(c, setTimeout(() => c.classList.remove("settling"), SETTLE_MS));
}
function unsettle(c) {
  const t = settleTimers.get(c);
  if (t !== void 0) clearTimeout(t);
  settleTimers.delete(c);
  c.classList.remove("settling");
}
function dirOf(c) {
  return c.querySelector(":scope > .anim > .dir");
}
function currentFacing(c) {
  return c.dataset.face === "-1" ? -1 : 1;
}
function face(c, f) {
  c.dataset.face = String(f);
  const dir = dirOf(c);
  if (dir) dir.style.transform = `scale(${f},1)`;
}
function currentStep(c) {
  return stepClassesOf(c) ?? STATE_CLASSES.filter((k) => k !== "cheer" && c.classList.contains(k));
}
function applyDelta(c, add, remove) {
  const cur = new Set(currentStep(c));
  for (const k of remove) cur.delete(k);
  for (const k of add) cur.add(k);
  setStepClasses(c, [...cur]);
}
function restoreSeated(c) {
  const anim = c.querySelector(":scope > .anim");
  if (anim) setOffset(anim, { x: 0, y: 0 }, 1);
  delete c.dataset.departing;
  face(c, 1);
  setStepClasses(c, null);
}
async function walkStep(ctx, c, kind, from, to, ms, kf) {
  const anim = c.querySelector(":scope > .anim");
  if (!anim) return false;
  const { add, remove } = stepClasses(kind);
  const standUp = !ctx.reduced && (kind === "walk_to" || kind === "exit_door" || kind === "party") && currentStep(c).includes("sitting");
  if (standUp) {
    applyDelta(c, add.filter((k) => k !== "walking"), remove);
    settle(c);
    await wait(STAND_MS);
    if (stepClassesOf(c) === null) return false;
    unsettle(c);
    ms = Math.max(REDUCED_MS, ms - STAND_MS);
  }
  applyDelta(c, add, remove);
  if (!ctx.reduced) face(c, facing(from.x, to.x, currentFacing(c)));
  const ok = await tween(ctx, anim, kf ?? [{ transform: tr(from), opacity: 1 }, { transform: tr(to), opacity: 1 }], ms);
  if (!ok) {
    restoreSeated(c);
    return false;
  }
  offsets.set(anim, to);
  if (kind === "walk_to_desk" || kind === "shift_change") {
    if (!ctx.reduced) settle(c);
    applyDelta(c, ["sitting"], ["walking"]);
    face(c, 1);
    setStepClasses(c, null);
  }
  return true;
}
var offsets = /* @__PURE__ */ new WeakMap();
function setOffset(anim, p, opacity) {
  offsets.set(anim, p);
  anim.style.transform = tr(p);
  if (opacity !== void 0) anim.style.opacity = String(opacity);
}
function basePos(c) {
  return { x: Number(c.dataset.x) || 0, y: Number(c.dataset.y) || 0 };
}
function openDoor(ctx, room, ms) {
  if (ctx.reduced) return;
  const leaf = room.querySelector(".bg .doorL");
  if (!leaf) return;
  leaf.animate(
    [{ transform: "scaleX(1)" }, { transform: "scaleX(.15)", offset: 0.2 }, { transform: "scaleX(.15)", offset: 0.75 }, { transform: "scaleX(1)" }],
    { duration: ms, easing: "ease-in-out" }
  );
}
function fxLayer(room) {
  let fx = room.querySelector(".room-inner > .anim-fx");
  if (!fx) fx = svgEl("g", { class: "anim-fx" }, room.querySelector(".room-inner") ?? room);
  return fx;
}
function pill(parent, p, roomW, text, fill, fontSize = 10) {
  const w = Math.round(text.length * fontSize * 0.62 + 16);
  const x = Math.max(w / 2 + 4, Math.min(roomW - w / 2 - 4, p.x));
  const outer = svgEl("g", { transform: `translate(${Math.round(x)},${Math.round(p.y)})` }, parent);
  const g = svgEl("g", { class: "pop" }, outer);
  svgEl("rect", { x: -w / 2, y: -fontSize - 4, width: w, height: fontSize + 10, rx: (fontSize + 10) / 2, fill }, g);
  const t = svgEl("text", { y: 0, "font-size": fontSize, "font-weight": 700, fill: "#fff", "text-anchor": "middle" }, g);
  t.textContent = text;
  return g;
}
function doorTag(ctx, room, layout, label, color, ms, withSparkle) {
  const fx = fxLayer(room);
  const at = layout.door;
  if (withSparkle && !ctx.reduced) {
    const outer = svgEl("g", { transform: `translate(${Math.round(at.x)},${Math.round(at.y - 18)})` }, fx);
    const s = svgEl("text", { class: "pop", "font-size": 30, "text-anchor": "middle", y: 10 }, outer);
    s.textContent = "\u2728";
    flourish(s, [
      { opacity: 0, transform: "scale(.2)" },
      { opacity: 1, transform: "scale(1.3)", offset: 0.3 },
      { opacity: 0, transform: "scale(1.6)" }
    ], ms * 0.6, {}, outer);
  }
  const tag = pill(fx, { x: at.x - 30, y: Math.min(layout.rect.h - 8, at.y + 34) }, layout.rect.w, label, color);
  flourish(tag, [{ opacity: 0 }, { opacity: 1, offset: 0.1 }, { opacity: 1, offset: 0.85 }, { opacity: 0 }], ms, {}, tag.parentElement);
}
function disco(room, layout, at, ms) {
  const fx = fxLayer(room);
  if (fx.querySelector(":scope > .disco")) return;
  const { w, h } = layout.rect;
  const g = svgEl("g", { class: "disco", "pointer-events": "none" }, fx);
  const fade = (el2, peak) => flourish(el2, [{ opacity: 0 }, { opacity: peak, offset: 0.12 }, { opacity: peak, offset: 0.85 }, { opacity: 0 }], ms, {}, el2);
  fade(svgEl("rect", { x: 0, y: 0, width: w, height: h, fill: "#1e1b4b" }, g), 0.22);
  const colors = ["#f43f5e", "#facc15", "#22d3ee", "#4ade80", "#a855f7", "#fb923c"];
  for (let i = 0; i < 8; i++) {
    const onWall = i % 3 === 2;
    const y = onWall ? layout.wallH * (0.45 + i % 2 * 0.2) : layout.wallH + (h - layout.wallH) * (0.25 + i * 37 % 60 / 100);
    const x0 = i * 97 % 100 / 100 * w;
    const dx = (i % 2 ? -1 : 1) * Math.round(w * 0.35);
    const spot = svgEl("ellipse", { cx: 0, cy: 0, rx: onWall ? 14 : 26, ry: onWall ? 14 : 9, fill: colors[i % colors.length], opacity: 0 }, g);
    flourish(spot, [
      { opacity: 0, transform: `translate(${Math.round(x0)}px, ${Math.round(y)}px)` },
      { opacity: 0.65, transform: `translate(${Math.round(x0 + dx * 0.3)}px, ${Math.round(y)}px)`, offset: 0.15 },
      { opacity: 0.3, transform: `translate(${Math.round(x0 + dx * 0.6)}px, ${Math.round(y)}px)`, offset: 0.45 },
      { opacity: 0.65, transform: `translate(${Math.round(x0 + dx * 0.8)}px, ${Math.round(y)}px)`, offset: 0.75 },
      { opacity: 0, transform: `translate(${Math.round(x0 + dx)}px, ${Math.round(y)}px)` }
    ], ms, { easing: "linear" });
  }
  const bx = Math.round(Math.max(14, Math.min(w - 14, at.x)));
  const R = 11;
  const by = Math.round(Math.max(30, layout.wallH * 0.6));
  const ball = svgEl("g", {}, g);
  svgEl("line", { x1: bx, y1: 0, x2: bx, y2: by - R, stroke: "#94a3b8", "stroke-width": 1.2 }, ball);
  const orb = svgEl("g", { transform: `translate(${bx},${by})` }, ball);
  const beams = svgEl("g", { class: "disco-beams" }, orb);
  const len = Math.round(h - by);
  for (let i = 0; i < 4; i++) {
    const beam = svgEl("g", { class: "disco-beam", style: `animation-delay:${-i * 0.35}s` }, beams);
    svgEl("polygon", { points: `0,0 ${-10},${len} ${10},${len}`, fill: colors[i * 2 % colors.length], opacity: 0.22 }, beam);
  }
  svgEl("circle", { r: R, fill: "#e2e8f0", stroke: "#64748b", "stroke-width": 1 }, orb);
  const facets = svgEl("g", { class: "disco-facets" }, orb);
  for (const d of [`M ${-R} 0 H ${R}`, "M -10 -5 H 10", "M -10 5 H 10", `M 0 ${-R} V ${R}`, "M -5.5 -10 V 10", "M 5.5 -10 V 10"]) svgEl("path", { d, stroke: "#94a3b8", "stroke-width": 0.8, fill: "none" }, facets);
  svgEl("circle", { cx: -4, cy: -4, r: 2.2, fill: "#fff" }, orb);
  flourish(ball, [
    { transform: `translateY(${-by - 10}px)` },
    { transform: "translateY(0px)", offset: 0.15 },
    { transform: "translateY(0px)", offset: 0.85 },
    { transform: `translateY(${-by - 10}px)` }
  ], ms, { easing: "ease-in-out" }, ball);
  setTimeout(() => g.remove(), ms + 1500);
}
function partySpots(layout, guests) {
  const { w, h } = layout.rect;
  const cx = layout.bossW + (w - layout.bossW) / 2;
  const y = Math.round(layout.wallH + (h - layout.wallH) * 0.62);
  const n = guests + 1;
  const gap = Math.max(18, Math.min(56 * layout.scale, (w - layout.bossW - 40) / n));
  const xs = Array.from({ length: n }, (_, i) => Math.round(cx + (i - (n - 1) / 2) * gap));
  const mid = Math.floor((n - 1) / 2);
  return { lead: { x: xs[mid], y }, guests: xs.filter((_, i) => i !== mid).map((x) => ({ x, y })) };
}
async function party(ctx, room, layout, lead, base, off, step, walkMs) {
  if (lead.dataset.bust) return false;
  for (let t = 0; t < 8e3 && room.querySelector(".people > g.char[data-departing]"); t += 200) await wait(200);
  const crew = step.crew ?? [];
  const fx = fxLayer(room);
  const spots = partySpots(layout, crew.length);
  if (ctx.reduced) {
    const tag = pill(fx, { x: spots.lead.x, y: Math.max(16, spots.lead.y - 70) }, layout.rect.w, "\u{1F389} All done!", "#7c3aed", 12);
    await wait(step.durationMs);
    tag.parentElement?.remove();
    return true;
  }
  const people = room.querySelector(".room-inner > .people");
  const layer2 = svgEl("g", { class: "party" });
  people ? people.after(layer2) : fx.before(layer2);
  room.classList.add("partying");
  const leadTo = { x: spots.lead.x - base.x, y: spots.lead.y - base.y };
  try {
    const guests = crew.map((g) => {
      const c = renderCharacter({
        id: `guest:${g.id}`,
        sessionId: step.sessionId,
        color: looksFor(g.type).color,
        human: humanLook(g.id, g.type),
        mood: "happy",
        pose: "pose-idle",
        fx: "none",
        name: g.name ?? g.type,
        task: "\u{1F389}",
        tokens: "",
        scale: layout.scale
      });
      c.setAttribute("transform", `translate(${Math.round(layout.door.x)},${Math.round(layout.door.y)})`);
      c.dataset.x = String(layout.door.x);
      c.dataset.y = String(layout.door.y);
      setStepClasses(c, []);
      const anim = c.querySelector(":scope > .anim");
      if (anim) anim.style.opacity = "0";
      layer2.appendChild(c);
      return c;
    });
    const zero = { x: 0, y: 0 };
    openDoor(ctx, room, walkMs + guests.length * 250);
    const comeIn = guests.map(async (c, i) => {
      await wait(i * 250);
      const to = { x: spots.guests[i].x - layout.door.x, y: spots.guests[i].y - layout.door.y };
      return walkStep(ctx, c, "party", zero, to, walkMs, [{ transform: tr(zero), opacity: 0 }, { transform: tr(zero), opacity: 1, offset: 0.15 }, { transform: tr(to), opacity: 1 }]);
    });
    const leadIn = walkStep(ctx, lead, "party", off, leadTo, walkMs);
    const arrived = await Promise.all([leadIn, ...comeIn]);
    if (!arrived[0]) return true;
    for (const c of [lead, ...guests]) {
      applyDelta(c, ["dancing"], ["walking"]);
      face(c, 1);
    }
    disco(room, layout, spots.lead, step.durationMs);
    confetti(room, { x: spots.lead.x, y: spots.lead.y - 50 * layout.scale });
    const tag = pill(fx, { x: spots.lead.x, y: Math.max(16, spots.lead.y - HEAD_TOP * layout.bossScale - TAG_H - 14) }, layout.rect.w, "\u{1F389} All done!", "#7c3aed", 12);
    await wait(step.durationMs);
    tag.parentElement?.remove();
    openDoor(ctx, room, walkMs);
    const goOut = guests.map((c, i) => {
      const from = { x: spots.guests[i].x - layout.door.x, y: spots.guests[i].y - layout.door.y };
      return walkStep(ctx, c, "party", from, zero, walkMs, [{ transform: tr(from), opacity: 1 }, { transform: tr(zero), opacity: 1, offset: 0.85 }, { transform: tr(zero), opacity: 0 }]);
    });
    const back = await walkStep(ctx, lead, "party", leadTo, zero, walkMs);
    await Promise.all(goOut);
    if (back) {
      settle(lead);
      restoreSeated(lead);
    }
    return true;
  } finally {
    layer2.remove();
    room.classList.remove("partying");
  }
}
function confetti(room, at) {
  const fx = fxLayer(room);
  const g = svgEl("g", { transform: `translate(${Math.round(at.x)},${Math.round(at.y)})` }, fx);
  const colors = ["#f43f5e", "#facc15", "#22c55e", "#3b82f6", "#a855f7"];
  for (let i = 0; i < 18; i++) {
    const r = svgEl("rect", { width: 5, height: 8, fill: colors[i % 5] }, g);
    const dx = Math.round(Math.cos(i) * 70);
    const dy = Math.round(Math.sin(i) * 60 - 40);
    flourish(r, [
      { opacity: 1, transform: "translate(0px, 0px) rotate(0deg)" },
      { opacity: 1, transform: `translate(${dx * 0.7}px, ${dy * 0.7}px) rotate(180deg)`, offset: 0.6 },
      { opacity: 0, transform: `translate(${dx}px, ${dy + 25}px) rotate(260deg)` }
    ], 1100 + i % 4 * 60, { easing: "ease-out" });
  }
  setTimeout(() => g.remove(), 2500);
}
async function play(step, svg2, q) {
  const ctx = { q, reduced: reduced2() };
  const room = roomEl(svg2, step.sessionId);
  if (!room) return false;
  const layout = layoutOf(room);
  if (!layout) return false;
  const ms = step.durationMs;
  if (step.kind === "fade_in_room") {
    room.style.removeProperty("opacity");
    await animate(ctx, room, [{ opacity: 0 }, { opacity: 1 }], ms, "ease-out", false);
    room.style.removeProperty("opacity");
    return true;
  }
  if (step.kind === "fade_out_room") {
    const ok = await animate(ctx, room, [{ opacity: 1 }, { opacity: 0 }], ctx.reduced ? 0 : ms, "ease-in");
    if (ok) svg2.dispatchEvent(new CustomEvent(ROOM_FADED_EVENT, { detail: { sessionId: step.sessionId } }));
    return true;
  }
  const c = charEl(room, step.agentId);
  const anim = c?.querySelector(":scope > .anim");
  if (!c || !anim) return false;
  const base = basePos(c);
  const off = offsets.get(anim) ?? { x: 0, y: 0 };
  const walkMs = ctx.reduced ? REDUCED_MS : ms;
  switch (step.kind) {
    case "enter_door": {
      const at = { x: layout.door.x - base.x, y: layout.door.y - base.y };
      doorTag(ctx, room, layout, "New agent spawned!", "#ec4899", ms * 2, true);
      if (ctx.reduced) {
        const e = stepClasses("enter_door");
        applyDelta(c, e.add, e.remove);
        setOffset(anim, { x: 0, y: 0 }, 0);
        return true;
      }
      const behind = { x: at.x, y: at.y - 6 };
      setOffset(anim, behind, 0);
      openDoor(ctx, room, ms + 600);
      face(c, facing(layout.door.x, base.x, currentFacing(c)));
      return walkStep(ctx, c, "enter_door", behind, at, ms, [
        { transform: tr(behind), opacity: 0 },
        { transform: tr(behind), opacity: 0, offset: 0.3 },
        { transform: tr(at), opacity: 1 }
      ]);
    }
    case "walk_to_desk": {
      if (ctx.reduced) {
        setOffset(anim, { x: 0, y: 0 });
        return walkStep(ctx, c, "walk_to_desk", off, { x: 0, y: 0 }, walkMs, [{ opacity: 0 }, { opacity: 1 }]);
      }
      return walkStep(ctx, c, "walk_to_desk", off, { x: 0, y: 0 }, walkMs);
    }
    case "walk_to": {
      c.dataset.departing = "1";
      const t = handoffTarget(layout, { parentId: step.targetId && step.targetId !== "boss" ? step.targetId : null });
      const to = { x: t.x - base.x, y: t.y - base.y };
      if (ctx.reduced) {
        setOffset(anim, to, 0);
        return walkStep(ctx, c, "walk_to", to, to, REDUCED_MS, [{ opacity: 0 }, { opacity: 1 }]);
      }
      return walkStep(ctx, c, "walk_to", off, to, walkMs);
    }
    case "give": {
      const g = stepClasses("give");
      applyDelta(c, g.add, g.remove);
      const target = receiver(room, layout, step.targetId);
      if (target && !ctx.reduced) face(c, facing(base.x + off.x, target.x, currentFacing(c)));
      await wait(ctx.reduced ? REDUCED_MS : ms);
      return true;
    }
    case "celebrate": {
      const target = receiver(room, layout, step.targetId);
      if (!target) {
        await wait(ms);
        return true;
      }
      if (target.el) setCheer(target.el, true);
      const fx = fxLayer(room);
      const bubble = pill(fx, { x: target.x, y: Math.max(16, target.y - HEAD_TOP * target.scale - TAG_H - 10) }, layout.rect.w, "\u2713 Got it, thanks!", "#16a34a", 11);
      bubble.style.transformBox = "fill-box";
      bubble.style.transformOrigin = "bottom left";
      if (!ctx.reduced) {
        confetti(room, { x: target.x + 30 * target.scale, y: target.y - 40 * target.scale });
        target.anim?.animate(
          [{ transform: "translateY(0px)" }, { transform: "translateY(-8px)", offset: 0.25 }, { transform: "translateY(0px)", offset: 0.5 }, { transform: "translateY(-5px)", offset: 0.7 }, { transform: "translateY(0px)" }],
          { duration: 700, easing: "ease-out", composite: "add" }
        );
      }
      const kf = ctx.reduced ? [{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }] : [
        { opacity: 0, transform: "scale(.3)" },
        { opacity: 1, transform: "scale(1.15)", offset: 0.15 },
        { opacity: 1, transform: "scale(1)", offset: 0.25 },
        { opacity: 1, transform: "scale(1)", offset: 0.8 },
        { opacity: 0, transform: "scale(1)" }
      ];
      const a = bubble.animate(kf, { duration: ms, fill: "forwards" });
      q.running.add(a);
      try {
        await done(a, ms);
      } finally {
        q.running.delete(a);
        bubble.parentElement?.remove();
        if (target.el) setCheer(target.el, false);
      }
      return true;
    }
    case "exit_door": {
      c.dataset.departing = "1";
      const to = { x: layout.door.x - base.x, y: layout.door.y - base.y };
      let ok;
      if (ctx.reduced) {
        ok = await walkStep(ctx, c, "exit_door", off, off, REDUCED_MS, [{ opacity: 1 }, { opacity: 0 }]);
      } else {
        openDoor(ctx, room, ms);
        ok = await walkStep(ctx, c, "exit_door", off, to, ms, [{ transform: tr(off), opacity: 1 }, { transform: tr(to), opacity: 1, offset: 0.8 }, { transform: tr(to), opacity: 0 }]);
      }
      if (!ok) return true;
      if (!layoutOf(room)?.seats[step.agentId]) c.remove();
      else restoreSeated(c);
      return true;
    }
    case "party":
      return party(ctx, room, layout, c, base, off, step, walkMs);
    case "shift_change": {
      const at = { x: layout.door.x - base.x, y: layout.door.y - base.y };
      doorTag(ctx, room, layout, "Shift change!", "#8b5cf6", ms * 1.4, false);
      if (ctx.reduced) {
        setOffset(anim, { x: 0, y: 0 });
        return walkStep(ctx, c, "shift_change", at, { x: 0, y: 0 }, REDUCED_MS, [{ opacity: 0 }, { opacity: 1 }]);
      }
      openDoor(ctx, room, ms * 0.6);
      setOffset(anim, at, 0);
      return walkStep(ctx, c, "shift_change", at, { x: 0, y: 0 }, ms, [{ transform: tr(at), opacity: 0 }, { transform: tr(at), opacity: 1, offset: 0.2 }, { transform: "translate(0px, 0px)", opacity: 1 }]);
    }
  }
  return false;
}
function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function receiver(room, layout, targetId) {
  const id = targetId && targetId !== "boss" && layout.seats[targetId] ? targetId : "boss";
  const p = id === "boss" ? layout.boss : layout.seats[id];
  if (!p) return void 0;
  const el2 = charEl(room, id);
  return { x: p.x, y: p.y, scale: id === "boss" ? layout.bossScale : layout.scale, el: el2, anim: el2?.querySelector(":scope > .anim") ?? null };
}

// src/scene/usageBar.ts
var pad2 = (n) => String(n).padStart(2, "0");
var dayOf = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
function rangeFor(kind, now, custom) {
  const today = dayOf(now);
  if (kind === "week") {
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (now.getDay() + 6) % 7);
    return { from: dayOf(monday), to: today };
  }
  if (kind === "month") return { from: dayOf(new Date(now.getFullYear(), now.getMonth(), 1)), to: today };
  if (kind === "custom" && custom && /^\d{4}-\d{2}-\d{2}$/.test(custom.from) && /^\d{4}-\d{2}-\d{2}$/.test(custom.to)) {
    return custom.from <= custom.to ? { from: custom.from, to: custom.to } : { from: custom.to, to: custom.from };
  }
  return { from: today, to: today };
}
function fmtTokens(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e7) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(Math.round(n));
}
function fmtUsd(n) {
  if (n > 0 && n < 5e-3) return "<$0.01";
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
var sumTokens = (t) => t.input + t.output + t.cacheRead + t.cacheWrite;
function modelLabel(id) {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d+))?$/.exec(id);
  if (!m) return id;
  return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ""}`;
}
function dayLabel(day, now) {
  const [y, mo, d] = day.split("-").map(Number);
  const dt = new Date(y, mo - 1, d);
  const s = dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return y === now.getFullYear() ? s : `${s}, ${y}`;
}
function barText(r) {
  if (!r) return { cost: "\u2014", tokens: "\u2014", written: "\u2014", cacheWrite: "\u2014", cacheRead: "\u2014", note: "" };
  const t = r.total;
  const note = r.scanning ? "reading logs\u2026" : t.unpricedTokens > 0 ? `${fmtTokens(t.unpricedTokens)} tokens from unpriced models not in cost` : "";
  return { cost: `~${fmtUsd(t.cost)}`, tokens: fmtTokens(sumTokens(t)), written: fmtTokens(t.output), cacheWrite: fmtTokens(t.cacheWrite), cacheRead: fmtTokens(t.cacheRead), note };
}
var RANGE_KEY = "agentOffice.usageRange";
var POLL_MS = 3e4;
var UsageBar = class {
  constructor(el2, details, token2) {
    this.el = el2;
    this.details = details;
    this.token = token2;
    const today = dayOf(/* @__PURE__ */ new Date());
    this.custom = { from: today, to: today };
    try {
      const saved = JSON.parse(localStorage.getItem(RANGE_KEY) ?? "null");
      if (saved?.kind && ["today", "week", "month", "custom"].includes(saved.kind)) this.kind = saved.kind;
      if (saved?.custom) this.custom = rangeFor("custom", /* @__PURE__ */ new Date(), saved.custom);
    } catch {
    }
    el2.addEventListener("click", (e) => {
      const t = e.target;
      const b = t.closest("[data-range]");
      if (b) return this.setKind(b.dataset.range);
      if (t.closest("#u-more")) this.toggleDetails();
    });
    for (const id of ["u-from", "u-to"]) {
      el2.querySelector(`#${id}`)?.addEventListener("change", () => {
        const from = el2.querySelector("#u-from").value;
        const to = el2.querySelector("#u-to").value;
        if (from && to) {
          this.custom = rangeFor("custom", /* @__PURE__ */ new Date(), { from, to });
          this.remember();
          void this.load();
        }
      });
    }
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) void this.load();
    });
    this.paintControls();
    void this.load();
  }
  el;
  details;
  token;
  kind = "today";
  custom;
  reply = null;
  timer;
  seq = 0;
  setKind(kind) {
    this.kind = kind;
    this.remember();
    this.paintControls();
    void this.load();
  }
  remember() {
    try {
      localStorage.setItem(RANGE_KEY, JSON.stringify({ kind: this.kind, custom: this.custom }));
    } catch {
    }
  }
  toggleDetails() {
    const open = this.details.hidden;
    this.details.hidden = !open;
    this.el.querySelector("#u-more")?.setAttribute("aria-expanded", String(open));
    if (open) this.paintDetails();
  }
  paintControls() {
    for (const b of this.el.querySelectorAll("[data-range]")) b.setAttribute("aria-pressed", String(b.dataset.range === this.kind));
    const box = this.el.querySelector(".u-custom");
    if (box) box.hidden = this.kind !== "custom";
    const today = dayOf(/* @__PURE__ */ new Date());
    const from = this.el.querySelector("#u-from");
    const to = this.el.querySelector("#u-to");
    if (from && to) {
      from.value = this.custom.from;
      to.value = this.custom.to;
      from.max = today;
      to.max = today;
    }
  }
  async load() {
    clearTimeout(this.timer);
    const mine = ++this.seq;
    const r = rangeFor(this.kind, /* @__PURE__ */ new Date(), this.custom);
    let next = POLL_MS;
    try {
      const res = await fetch(`/usage?from=${r.from}&to=${r.to}`, { headers: { "X-Agent-Office-Token": this.token }, cache: "no-store" });
      if (mine !== this.seq) return;
      if (res.ok) {
        this.reply = await res.json();
        if (this.reply.scanning) next = 2e3;
      } else {
        this.reply = null;
        this.el.hidden = res.status === 404;
      }
    } catch {
      if (mine !== this.seq) return;
      next = 5e3;
    }
    this.paint();
    this.timer = setTimeout(() => void this.load(), next);
  }
  paint() {
    const t = barText(this.reply);
    const set = (id, v) => {
      const n = this.el.querySelector(`#${id}`);
      if (n && n.textContent !== v) n.textContent = v;
    };
    set("u-cost", t.cost);
    set("u-tok", t.tokens);
    set("u-out", t.written);
    set("u-cw", t.cacheWrite);
    set("u-cr", t.cacheRead);
    set("u-note", t.note);
    if (!this.details.hidden) this.paintDetails();
  }
  /** The table: a row per day with its models beneath, like `ccusage`, and a total row. Built from numbers and model ids only. */
  paintDetails() {
    const r = this.reply;
    const now = /* @__PURE__ */ new Date();
    const doc = this.details.ownerDocument;
    const table = doc.createElement("table");
    const head = table.createTHead().insertRow();
    for (const h of ["Date", "Input", "Output", "Cache write", "Cache read", "Total tokens", "Est. cost"]) {
      const th = doc.createElement("th");
      th.textContent = h;
      head.appendChild(th);
    }
    const body = table.createTBody();
    const row = (label, t, cls) => {
      const tr2 = body.insertRow();
      tr2.className = cls;
      for (const v of [label, fmtTokens(t.input), fmtTokens(t.output), fmtTokens(t.cacheWrite), fmtTokens(t.cacheRead), fmtTokens(sumTokens(t)), fmtUsd(t.cost)]) tr2.insertCell().textContent = v;
    };
    for (const d of [...r?.days ?? []].reverse()) {
      row(dayLabel(d.day, now), d.total, "u-day");
      for (const [m, t] of Object.entries(d.models).sort((a, b) => b[1].cost - a[1].cost)) row(modelLabel(m), t, "u-model");
    }
    if (r && r.days.length) row("Total", r.total, "u-total");
    const note = doc.createElement("p");
    note.className = "u-fine";
    note.textContent = !r ? "No usage data yet." : r.days.length === 0 ? "No Claude Code usage in this range." : "Estimated at Anthropic API prices. On a Pro or Max plan you pay a flat subscription, so this is what the same usage would cost pay-per-token. Totals are saved daily to ~/.agent-office/usage.json, so they outlast Claude Code\u2019s 30-day log cleanup.";
    this.details.replaceChildren(...r && r.days.length ? [table] : [], note);
  }
};

// src/scene/main.ts
var viewport = document.getElementById("floor");
var svg = document.getElementById("office");
var layer = document.getElementById("rooms");
var empty = document.getElementById("empty");
var conn = document.getElementById("conn");
var floor = new Floor(svg, layer, viewport);
var params = new URLSearchParams(location.search);
var token = params.get("token") ?? "";
var KEY = "agentOffice.key";
var shell = params.get("shell") === "electron";
var compact = params.get("compact") === "1";
var pendingZoom = params.get("zoom");
document.documentElement.classList.toggle("shell", shell);
document.documentElement.classList.toggle("compact", compact);
var shellApi = window.agentOfficeShell;
if (shell) {
  document.getElementById("dragbar").hidden = false;
  document.getElementById("hide-btn")?.addEventListener("click", () => shellApi?.hide());
}
var strip = document.getElementById("strip");
strip.hidden = !compact;
var usageEl = document.getElementById("usage");
usageEl.hidden = true;
async function signIn() {
  if (token) return token;
  const ticket = params.get("ticket");
  if (ticket) {
    params.delete("ticket");
    const q = params.toString();
    history.replaceState(null, "", location.pathname + (q ? `?${q}` : "") + location.hash);
    try {
      const res = await fetch("/redeem", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticket }), cache: "no-store" });
      if (res.ok) {
        const key = String((await res.json()).key ?? "");
        try {
          sessionStorage.setItem(KEY, key);
        } catch {
        }
        return key;
      }
    } catch {
    }
  }
  try {
    return sessionStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}
var panelEl = document.getElementById("panel");
var panel = new InfoPanel(panelEl);
var PANEL_W = 300 + 24;
var ZOOM_MARGIN = 8;
var zoomed = null;
var savedScroll = { left: 0, top: 0 };
function applyZoom() {
  const rect = zoomed ? floor.layoutOf(zoomed)?.rect : void 0;
  if (!zoomed || !rect) {
    if (zoomed) zoomed = null;
    svg.style.transform = "";
    layer.classList.remove("zoomed");
    viewport.classList.remove("zoomed");
    for (const r of layer.querySelectorAll(".zoom-target")) r.classList.remove("zoom-target");
    return;
  }
  const vw = viewport.clientWidth;
  const vh = viewport.clientHeight;
  const availW = panel.isOpen && vw >= 520 ? vw - PANEL_W : vw;
  const s = Math.max(0.1, Math.min((availW - 2 * ZOOM_MARGIN) / rect.w, (vh - 2 * ZOOM_MARGIN) / rect.h));
  const tx = (availW - rect.w * s) / 2 - rect.x * s;
  const ty = (vh - rect.h * s) / 2 - rect.y * s;
  svg.style.transform = `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(${s.toFixed(4)})`;
}
function setZoom(sessionId) {
  if (sessionId === zoomed) return;
  if (sessionId && !floor.roomEl(sessionId)) return;
  if (!zoomed && sessionId) {
    savedScroll = { left: viewport.scrollLeft, top: viewport.scrollTop };
    viewport.scrollTo(0, 0);
  }
  const wasZoomed = zoomed !== null;
  zoomed = sessionId;
  for (const r of layer.querySelectorAll(".zoom-target")) r.classList.remove("zoom-target");
  if (sessionId) {
    floor.roomEl(sessionId)?.classList.add("zoom-target");
    layer.classList.add("zoomed");
    viewport.classList.add("zoomed");
    applyZoom();
  } else {
    applyZoom();
    if (wasZoomed) viewport.scrollTo(savedScroll.left, savedScroll.top);
  }
}
panel.onChange = applyZoom;
function markSelected() {
  const sel = panel.selection;
  for (const c of layer.querySelectorAll("g.char")) {
    c.classList.toggle("sel", !!sel && c.dataset.sessionId === sel.sessionId && c.dataset.agentId === sel.agentId);
  }
}
function refreshTags() {
  const { sessions } = floor.state;
  const title = officeTitle(waitingOnYou(floor.state));
  if (document.title !== title) document.title = title;
  for (const c of layer.querySelectorAll("g.char")) {
    const sess = sessions[c.dataset.sessionId ?? ""];
    const isBoss = c.dataset.agentId === "boss";
    const agent = isBoss ? void 0 : sess?.agents[c.dataset.agentId ?? ""];
    const stats = isBoss ? sess?.boss.stats : agent?.stats;
    const tok = c.querySelector(".tok");
    if (stats && tok) setTok(tok, hasUsage(stats) ? liveTokens(stats) : void 0);
    const live = isBoss ? sess?.boss.status === "working" || sess?.boss.status === "delegating" : agent?.status === "working" || agent?.status === "spawning";
    c.classList.toggle("live", !!live && sess?.status !== "ended");
  }
}
var stripSig = "";
var compactState = { sessions: {} };
function renderStrip(state) {
  const rooms = Floor.order(state).filter((s) => s.status !== "ended");
  empty.hidden = rooms.length > 0;
  const info = rooms.map((s) => {
    const agents = Object.values(s.agents).filter((a) => a.status !== "gone");
    const working = workingCount(s);
    return { s, working, need: s.boss.status === "needs_you" ? 1 : 0, total: agents.length + 1 };
  });
  const sig = JSON.stringify(info.map((i) => [i.s.id, roomTitle(i.s), i.s.boss.status, i.working, i.need]));
  if (sig === stripSig) return;
  stripSig = sig;
  strip.replaceChildren();
  for (const { s, working, need } of info) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip-room";
    b.dataset.sessionId = s.id;
    const look = bossLook(s.boss.status);
    const NS2 = "http://www.w3.org/2000/svg";
    const svgEl2 = document.createElementNS(NS2, "svg");
    svgEl2.setAttribute("viewBox", "-14.1 -62 28.2 36");
    svgEl2.appendChild(
      renderCharacter({ id: "boss", sessionId: s.id, color: looksFor("main").color, human: humanLook(s.id, "boss"), mood: look.mood, pose: poseClass(look, true), fx: look.fx, name: roomTitle(s), tokens: "", bust: true })
    );
    const text = document.createElement("div");
    const name = document.createElement("div");
    name.className = "cr-name";
    name.textContent = roomTitle(s);
    const counts = document.createElement("div");
    counts.className = "cr-counts";
    counts.append(`${working} working`);
    if (need) {
      const n = document.createElement("span");
      n.className = "cr-need";
      n.textContent = ` \xB7 ${need} needs you`;
      counts.append(n);
    }
    text.append(name, counts);
    b.append(svgEl2, text);
    strip.appendChild(b);
  }
}
strip.addEventListener("click", (e) => {
  const id = e.target.closest(".chip-room")?.dataset.sessionId;
  if (!id) return;
  if (shellApi) shellApi.expandRoom(id);
  else {
    const q = new URLSearchParams(location.search);
    q.delete("compact");
    q.set("zoom", id);
    location.search = q.toString();
  }
});
function afterRender() {
  if (compact) return;
  if (pendingZoom && floor.roomEl(pendingZoom)) {
    setZoom(pendingZoom);
    pendingZoom = null;
  }
  if (zoomed && !floor.roomEl(zoomed)) setZoom(null);
  else if (zoomed) applyZoom();
  if (zoomed) floor.roomEl(zoomed)?.classList.add("zoom-target");
  refreshTags();
  panel.refresh(floor.state);
  markSelected();
}
function draw() {
  if (compact) return renderStrip(compactState);
  const n = floor.render();
  empty.hidden = n > 0;
  afterRender();
}
viewport.addEventListener("click", (e) => {
  const t = e.target;
  const room = t.closest("g.room");
  const char = t.closest("g.char");
  if (room && char && room.dataset.sessionId) {
    panel.open({ sessionId: room.dataset.sessionId, agentId: char.dataset.agentId ?? "boss" }, floor.state);
    markSelected();
  } else if (room && room.dataset.sessionId) {
    setZoom(zoomed === room.dataset.sessionId ? null : room.dataset.sessionId);
  } else if (panel.isOpen) {
    panel.close();
    markSelected();
  } else {
    setZoom(null);
  }
});
panelEl.addEventListener("click", (e) => {
  if (e.target.closest('[data-action="close"]')) {
    panel.close();
    markSelected();
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (panel.isOpen) panel.close();
  else setZoom(null);
  markSelected();
});
var delay = 500;
function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(token)}`);
  ws.onopen = () => {
    delay = 500;
    conn.hidden = true;
  };
  ws.onmessage = (e) => {
    let msg;
    try {
      msg = JSON.parse(String(e.data));
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object" || !msg.state || typeof msg.state.sessions !== "object") return;
    if (compact) {
      compactState = msg.state;
      renderStrip(msg.state);
      return;
    }
    if (msg.type === "events" && Array.isArray(msg.events)) runAnimations(planAnimations(msg.events, msg.state), svg);
    empty.hidden = floor.render(msg.state) > 0;
    afterRender();
  };
  ws.onclose = () => {
    conn.hidden = false;
    void fetch("/state", { headers: { "X-Agent-Office-Token": token }, cache: "no-store" }).then((r) => r.status === 401).catch(() => false).then((expired) => {
      if (expired) {
        try {
          sessionStorage.removeItem(KEY);
        } catch {
        }
        conn.textContent = "Signed out (the office tracker restarted): run /office again for a fresh link.";
        return;
      }
      setTimeout(connect, delay);
      delay = Math.min(delay * 2, 5e3);
    });
  };
}
svg.addEventListener(ROOM_FADED_EVENT, (e) => {
  const sid = e.detail?.sessionId;
  if (!sid) return;
  floor.hideEnded(sid);
  draw();
});
var pending = 0;
new ResizeObserver(() => {
  cancelAnimationFrame(pending);
  pending = requestAnimationFrame(draw);
}).observe(viewport);
var running = "";
setInterval(() => {
  const r = runningKey(floor.state, Date.now());
  if (r !== running) {
    running = r;
    draw();
  }
  tickTimers(layer);
  refreshTags();
  panel.refresh(floor.state);
}, 1e3);
draw();
void signIn().then((t) => {
  token = t;
  if (!token) {
    empty.textContent = "This link has expired or was already used: run /office again for a fresh one.";
    return;
  }
  if (!compact) {
    usageEl.hidden = false;
    new UsageBar(usageEl, document.getElementById("usage-details"), token);
  }
  connect();
});
window.agentOffice = { floor, panel, zoom: setZoom, anim: animStats, planAnimations, runAnimations, svg };
//# sourceMappingURL=main.js.map
