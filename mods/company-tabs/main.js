import { View, div, svg, image } from "gpui-kit";
import { h_flex, ScrollHandle } from "gpui-base";
import { spaces, panes, machines, focused, nextCommand, run, openOverlay, notify, theme, window, shared, setShared, layout, settings, exec, appHome, checking, readTextFile, writeTextFile } from "herdr";

// Office layouts (mods/company-layouts): tabs whose seating plan is kept, by tab id:
// { preset, order: [pane ids], lead, machine }.
const KEPT = "pixel-hq.office-layouts";
const PRESETS = ["cubicles", "open-plan", "standup", "corner-office", "boardroom"];
const LEAD_PRESETS = ["corner-office", "boardroom"];
const LAYOUTS_KEY = "ctrl-shift-l";
const LAYOUTS_ACTION = "mod.open:company-layouts";

// Same as company-layouts: runs its arrange.py for one tab, machine ids made local and back.
async function arrangeTab(tab, preset, { order, lead, machine } = {}) {
  const local = (id) => (machine && id?.startsWith(`${machine}/`) ? id.slice(machine.length + 1) : id);
  const args = [`${appHome()}/mods/company-layouts/arrange.py`, local(tab), preset];
  if (order?.length) args.push("--order", order.map(local).join(","));
  if (lead) args.push("--lead", local(lead));
  if (machine) args.push("--on", machine);
  let failure = "python3 is not installed";
  for (const python of ["python3", "python"]) {
    try {
      const r = await exec(python, args, { timeout: 20000 });
      const out = JSON.parse(r.stdout.trim().split("\n").pop() || "{}");
      if (!out.ok) return { error: out.error ?? (r.stderr.trim() || "could not arrange this tab") };
      if (machine) out.order = out.order.map((id) => `${machine}/${id}`);
      return out;
    } catch (err) {
      failure = String(err?.message ?? err);
    }
  }
  return { error: failure };
}

// Ctrl+Shift+L opens Office layouts, unless the key already does something else
// (Herdr binds it to layout.switch on Linux and Windows).
async function ensureLayoutsHotkey() {
  try {
    const path = `${appHome()}/keys.json`;
    const raw = await readTextFile(path).catch(() => null);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed.global || (parsed.global[LAYOUTS_KEY] ?? LAYOUTS_ACTION) !== LAYOUTS_ACTION) return;
    let changed = false;
    for (const section of ["global", "terminal"]) {
      if (parsed[section] && !parsed[section][LAYOUTS_KEY]) {
        parsed[section][LAYOUTS_KEY] = LAYOUTS_ACTION;
        changed = true;
      }
    }
    if (changed) await writeTextFile(path, JSON.stringify(parsed, null, 2), raw);
  } catch {}
}

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// Same as the agents mod: drops a status glyph, keeps a leading bracket or quote.
const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}\p{Ps}\p{Pi}]+/u, "").replace(/^\[ [!.] \] /, "").trim();

// A tab Herdr named (unnamed, or after its program) follows its agent's live
// title, as the agents list does; a name the person gave stays.
function label(tab, lead) {
  const prog = lead?.program?.name;
  const base = tab.named ? tab.name : prog ?? "Terminal";
  if (!lead?.program?.agent) return base;
  const live = clean(lead.title);
  // clean() would strip a path's leading ~ or /: test the title with only its status glyph gone.
  const path = /^[~/]|^[A-Za-z]:\\/.test((lead.title ?? "").replace(/^[^\p{L}\p{N}~/]+/u, ""));
  const telling = live && live !== lead.terminal && live !== prog && !path && !live.includes("@") && live.toLowerCase() !== lead.program.key;
  return (tab.name === prog || !tab.named) && telling ? live : base;
}

const MONO = "JetBrains Mono";
// A notched rectangle, drawn as two overlapping blocks with 2px cut corners. Insets are
// [left, right, top, bottom] from the container, so a shape can sit inside another.
const notch = (c, [l, r, t, b]) => [
  div().absolute().left(l + 2).right(r + 2).top(t).bottom(b).bg(c),
  div().absolute().left(l).right(r).top(t + 2).bottom(b + 2).bg(c),
];
// A pixel box: a 2px frame and a hard 2px shadow, both notched. The container leaves the
// shadow's 2px on its right and bottom; the content sits 2px inside the frame.
const box = (frame, fill, shadow) => [
  ...notch(shadow, [2, 0, 2, 0]),
  ...notch(frame, [0, 2, 0, 2]),
  ...notch(fill, [2, 4, 2, 4]),
];
// A pixel X: 2px steps down both diagonals, so it reads as a cross, not a plus.
const cross = (c, size) => {
  const step = size / 4;
  return [0, 1, 2, 3].flatMap((i) => [
    div().absolute().left(i * step).top(i * step).w(step).h(step).bg(c),
    div().absolute().left(size - step - i * step).top(i * step).w(step).h(step).bg(c),
  ]);
};

// Status marks, drawn in 2px pixels so they read at a glance.
// A pixel ring: eight 4px cells around a 12px square, a bright head and a fading tail.
const RING = [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2], [1, 2], [0, 2], [0, 1]];
const spinner = (c, f) => div().relative().flex_none().size(14)
  .children(RING.map(([x, y], i) => div().absolute().left(x * 5).top(y * 5).size(4).bg(c).opacity([1, 0.8, 0.55, 0.35, 0.2, 0.12, 0.12, 0.12][(f - i + 8) % 8])));
const tick = (c) => div().relative().flex_none().w(10).h(10)
  .children([[0, 6], [2, 8], [4, 6], [6, 4], [8, 2]].map(([x, y]) => div().absolute().left(x).top(y - 2).w(2).h(4).bg(c)));
const bang = (c) => div().relative().flex_none().w(4).h(10)
  .children([div().absolute().left(1).top(0).w(2).h(6).bg(c), div().absolute().left(1).top(8).w(2).h(2).bg(c)]);
const plus = (c) => div().relative().flex_none().w(10).h(10)
  .children([div().absolute().left(3).top(0).w(4).h(10).bg(c), div().absolute().left(0).top(3).w(10).h(4).bg(c)]);

export default class Tabs extends View {
  init(_props, cx) {
    this.pressed = null;
    this.frame = 0; this.spin = false;
    cx.timer.every(110, (cx) => { if (this.spin) { this.frame = (this.frame + 1) % 8; cx.notify(); } });
    this.scroll = ScrollHandle.new();
    try { this.panels = JSON.parse(localStorage.getItem("panels") ?? "{}"); } catch { this.panels = {}; }
    if (!this.panels || typeof this.panels !== "object" || Array.isArray(this.panels)) this.panels = {};
    this.swipe = { acc: 0, steps: 0, at: 0, last: 0 };
    this.arranging = new Set();
    if (!checking()) cx.spawn(async () => ensureLayoutsHotkey());
    // Render runs only when the window draws, so kept layouts are checked on a timer: an agent
    // that joins while Herdr is behind another app is seated within a second all the same.
    cx.timer.every(1000, (cx) => this.keepLayouts(cx));
    // company-tabs.layout-<preset> arranges the shown tab and keeps it; layout-off stops keeping.
    cx.spawn(async (cx) => {
      for (;;) {
        const c = String(await nextCommand());
        if (c === "layout-off") this.officeLayout(null);
        else if (c.startsWith("layout-") && PRESETS.includes(c.slice(7))) this.officeLayout(c.slice(7));
        this.keepLayouts(cx);
        cx.notify();
      }
    });
  }

  officeLayout(preset) {
    const f = focused();
    const space = spaces().find((s) => s.id === f?.space) ?? spaces().find((s) => s.active);
    const tab = space?.tabs.find((t) => t.id === f?.tab) ?? space?.tabs.find((t) => t.active);
    if (!tab) return;
    const kept = { ...(shared(KEPT) ?? {}) };
    delete kept[tab.id];
    if (!preset) {
      setShared(KEPT, kept);
      return;
    }
    const mine = panes().filter((p) => p.tab === tab.id);
    const lead = LEAD_PRESETS.includes(preset) ? (mine.find((p) => p.pane === f?.pane) ?? mine.find((p) => p.focused) ?? mine[0])?.pane : null;
    // keepLayouts (run right after) seats it: with nobody seated yet, every pane counts as new.
    setShared(KEPT, { ...kept, [tab.id]: { preset, order: [], lead: lead ?? null, machine: space.machine } });
  }

  // A tab with a kept office layout is re-arranged when its panes change (an agent joined
  // or left): seated desks keep their places on screen, newcomers take the last seats.
  keepLayouts(cx) {
    const kept = shared(KEPT);
    if (!kept || typeof kept !== "object") return;
    const all = panes();
    const owner = new Map(spaces().flatMap((s) => s.tabs.map((tab) => [tab.id, s])));
    const loaded = new Map(machines().map((m) => [m.name ?? null, m.layout === "ready"]));
    const update = (tab, change) => {
      const now = { ...(shared(KEPT) ?? {}) };
      if (change) now[tab] = { ...now[tab], ...change };
      else delete now[tab];
      setShared(KEPT, now);
    };
    for (const [tab, want] of Object.entries(kept)) {
      if (!want?.preset || this.arranging.has(tab)) continue;
      const space = owner.get(tab);
      if (!space) {
        if (loaded.get(want.machine ?? null) === true) cx.spawn(async () => update(tab, null));
        continue;
      }
      const ids = all.filter((p) => p.tab === tab).map((p) => p.pane);
      const order = want.order ?? [];
      if (!ids.length || (ids.length === order.length && ids.every((id) => order.includes(id)))) continue;
      this.arranging.add(tab);
      cx.spawn(async () => {
        const r = await arrangeTab(tab, want.preset, { order, lead: want.lead, machine: space.machine });
        this.arranging.delete(tab);
        if ((shared(KEPT) ?? {})[tab]?.preset !== want.preset) return;
        if (r.error) {
          // Wait for the next change instead of retrying on every redraw.
          update(tab, { order: ids });
          notify({ title: "Office layout", body: `Could not re-arrange ${space.tabs.find((t) => t.id === tab)?.name ?? "a tab"}: ${r.error}`, level: "error", timeout: 8000 });
        } else update(tab, { order: r.order, lead: want.lead ? r.order[0] : null });
      });
    }
  }

  // One tab per wheel notch. A touchpad or smooth-scrolling mouse sends many
  // small events per gesture: a short swipe or one smoothed notch (about
  // 25 px) switches one tab, a longer swipe keeps going a tab per 60 px, at
  // most one every 100 ms so each shows.
  wheel(e) {
    if (e.delta_lines) {
      if (e.delta_lines.y) run(e.delta_lines.y > 0 ? "tab.prev" : "tab.next");
      return;
    }
    const s = this.swipe, now = Date.now();
    // Phases often arrive only as moves (a macOS touchpad included): a pause
    // or a turn starts a new gesture.
    if (e.touch_phase === "started" || now - s.at > 250 || e.delta.y * s.acc < 0) Object.assign(s, { acc: 0, steps: 0 });
    s.at = now;
    s.acc += e.delta.y;
    const need = s.steps ? 60 : 20;
    if (Math.abs(s.acc) < need || now - s.last < 100) return;
    s.acc -= Math.sign(s.acc) * need;
    s.steps++;
    s.last = now;
    run(e.delta.y > 0 ? "tab.prev" : "tab.next");
  }

  // The side panel is remembered per space: switching shows that space's choice
  // (closed if it never had one), and opening or closing it records it.
  syncPanel(space, panel, body, enabled) {
    if (!space || !panel) return;
    const now = panel.hidden ? null : body?.active ?? null;
    if (space.id !== this.space) {
      const first = this.space === undefined;
      this.space = space.id; this.pending = null;
      if (!(first && !(space.id in this.panels))) {
        const stored = this.panels[space.id] ?? null, want = enabled.includes(stored) ? stored : null;
        if (want !== now) {
          this.pending = { want, until: Date.now() + 1000 };
          if (want) { run("layout.select", { stack: "panel-body", child: want }); run("layout.show", { id: "panel" }); }
          else run("layout.hide", { id: "panel" });
          return;
        }
      }
    }
    // Until the restore lands (or something else won), the old state isn't a choice.
    if (this.pending) {
      if (this.pending.want !== now && Date.now() < this.pending.until) return;
      this.pending = null;
    }
    if (this.panels[space.id] === now) return;
    this.panels[space.id] = now;
    localStorage.setItem("panels", JSON.stringify(this.panels));
  }

  render() {
    const t = theme();
    const space = spaces().find(p => p.active);
    const shown = space?.tabs ?? [];
    const active = shown.findIndex(tab => tab.active);
    const selected = shown[active]?.id;
    this.spin = shown.some(tab => tab.status === "working");
    if (selected !== this.selected || active !== this.selectedIndex) {
      this.selected = selected;
      this.selectedIndex = active;
      if (active >= 0) this.scroll.scroll_to_item(active);
    }
    const stop = (_e, cx) => cx.stop_propagation();
    const button = (id, glyph, action) => div().id(id).relative().size(28).flex_none().flex().items_center().justify_center()
      .children(box(t.raised, t.chrome, t.surface)).font_family(MONO).font_bold().text_size(11).text_color(t.muted)
      .hover(s => s.text_color(t.foreground))
      .on_mouse_down("left", stop).on_click(action).child(glyph === "+" ? plus(t.accent) : glyph);
    const item = (c, i) => {
      const lead = panes().find(p => p.tab === c.id && p.program?.agent) ?? panes().find(p => p.tab === c.id);
      const program = lead?.program;
      const name = label(c, lead);
      return h_flex().id(`tab-${c.id}`).relative().h(32).pl(9).pr(11).pt(4).pb(6).gap(7).items_center().flex_none()
        .children([...box(c.active ? t.muted : t.raised, c.active ? t.raised : t.chrome, t.surface), ...(c.active ? [div().absolute().left(8).right(10).bottom(4).h(2).bg(t.accent)] : [])])
        // A rename or status dot on this or an earlier tab can push the active one out.
        .when(i <= active, el => el.on_size_change((_size, cx) => { this.scroll.scroll_to_item(active); cx.notify(); }))
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.pressed = i; if (e.click_count === 2) run("tab.rename", { id: c.id }); })
        .on_mouse_up("left", () => {
          const from = this.pressed; this.pressed = null;
          if (from !== null && from !== i) run("tab.move", { id: shown[from].id, index: space.tabs.findIndex(x => x.id === c.id) + 1 });
          else run("tab.select", { id: c.id });
        })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: c.id, space: space.id } } }); })
        .when(Boolean(program?.icon), el => el.child(program.tint ? svg(program.icon).size(14).text_color(c.active ? t.accent : t.muted) : image(program.icon).size(14)))
        .child(div().max_w(170).truncate().font_family(MONO).font_bold().text_size(11).text_color(c.active ? t.foreground : t.muted).child(c.zoomed ? `${name} Z` : name))
        .when(c.status === "working", el => el.child(spinner(t.working, this.frame)))
        .when(c.status === "blocked", el => el.child(bang(t.blocked)))
        .when(c.status === "done", el => el.child(tick(t.done)))
        .when(c.active, el => el.child(div().id(`close-${c.id}`).flex_none().relative().w(8).h(8).cursor_pointer().on_mouse_down("left", stop)
          .on_click((_e, cx) => { cx.stop_propagation(); run("tab.close", { id: c.id }); })
          .children(cross(t.muted, 8))));
    };
    const root = layout(), sidebar = find(root, "sidebar"), w = window();
    // Old saved rails and a dragged-narrow sidebar can be smaller than the window buttons.
    const lightsPadding = w?.platform === "macos" && w.titlebar === "none" && !w.fullscreen && root?.traffic_lights
      ? Math.max(10, (root.traffic_lights[0] + 64) / settings().zoom - (sidebar?.hidden ? 0 : sidebar?.size?.px ?? 0))
      : 10;
    const panel = find(root, "panel"), body = find(root, "panel-body");
    const enabled = shared("workspace.panels") ?? ["files", "changes"];
    this.syncPanel(space, panel, body, enabled);
    const panelButton = (id, text) => {
      const on = panel && !panel.hidden && body?.active === id;
      return h_flex().id(`panel-${id}`).relative().h(28).pl(9).pr(11).pt(4).pb(6).flex_none().items_center()
        .children([...box(on ? t.muted : t.raised, on ? t.raised : t.chrome, t.surface), ...(on ? [div().absolute().left(8).right(10).bottom(4).h(2).bg(t.accent)] : [])])
        .font_family(MONO).font_bold().text_size(10).text_color(on ? t.foreground : t.muted).hover(s => s.text_color(t.foreground))
        .on_mouse_down("left", stop)
        .on_click(() => {
          if (on) run("layout.hide", { id: "panel" });
          else { run("layout.select", { stack: "panel-body", child: id }); run("layout.show", { id: "panel" }); }
        })
        .child(text.toUpperCase());
    };
    // Office layouts: underlined while the shown tab keeps one.
    const layoutKept = Boolean(selected && (shared(KEPT) ?? {})[selected]?.preset);
    const layoutButton = h_flex().id("office-layouts").relative().h(28).pl(9).pr(11).pt(4).pb(6).flex_none().items_center()
      .children([...box(t.raised, t.chrome, t.surface), ...(layoutKept ? [div().absolute().left(8).right(10).bottom(4).h(2).bg(t.accent)] : [])])
      .font_family(MONO).font_bold().text_size(10).text_color(layoutKept ? t.foreground : t.muted).hover(s => s.text_color(t.foreground))
      .on_mouse_down("left", stop)
      .on_click(() => run("mod.open", { name: "company-layouts" }))
      .child("LAYOUT");
    return h_flex().size_full().min_w(0).px(10).pl(lightsPadding).gap(3).items_center().bg(t.chrome).border_b(1).border_color(t.surface)
      .on_mouse_up("left", () => { this.pressed = null; })
      .on_scroll_wheel(e => this.wheel(e))
      .child(h_flex().id("tab-scroll").flex_1().min_w(0).h_full().items_center().gap(3).overflow_x_scrollbar().track_scroll(this.scroll)
        .on_size_change((_size, cx) => { if (active >= 0) { this.scroll.scroll_to_item(active); cx.notify(); } })
        .children(shown.map(item)))
      .child(button("tab-new", "+", () => openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 })))
      .child(layoutButton)
      .when(enabled.includes("files"), el => el.child(panelButton("files", "Files")))
      .when(enabled.includes("changes"), el => el.child(panelButton("changes", "Changes")))
      .when(w?.buttons, el => el.child(button("minimize", w.platform === "windows" ? svg("mods/company-tabs/win-min.svg").size(14) : "−", () => run("window.minimize")))
        .child(button("maximize", w.platform === "windows" ? svg(`mods/company-tabs/${w.maximized ? "win-restore" : "win-max"}.svg`).size(14) : "□", () => run("window.maximize")))
        .child(button("close-window", w.platform === "windows" ? svg("mods/company-tabs/win-close.svg").size(14) : svg("mods/company-pane/close.svg").size(13), () => run("window.close"))));
  }
}
