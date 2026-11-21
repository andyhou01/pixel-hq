#!/usr/bin/env python3
"""Office layouts: arrange.py rebuilds a tab's split tree for each preset."""
import copy
import importlib.util
import os

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("arrange", os.path.join(HERE, "..", "mods", "company-layouts", "arrange.py"))
arrange = importlib.util.module_from_spec(spec)
spec.loader.exec_module(arrange)

TAB = "tb1"


def block(name):
    return {"type": "block", "id": f"p-{name}", "content": {"terminal": name}}


def leaves(node):
    if node["type"] == "block":
        return [node["content"]["terminal"]]
    return [t for child in node["children"] for t in leaves(child)]


def shape(node):
    if node["type"] == "block":
        return node["content"]["terminal"]
    return {node["type"]: [shape(c) for c in node["children"]]}


def test_reading_order_follows_the_screen():
    # A grid built as columns (a,c | b,d) still reads a, b, c, d.
    root = {"type": "row", "id": TAB, "children": [
        {"type": "column", "id": "s1", "children": [block("a"), block("c")]},
        {"type": "column", "id": "s2", "children": [block("b"), block("d")]},
    ]}
    assert [b["content"]["terminal"] for b in arrange.blocks_in_reading_order(root)] == ["a", "b", "c", "d"]


def test_presets():
    five = [block(x) for x in "abcde"]
    cases = {
        "cubicles": {"row": [{"column": [{"row": ["a", "b", "c"]}, {"row": ["d", "e"]}]}]},
        "open-plan": {"row": ["a", "b", "c", "d", "e"]},
        "standup": {"row": [{"column": ["a", "b", "c", "d", "e"]}]},
        "corner-office": {"row": ["a", {"column": ["b", "c", "d", "e"]}]},
        "boardroom": {"row": [{"column": ["a", {"row": ["b", "c", "d", "e"]}]}]},
    }
    for preset, want in cases.items():
        root = arrange.build(preset, five, TAB)
        assert root["id"] == TAB and root["type"] == "row", preset
        assert shape(root) == want, (preset, shape(root))
    corner = arrange.build("corner-office", five, TAB)
    assert [c["size"]["weight"] for c in corner["children"]] == [0.6, 0.4]
    # A 2x2 grid for four desks, and one desk is just the desk.
    assert shape(arrange.build("cubicles", five[:4], TAB)) == {"row": [{"column": [{"row": ["a", "b"]}, {"row": ["c", "d"]}]}]}
    assert shape(arrange.build("boardroom", five[:1], TAB)) == {"row": ["a"]}


def test_seated_desks_stay_put_and_newcomers_sit_last():
    blocks = [block(x) for x in "abcd"]  # as read on screen
    ordered = arrange.order_blocks(blocks, ["p-c", "p-gone", "p-a"], None)
    assert [b["id"] for b in ordered] == ["p-a", "p-c", "p-b", "p-d"]
    led = arrange.order_blocks(blocks, ["p-c", "p-a"], "p-d")
    assert [b["id"] for b in led] == ["p-d", "p-a", "p-c", "p-b"]


def test_arrange_rewrites_only_that_tab():
    other = {"id": "tb2", "root": {"type": "row", "id": "tb2", "children": [block("x")]}}
    doc = {"spaces": [{"id": "sp", "tabs": [
        {"id": TAB, "root": {"type": "row", "id": TAB, "children": [block(x) for x in "abcd"]}},
        copy.deepcopy(other),
    ]}]}
    order = arrange.arrange(doc, TAB, "cubicles")
    assert order == ["p-a", "p-b", "p-c", "p-d"]
    tab, untouched = doc["spaces"][0]["tabs"]
    assert leaves(tab["root"]) == ["a", "b", "c", "d"]
    assert untouched == other
    for bad, args in ((LookupError, ("tb-missing", "cubicles")), (ValueError, (TAB, "penthouse"))):
        try:
            arrange.arrange(doc, *args)
        except bad:
            continue
        raise AssertionError(f"{args} should raise {bad.__name__}")


if __name__ == "__main__":
    print("=== Testing Office Layouts (arrange.py) ===")
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print(f"PASS: {name}")
