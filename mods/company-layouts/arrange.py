#!/usr/bin/env python3
"""Office layouts: re-arrange one tab's panes into a preset.

Herdr keeps every tab's split tree in herdr-core's "herdr-app" document
(spaces > tabs > root: a "row" with the tab's id; "row"/"column" splits with
"s…" ids; "block" panes with a terminal or mod). There is no command that
moves an existing pane into a new split, so this reads that document,
rebuilds the tab's tree around the same pane blocks (same ids, so nothing
restarts) and writes it back only if nobody changed it meanwhile.

Prints {"ok": true, "order": [...]} or {"error": "..."} and exits 1.
"""

import json
import math
import os
import shutil
import subprocess
import sys
import uuid

USAGE = "arrange.py <tab> <preset> [--order seated1,seated2,...] [--lead pane] [--on machine]"
PRESETS = ("cubicles", "open-plan", "standup", "corner-office", "boardroom")
LEAD_SHARE = 0.6


def _weights(children):
    raw = [((c.get("size") or {}).get("weight")) for c in children]
    known = [w for w in raw if isinstance(w, (int, float)) and w > 0]
    fill = sum(known) / len(known) if known else 1.0
    ws = [w if isinstance(w, (int, float)) and w > 0 else fill for w in raw]
    total = sum(ws) or 1.0
    return [w / total for w in ws]


def blocks_in_reading_order(root):
    """Every pane block, top to bottom, then left to right, as laid out on screen."""
    found = []

    def walk(node, x, y, w, h):
        if node.get("type") == "block":
            found.append((round(y, 4), round(x, 4), node))
            return
        kids = node.get("children") or []
        across = node.get("type") == "row"
        at = 0.0
        for kid, share in zip(kids, _weights(kids)):
            if across:
                walk(kid, x + at * w, y, share * w, h)
            else:
                walk(kid, x, y + at * h, w, share * h)
            at += share

    walk(root, 0.0, 0.0, 1.0, 1.0)
    found.sort(key=lambda f: (f[0], f[1]))
    return [f[2] for f in found]


def order_blocks(blocks, known=None, lead=None):
    """`blocks` in reading order. Panes already seated (`known`) keep their places on
    screen, so a swap by hand sticks; newcomers take the last seats. The lead goes first."""
    seated = set(known or [])
    ordered = [b for b in blocks if b["id"] in seated] + [b for b in blocks if b["id"] not in seated]
    if lead in {b["id"] for b in blocks}:
        ordered = [b for b in ordered if b["id"] == lead] + [b for b in ordered if b["id"] != lead]
    return ordered


def _size(children, weights):
    for child in children:
        child.pop("size", None)
    if weights:
        total = sum(weights)
        for child, w in zip(children, weights):
            child["size"] = {"weight": w / total}


def _split(kind, children, weights=None):
    _size(children, weights)
    return {"type": kind, "id": "s" + uuid.uuid4().hex, "children": children}


def build(preset, blocks, tab_id):
    """The tab's new root for `preset`: always a row with the tab's id, as Herdr writes it."""
    if preset not in PRESETS:
        raise ValueError(f"unknown layout {preset!r}")
    panes = [dict(b) for b in blocks]
    n = len(panes)
    if n == 0:
        raise ValueError("this tab has no panes")

    def root(children, weights=None):
        _size(children, weights)
        return {"type": "row", "id": tab_id, "children": children}

    if n == 1 or preset == "open-plan":
        return root(panes)
    if preset == "standup":
        return root([_split("column", panes)])
    if preset == "cubicles":
        cols = math.ceil(math.sqrt(n))
        rows = [panes[i:i + cols] for i in range(0, n, cols)]
        lines = [r[0] if len(r) == 1 else _split("row", r) for r in rows]
        return root([_split("column", lines)])
    lead, team = panes[0], panes[1:]
    if preset == "corner-office":
        side = team[0] if len(team) == 1 else _split("column", team)
        return root([lead, side], [LEAD_SHARE, 1 - LEAD_SHARE])
    bench = team[0] if len(team) == 1 else _split("row", team)
    return root([_split("column", [lead, bench], [LEAD_SHARE, 1 - LEAD_SHARE])])


def arrange(doc, tab_id, preset, order=None, lead=None):
    """Rewrites `doc` in place; returns the panes' new order."""
    for space in doc.get("spaces") or []:
        for tab in space.get("tabs") or []:
            if tab.get("id") == tab_id:
                blocks = order_blocks(blocks_in_reading_order(tab["root"]), order, lead)
                tab["root"] = build(preset, blocks, tab_id)
                return [b["id"] for b in blocks]
    raise LookupError("that tab is gone")


def _hc():
    found = os.environ.get("HC_BIN") or shutil.which("hc")
    if found:
        return found
    for guess in ("~/.local/bin/hc", "/opt/homebrew/bin/hc", "/usr/local/bin/hc"):
        path = os.path.expanduser(guess)
        if os.path.exists(path):
            return path
    raise RuntimeError("hc (herdr-core) is not on PATH")


def _rpc(method, params):
    line = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}) + "\n"
    done = subprocess.run([_hc(), "connect"], input=line, capture_output=True, text=True, timeout=15)
    for out in done.stdout.splitlines():
        if out.strip():
            reply = json.loads(out)
            if "error" in reply:
                err = reply["error"]
                raise RuntimeError((err.get("data") or {}).get("kind") or err.get("message"))
            return reply["result"]
    raise RuntimeError(done.stderr.strip() or "no reply from herdr-core")


def main(argv):
    if len(argv) < 2:
        raise ValueError(USAGE)
    tab_id, preset, opts, rest = argv[0], argv[1], {}, argv[2:]
    while rest:
        opts[rest[0].lstrip("-")] = rest[1] if len(rest) > 1 else ""
        rest = rest[2:]
    order = [p for p in opts.get("order", "").split(",") if p]
    where = {"on": opts["on"]} if opts.get("on") else {}
    for _ in range(5):
        got = _rpc("doc.get", {"name": "herdr-app", **where})
        doc = got["value"]
        new_order = arrange(doc, tab_id, preset, order, opts.get("lead") or None)
        try:
            _rpc("doc.set", {"name": "herdr-app", "value": doc, "version": got["version"], **where})
        except RuntimeError as err:
            if str(err) == "conflict":
                continue
            raise
        return {"ok": True, "order": new_order}
    raise RuntimeError("the layout kept changing; try again")


if __name__ == "__main__":
    try:
        print(json.dumps(main(sys.argv[1:])))
    except Exception as err:  # reported to the mod as one line
        print(json.dumps({"error": str(err) or type(err).__name__}))
        sys.exit(1)
