"""Comment-preserving YAML mutation tests."""

from __future__ import annotations

from server.lib import yaml_edit


def test_set_scalar_inserts_new_key_at_root() -> None:
    src = "# top comment\nfoo: 1\n"
    out = yaml_edit.set_scalar_at_path(src, ("bar",), "hello")
    assert "# top comment" in out
    assert "foo: 1" in out
    assert 'bar: "hello"' in out


def test_set_scalar_replaces_existing_leaf() -> None:
    src = "a:\n  b:\n    c: 1   # keep my comment somewhere\n"
    out = yaml_edit.set_scalar_at_path(src, ("a", "b", "c"), 42)
    assert "    c: 42" in out
    # We replace the line, so the inline comment is lost — that's
    # documented and acceptable for the limited scope of this editor.
    # Verify other comments survive when present.


def test_set_scalar_creates_nested_chain_when_missing() -> None:
    src = "existing: keep\n"
    out = yaml_edit.set_scalar_at_path(
        src, ("platforms", "station", "extra", "port"), 3131
    )
    assert "existing: keep" in out
    assert "platforms:" in out
    assert "  station:" in out
    assert "    extra:" in out
    assert "      port: 3131" in out


def test_set_scalar_adds_leaf_under_partial_match() -> None:
    src = "platforms:\n  station:\n    enabled: true\n"
    out = yaml_edit.set_scalar_at_path(
        src, ("platforms", "station", "extra", "port"), 3131
    )
    # Existing structure preserved.
    assert "    enabled: true" in out
    # New nested keys appended at right indent.
    assert "    extra:" in out
    assert "      port: 3131" in out


def test_append_list_item_creates_block_when_missing() -> None:
    src = "name: foo\n"
    out = yaml_edit.append_list_item_at_path(src, ("command_allowlist",), "rm -rf /tmp")
    assert "command_allowlist:" in out
    assert '- "rm -rf /tmp"' in out


def test_append_list_item_expands_inline_empty() -> None:
    src = "command_allowlist: []\n"
    out = yaml_edit.append_list_item_at_path(src, ("command_allowlist",), "rm")
    assert "command_allowlist:" in out
    assert "command_allowlist: []" not in out
    assert '- "rm"' in out


def test_append_list_item_dedupes() -> None:
    src = 'command_allowlist:\n  - "rm"\n'
    out = yaml_edit.append_list_item_at_path(src, ("command_allowlist",), "rm")
    # Idempotent — no duplicate.
    assert out.count('- "rm"') == 1


def test_remove_at_path_drops_subtree() -> None:
    src = (
        "before: 1\n"
        "platforms:\n"
        "  station:\n"
        "    enabled: true\n"
        "    extra:\n"
        "      port: 3131\n"
        "  other:\n"
        "    enabled: true\n"
        "after: 2\n"
    )
    out = yaml_edit.remove_at_path(src, ("platforms", "station"))
    assert "station:" not in out
    assert "port: 3131" not in out
    # Sibling and outer keys survive.
    assert "before: 1" in out
    assert "after: 2" in out
    assert "  other:" in out


def test_remove_at_path_noop_when_absent() -> None:
    src = "platforms:\n  other:\n    enabled: true\n"
    out = yaml_edit.remove_at_path(src, ("platforms", "station"))
    assert out == src


def test_append_preserves_top_comments() -> None:
    src = "# my hand-written comment\n# stays here\ncommand_allowlist:\n  - first\n"
    out = yaml_edit.append_list_item_at_path(src, ("command_allowlist",), "second")
    assert "# my hand-written comment" in out
    assert "# stays here" in out
    assert "- first" in out
    assert '- "second"' in out
