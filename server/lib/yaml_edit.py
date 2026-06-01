"""Comment-preserving YAML mutation on raw text.

PyYAML's safe_dump discards comments/anchors/ordering — unsuitable for editing
~/.hermes/config.yaml. Supports set_scalar_at_path, remove_at_path, append_list_item_at_path.
"""

from __future__ import annotations

import json
import os
from collections.abc import Sequence
from pathlib import Path


def _split_key_value(line: str) -> tuple[int, str, str] | None:
    stripped = line.lstrip(" ")
    if not stripped or stripped.startswith("#") or stripped.startswith("-"):
        return None
    if ":" not in stripped:
        return None
    indent = len(line) - len(stripped)
    head, _, tail = stripped.partition(":")
    head = head.rstrip()
    if not head or any(c in head for c in (" ", "\t", "[", "{")):
        return None
    return indent, head, tail.strip()


def _line_indent(line: str) -> int:
    return len(line) - len(line.lstrip(" "))


def _child_indent_step(lines: list[str], parent_idx: int, parent_indent: int) -> int:
    """Scans forward for the actual indent step under parent; falls back to 2."""
    for j in range(parent_idx + 1, min(parent_idx + 30, len(lines))):
        stripped = lines[j].lstrip(" ")
        if not stripped or stripped.startswith("#"):
            continue
        child_indent = len(lines[j]) - len(stripped)
        if child_indent > parent_indent:
            return child_indent - parent_indent
        break
    return 2


def _detect_file_indent_step(lines: list[str]) -> int:
    for line in lines:
        stripped = line.lstrip(" ")
        if not stripped or stripped.startswith("#") or stripped.startswith("-"):
            continue
        ind = len(line) - len(stripped)
        if 0 < ind <= 8:
            return ind
    return 2


def _find_path(lines: list[str], path: Sequence[str]) -> tuple[int, int]:
    """Walk *path*; returns (deepest_match_idx, matched_depth)."""
    depth = 0
    expect_indent = 0
    deepest_idx = -1
    parent_indents: list[int] = []
    i = 0
    while i < len(lines):
        parsed = _split_key_value(lines[i])
        if parsed is None:
            i += 1
            continue
        indent, key, _ = parsed
        # Out of parent's scope — stop so we never match a sibling section's same key.
        if depth > 0 and indent <= parent_indents[-1]:
            break
        if depth < len(path) and indent == expect_indent and key == path[depth]:
            deepest_idx = i
            parent_indents.append(indent)
            depth += 1
            if depth == len(path):
                return deepest_idx, depth
            expect_indent = indent + _child_indent_step(lines, i, indent)
        i += 1
    return deepest_idx, depth


def _scope_end_index(lines: list[str], start_idx: int, scope_indent: int) -> int:
    i = start_idx + 1
    last = start_idx + 1
    while i < len(lines):
        stripped = lines[i].lstrip(" ")
        if not stripped or stripped.startswith("#"):
            i += 1
            continue
        cur_indent = _line_indent(lines[i])
        if cur_indent >= scope_indent:
            last = i + 1
            i += 1
            continue
        break
    return last


def _format_scalar(value: object) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if value is None:
        return "null"
    if isinstance(value, (int, float)):
        return str(value)
    return json.dumps(str(value), ensure_ascii=False)


def _format_list(values: Sequence[object], indent: int) -> str:
    if not values:
        return "[]"
    prefix = " " * indent
    return "\n" + "\n".join(f"{prefix}- {_format_scalar(v)}" for v in values)


def _emit_path_block(
    path: Sequence[str], value: object, indent: int, step: int = 2
) -> str:
    out_lines: list[str] = []
    for i, key in enumerate(path):
        cur_indent = indent + i * step
        if i == len(path) - 1:
            if isinstance(value, (list, tuple)):
                rendered = _format_list(value, cur_indent + step)
                if rendered == "[]":
                    out_lines.append(f"{' ' * cur_indent}{key}: []")
                else:
                    out_lines.append(f"{' ' * cur_indent}{key}:{rendered}")
            else:
                out_lines.append(f"{' ' * cur_indent}{key}: {_format_scalar(value)}")
        else:
            out_lines.append(f"{' ' * cur_indent}{key}:")
    return "\n".join(out_lines) + "\n"


def _walk_list_items(
    lines: list[str], parent_idx: int, parent_indent: int
) -> tuple[list[str], int | None, int]:
    item_indent: int | None = None
    last_item_idx = parent_idx
    raw_items: list[str] = []
    i = parent_idx + 1
    while i < len(lines):
        line = lines[i]
        stripped = line.lstrip(" ")
        if not stripped or stripped.startswith("#"):
            i += 1
            continue
        cur_indent = _line_indent(line)
        if cur_indent <= parent_indent:
            break
        if stripped.startswith("- "):
            if item_indent is None:
                item_indent = cur_indent
            if cur_indent == item_indent:
                last_item_idx = i
                raw_items.append(stripped[2:].strip())
        i += 1
    return raw_items, item_indent, last_item_idx


def set_scalar_at_path(src: str, path: Sequence[str], value: object) -> str:
    """Set a.b.c: <value>; replaces existing leaf or inserts under right indent."""
    if not path:
        raise ValueError("path must be non-empty")
    lines = src.splitlines()
    deepest_idx, depth = _find_path(lines, path)

    if depth == len(path) and deepest_idx >= 0:
        cur_indent = _line_indent(lines[deepest_idx])
        lines[deepest_idx] = f"{' ' * cur_indent}{path[-1]}: {_format_scalar(value)}"
        out = "\n".join(lines)
        return out + ("\n" if src.endswith("\n") else "")

    if depth == 0:
        step = _detect_file_indent_step(lines)
        block = _emit_path_block(path, value, indent=0, step=step)
        if src and not src.endswith("\n"):
            src += "\n"
        return src + block

    # Partial match: append the remaining path under the deepest matched key.
    parent_indent = _line_indent(lines[deepest_idx])
    step = _child_indent_step(lines, deepest_idx, parent_indent)
    base_indent = parent_indent + step
    insert_at = _scope_end_index(lines, deepest_idx, base_indent)
    block = _emit_path_block(path[depth:], value, indent=base_indent, step=step)
    lines = lines[:insert_at] + block.rstrip("\n").splitlines() + lines[insert_at:]
    out = "\n".join(lines)
    return out + ("\n" if src.endswith("\n") else "")


def remove_at_path(src: str, path: Sequence[str]) -> str:
    """No-op when *path* is absent; drops inner comments, preserves outer."""
    if not path:
        raise ValueError("path must be non-empty")
    lines = src.splitlines()
    deepest_idx, depth = _find_path(lines, path)
    if depth < len(path) or deepest_idx < 0:
        return src

    leaf_indent = _line_indent(lines[deepest_idx])
    end_idx = _scope_end_index(lines, deepest_idx, leaf_indent + 2)
    new_lines = lines[:deepest_idx] + lines[end_idx:]
    out = "\n".join(new_lines)
    return out + ("\n" if src.endswith("\n") else "")


def append_list_item_at_path(
    src: str, path: Sequence[str], value: object, *, dedupe: bool = True
) -> str:
    """Append to YAML list; handles missing key, inline [], existing multi-line form."""
    if not path:
        raise ValueError("path must be non-empty")
    lines = src.splitlines()
    deepest_idx, depth = _find_path(lines, path)

    if depth < len(path) or deepest_idx < 0:
        return set_scalar_at_path(src, path, [value])

    leaf_idx = deepest_idx
    leaf_line = lines[leaf_idx]
    leaf_indent = _line_indent(leaf_line)
    parsed = _split_key_value(leaf_line) or (leaf_indent, path[-1], "")
    inline = parsed[2]

    raw_items, item_indent, last_item_idx = _walk_list_items(
        lines, leaf_idx, leaf_indent
    )

    candidate = _format_scalar(value)

    if raw_items:
        if dedupe:
            for existing in raw_items:
                if existing == candidate:
                    return src
                if isinstance(value, str) and existing == value:
                    return src
        use_indent = item_indent if item_indent is not None else leaf_indent + 2
        lines.insert(last_item_idx + 1, f"{' ' * use_indent}- {candidate}")
        out = "\n".join(lines)
        return out + ("\n" if src.endswith("\n") else "")

    if inline in ("", "[]", "[ ]"):
        item_step = _child_indent_step(lines, leaf_idx, leaf_indent)
        lines[leaf_idx] = f"{' ' * leaf_indent}{path[-1]}:"
        lines.insert(leaf_idx + 1, f"{' ' * (leaf_indent + item_step)}- {candidate}")
        out = "\n".join(lines)
        return out + ("\n" if src.endswith("\n") else "")

    # Scalar where a list was expected — refuse to clobber.
    raise ValueError(
        f"append_list_item_at_path: '{'.'.join(path)}' exists as a scalar, "
        f"refusing to overwrite. Current value: {inline!r}"
    )


def write_text_atomic(path: Path, content: str, *, mode: int = 0o600) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + f".tmp.{os.getpid()}")
    tmp.write_text(content, encoding="utf-8")
    os.replace(tmp, path)
    try:
        os.chmod(path, mode)
    except OSError:
        pass
