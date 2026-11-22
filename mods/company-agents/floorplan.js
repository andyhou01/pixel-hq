// Floor plans: where each desk sits on an office floor. Pure (no herdr imports), so tests load it.
// A plan lays desks out in rows; spots turn them into a desk's centre across the floor and its
// row down the floor, both 0..1, which the office maps onto the room it has.

export const FLOOR_PLANS = [
  { id: "cubicles", name: "Cubicles", about: "Staggered grid" },
  { id: "boardroom", name: "Boardroom", about: "Lead at the head, team below", lead: true },
  { id: "pod", name: "Pod", about: "Lead in the middle, team around", lead: true },
  { id: "corner-office", name: "Corner office", about: "Lead in a corner, team aside", lead: true },
  { id: "standup", name: "Stand-up", about: "One column" },
  { id: "open-plan", name: "Open plan", about: "Even rows" },
];

export const planOf = (id) => FLOOR_PLANS.find((p) => p.id === id) ?? FLOOR_PLANS[0];

// Teams on one floor, leads in the order given: a desk joins its topmost ancestor (its
// terminal's parent, and so on) that also sits on this floor; anyone else leads.
export function floorTeams(addrs, parentOf) {
  const here = new Set(addrs);
  const rootOf = (a) => {
    let root = a;
    const seen = new Set([a]);
    for (let p = parentOf.get(root); p && here.has(p) && !seen.has(p); p = parentOf.get(root)) {
      seen.add(p);
      root = p;
    }
    return root;
  };
  const byLead = new Map();
  for (const a of addrs) {
    const lead = rootOf(a);
    if (!byLead.has(lead)) byLead.set(lead, { lead, team: [] });
    if (lead !== a) byLead.get(lead).team.push(a);
  }
  return addrs.filter((a) => byLead.has(a)).map((a) => byLead.get(a));
}

// The live sub-agents (terminals it started with `hc run`) that sit at an agent's desk as
// interns: only those with no desk of their own. One with a pane is in `desks` and gets its
// own (smaller) desk on the floor instead, in its lead's team.
export function deskInterns(terminals, addr, desks) {
  return terminals.filter((k) => k.parent === addr && k.state === "live" && !desks.has(k.address));
}

const chunk = (xs, n) => {
  const out = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

// { cols, rows }: rows of desks (null leaves a cell empty; a short row is centred), at most
// `cols` across. Null for cubicles, which keeps the office's own staggered grid. Desks with
// no team sit in plain rows after the teams.
export function planRows(plan, teams, cols) {
  const C = Math.max(1, cols);
  const everyone = teams.flatMap((t) => [t.lead, ...t.team]);
  const crews = teams.filter((t) => t.team.length);
  const bench = chunk(teams.filter((t) => !t.team.length).map((t) => t.lead), C);
  if (plan === "standup") return { cols: 1, rows: everyone.map((a) => [a]) };
  if (plan === "open-plan") {
    const across = Math.max(1, Math.min(C, everyone.length));
    return { cols: across, rows: chunk(everyone, across) };
  }
  if (plan === "boardroom") return { cols: C, rows: [...crews.flatMap((t) => [[t.lead], ...chunk(t.team, C)]), ...bench] };
  if (plan === "pod") {
    return {
      cols: C,
      rows: [...crews.flatMap((t) => {
        const up = Math.ceil(t.team.length / 2);
        return [...chunk(t.team.slice(0, up), C), [t.lead], ...chunk(t.team.slice(up), C)];
      }), ...bench],
    };
  }
  if (plan === "corner-office") {
    if (C < 2) return planRows("standup", teams, 1);
    const rows = crews.flatMap((t) => {
      const tall = Math.ceil(t.team.length / (C - 1));
      const grid = Array.from({ length: tall }, () => Array(C).fill(null));
      grid[0][0] = t.lead;
      t.team.forEach((a, i) => { grid[i % tall][1 + Math.floor(i / tall)] = a; });
      return grid;
    });
    return { cols: C, rows: [...rows, ...bench] };
  }
  return null;
}

// Desk -> [centre across, row down], both 0..1.
export function planSpots(layout) {
  const spots = new Map();
  const last = layout.rows.length - 1;
  layout.rows.forEach((row, r) => row.forEach((a, j) => {
    if (a != null) spots.set(a, [(j + 0.5 + (layout.cols - row.length) / 2) / layout.cols, last > 0 ? r / last : 0]);
  }));
  return spots;
}

// The cubicles' staggered grid: on one or two rows, every other column sits a little lower.
export function cubicleSpot(slot, cols, rows) {
  const lift = rows < 3 ? 0.12 : 0;
  const sx = ((slot % cols) + 0.5) / cols;
  const sy = rows > 1 ? (Math.floor(slot / cols) + ((slot % cols) % 2) * lift) / (rows - 1 + lift) : 0;
  return [sx, sy];
}
