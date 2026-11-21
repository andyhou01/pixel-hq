// Pixel HQ Office Layouts
// Pick how the current tab's desks (panes) are arranged: cubicles, open plan, stand-up,
// corner office or boardroom. arrange.py rewrites the tab's split tree; with Keep on, the
// tab bar (company-tabs) re-applies the choice whenever agents join or leave that tab.

import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, panes, terminals, focused, keys, theme, props, closeOverlay, shared, setShared, exec, appHome } from "herdr";

const MONO = "JetBrains Mono";
const KEPT = "pixel-hq.office-layouts";
const LEAD = 0.6;

const grid = (n) => {
  const cols = Math.ceil(Math.sqrt(n));
  return { cols, rows: Math.ceil(n / cols) };
};

const PRESETS = [
  { id: "cubicles", name: "Cubicles", about: (n) => (n > 1 ? `${grid(n).cols}×${grid(n).rows} grid` : "Balanced grid") },
  { id: "open-plan", name: "Open plan", about: () => "Side by side" },
  { id: "standup", name: "Stand-up", about: () => "Stacked rows" },
  { id: "corner-office", name: "Corner office", about: () => "Lead left + team", lead: true },
  { id: "boardroom", name: "Boardroom", about: () => "Lead top + team", lead: true },
];

const range = (n) => Array.from({ length: n }, (_, i) => i);

// Where each desk sits, as [x, y, w, h] shares of the tab, plus whether it's the lead's.
// Mirrors build() in arrange.py.
function rects(preset, n) {
  if (n <= 1) return [[0, 0, 1, 1, false]];
  if (preset === "open-plan") return range(n).map((i) => [i / n, 0, 1 / n, 1, false]);
  if (preset === "standup") return range(n).map((i) => [0, i / n, 1, 1 / n, false]);
  if (preset === "cubicles") {
    const { cols, rows } = grid(n);
    return range(n).map((i) => {
      const r = Math.floor(i / cols), k = Math.min(cols, n - r * cols), c = i - r * cols;
      return [c / k, r / rows, 1 / k, 1 / rows, false];
    });
  }
  const team = n - 1;
  if (preset === "corner-office") return [[0, 0, LEAD, 1, true], ...range(team).map((i) => [LEAD, i / team, 1 - LEAD, 1 / team, false])];
  return [[0, 0, 1, LEAD, true], ...range(team).map((i) => [i / team, LEAD, 1 / team, 1 - LEAD, false])];
}

// Runs arrange.py for one tab. Ids from another machine carry a "machine/" prefix that its
// own core doesn't use, so it's dropped on the way in and put back on the way out.
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

const notch = (c, [l, r, t, b]) => [
  div().absolute().left(l + 2).right(r + 2).top(t).bottom(b).bg(c),
  div().absolute().left(l).right(r).top(t + 2).bottom(b + 2).bg(c),
];
const box = (frame, fill, shadow) => [
  ...notch(shadow, [2, 0, 2, 0]),
  ...notch(frame, [0, 2, 0, 2]),
  ...notch(fill, [2, 4, 2, 4]),
];

export default class OfficeLayouts extends View {
  init(_props, cx) {
    this.selected = 0;
    this.busy = null;
    this.error = null;
    const ctx = this.context();
    const kept = ctx ? (shared(KEPT) ?? {})[ctx.tab.id] : null;
    if (kept) this.selected = Math.max(0, PRESETS.findIndex((p) => p.id === kept.preset));
    this.keep = kept ? true : localStorage.getItem("keep") !== "false";
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.timer.after(150, () => this.handle.focus());
  }

  // The tab the window shows, its panes and the lead: the pane you're in.
  context() {
    const f = focused();
    const space = spaces().find((s) => s.id === f?.space) ?? spaces().find((s) => s.active);
    const tab = space?.tabs.find((t) => t.id === f?.tab) ?? space?.tabs.find((t) => t.active);
    if (!tab) return null;
    const mine = panes().filter((p) => p.tab === tab.id);
    const lead = mine.find((p) => p.pane === f?.pane) ?? mine.find((p) => p.focused) ?? mine[0] ?? null;
    return { space, tab, panes: mine, lead };
  }

  leadName(pane) {
    if (!pane) return "";
    const named = pane.terminal && terminals().find((x) => x.address === pane.terminal)?.name;
    return named || pane.program?.name || pane.title || "desk";
  }

  close() {
    closeOverlay(props()?.overlay);
  }

  setKeep(on, cx) {
    this.keep = on;
    localStorage.setItem("keep", String(on));
    const ctx = this.context();
    const kept = { ...(shared(KEPT) ?? {}) };
    if (!on && ctx && kept[ctx.tab.id]) {
      delete kept[ctx.tab.id];
      setShared(KEPT, kept);
    }
    cx.notify();
  }

  pick(index, cx) {
    const preset = PRESETS[index];
    const ctx = this.context();
    if (!preset || !ctx?.panes.length || this.busy) return;
    this.selected = index;
    this.busy = preset.id;
    this.error = null;
    cx.notify();
    const lead = preset.lead ? ctx.lead?.pane : null;
    cx.spawn(async (cx) => {
      const r = await arrangeTab(ctx.tab.id, preset.id, { lead, machine: ctx.space.machine });
      this.busy = null;
      if (r.error) {
        this.error = r.error;
        cx.notify();
        return;
      }
      const kept = { ...(shared(KEPT) ?? {}) };
      if (this.keep) kept[ctx.tab.id] = { preset: preset.id, order: r.order, lead: lead ? r.order[0] : null, machine: ctx.space.machine };
      else delete kept[ctx.tab.id];
      setShared(KEPT, kept);
      this.close();
    });
  }

  thumb(preset, n, on) {
    const t = theme();
    const W = 100, H = 60;
    return div().relative().w(W).h(H).flex_none().bg(t.background).border_1().border_color(on ? t.accent : t.border)
      .children(rects(preset.id, Math.min(Math.max(n, 1), 9)).map(([x, y, w, h, lead]) =>
        div().absolute()
          .left(Math.round(x * W) + 2).top(Math.round(y * H) + 2)
          .w(Math.max(2, Math.round(w * W) - 4)).h(Math.max(2, Math.round(h * H) - 4))
          .bg(lead ? t.accent : on ? t.muted : t.raised)
          .child(div().absolute().left(2).right(2).top(2).h(2).bg(t.background).opacity(0.5))));
  }

  render(cx) {
    const t = theme();
    const ctx = this.context();
    const n = ctx?.panes.length ?? 0;
    const kept = ctx ? (shared(KEPT) ?? {})[ctx.tab.id] : null;
    const hotkey = keys().some((k) => k.keys === "ctrl-shift-l" && k.action === "mod.open:company-layouts");
    const stop = (_e, cx) => cx.stop_propagation();

    const tile = (preset, i) => {
      const sel = this.selected === i;
      const inUse = kept?.preset === preset.id;
      const loading = this.busy === preset.id;
      return v_flex().id(`layout-${preset.id}`).relative().w(112).pt(8).pb(10).px(6).gap(6).items_center().cursor_pointer()
        .children(box(sel ? t.accent : t.border, sel ? t.raised : t.surface, t.background))
        .on_mouse_down("left", stop)
        .on_click((_e, cx) => this.pick(i, cx))
        .child(div().relative().child(this.thumb(preset, n, sel)))
        .child(h_flex().relative().gap(5).items_center()
          .child(div().px(3).bg(t.background).border_1().border_color(sel ? t.accent : t.border)
            .font_family(MONO).font_bold().text_size(8.5).text_color(sel ? t.accent : t.muted).child(String(i + 1)))
          .child(div().font_family(MONO).font_bold().text_size(10.5).text_color(sel ? t.foreground : t.muted)
            .child(loading ? "MOVING…" : preset.name.toUpperCase())))
        .child(div().relative().font_family(MONO).text_size(9).text_color(t.dim).child(preset.about(n)))
        .when(inUse, (el) => el.child(div().absolute().top(4).right(8).px(3).bg(t.accent)
          .font_family(MONO).font_bold().text_size(7.5).text_color(t.accent_foreground).child("KEPT")));
    };

    const check = h_flex().id("keep-toggle").relative().gap(7).items_center().cursor_pointer()
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => this.setKeep(!this.keep, cx))
      .child(div().relative().size(12).border_1().border_color(this.keep ? t.accent : t.muted).bg(t.background)
        .when(this.keep, (el) => el.child(div().absolute().left(2).top(2).size(6).bg(t.accent))))
      .child(div().font_family(MONO).font_bold().text_size(9.5).text_color(this.keep ? t.foreground : t.muted)
        .child("KEEP WHEN AGENTS JOIN OR LEAVE"));

    const sub = !ctx ? "No tab is open."
      : !n ? "This tab has no desks yet."
      : `${ctx.tab.name.toUpperCase()} · ${n} ${n === 1 ? "DESK" : "DESKS"} · LEAD: ${this.leadName(ctx.lead).toUpperCase()}`;

    return v_flex().id("company-layouts").track_focus(this.handle)
      .on_key_down((e, cx) => {
        const k = e.key;
        if (k === "escape") { this.close(); cx.stop_propagation(); return; }
        if (/^[1-5]$/.test(k)) { this.pick(Number(k) - 1, cx); cx.stop_propagation(); return; }
        if (k === "right" || k === "arrow_right" || (k === "tab" && !e.modifiers?.shift)) {
          this.selected = (this.selected + 1) % PRESETS.length; cx.stop_propagation(); cx.notify(); return;
        }
        if (k === "left" || k === "arrow_left" || (k === "tab" && e.modifiers?.shift)) {
          this.selected = (this.selected - 1 + PRESETS.length) % PRESETS.length; cx.stop_propagation(); cx.notify(); return;
        }
        if (k === "enter") { this.pick(this.selected, cx); cx.stop_propagation(); return; }
        if (k === "k") { this.setKeep(!this.keep, cx); cx.stop_propagation(); }
      })
      .size_full().min_h(0).relative()
      .children(box(t.border, t.chrome, t.background))
      .child(v_flex().relative().size_full().p(12).gap(10).font_family(MONO)
        .child(h_flex().w_full().pb(6).items_center().justify_between().border_b(1).border_color(t.surface)
          .child(h_flex().gap(8).items_center()
            .child(div().font_bold().text_size(12).text_color(t.foreground).child("OFFICE LAYOUTS // SEATING PLAN"))
            .when(hotkey, (el) => el.child(div().px(4).py(1).border_1().border_color(t.accent)
              .font_bold().text_size(8.5).text_color(t.accent).child("CTRL+SHIFT+L"))))
          .child(h_flex().id("btn-esc-layouts").relative().h(22).px(8).items_center().justify_center().cursor_pointer()
            .children(box(t.border, t.surface, t.background))
            .on_mouse_down("left", stop)
            .on_click(() => this.close())
            .child(div().relative().font_bold().text_size(9.5).text_color(t.muted).child("ESC"))))
        .child(div().text_size(9.5).text_color(t.muted).child(sub))
        .child(h_flex().w_full().gap(8).items_start().justify_center().children(PRESETS.map(tile)))
        .when(Boolean(this.error), (el) => el.child(div().text_size(9.5).text_color(t.blocked).child(`Could not arrange: ${this.error}`)))
        .child(div().flex_1())
        .child(h_flex().h(24).pt(6).items_center().justify_between().border_t(1).border_color(t.surface)
          .child(check)
          .child(div().text_size(9).text_color(t.dim).child("1–5 PICK · ←/→ + ENTER · K KEEP · ESC"))));
  }
}
