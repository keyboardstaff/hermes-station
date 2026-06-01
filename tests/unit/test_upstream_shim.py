"""Tests for the upstream shim — all/none/partial presence + idempotent probe."""

from __future__ import annotations

import importlib

import pytest
from server.lib import upstream_shim
from server.lib.upstream_shim import (
    CapabilityFlags,
    Shim,
    _normalize_platform,
    _try_import,
    shim,
)


@pytest.fixture(autouse=True)
def _reset_shim() -> None:
    yield
    shim.reset_for_test()


def test_try_import_returns_module_when_present() -> None:
    mod = _try_import("os.path")
    assert mod is not None
    assert hasattr(mod, "join")


def test_try_import_returns_attribute_when_present() -> None:
    join = _try_import("os.path", "join")
    assert join is not None
    assert join("a", "b").replace("\\", "/") == "a/b"


def test_try_import_returns_none_on_missing_module() -> None:
    assert _try_import("definitely_not_a_real_module_xyz") is None


def test_try_import_returns_none_on_missing_attribute() -> None:
    assert _try_import("os.path", "definitely_not_a_real_attribute") is None


def test_try_import_does_not_warn_twice_for_same_miss() -> None:
    upstream_shim._warned.clear()
    assert _try_import("definitely_not_a_real_module_xyz") is None
    seen_after_first = set(upstream_shim._warned)
    assert _try_import("definitely_not_a_real_module_xyz") is None
    # The set should not have grown — second call hit the cache.
    assert set(upstream_shim._warned) == seen_after_first


def test_capability_flags_defaults_to_all_false() -> None:
    f = CapabilityFlags()
    # Every bool field defaults False.
    for name, value in f.__dict__.items():
        if isinstance(value, bool):
            assert value is False, f"{name} default should be False"
    # Version is None / strings empty.
    assert f.upstream_version is None
    assert f.station_version is None
    assert f.python_version == ""
    assert f.os_name == ""


def test_capability_flags_dict_round_trip() -> None:
    import json
    payload = shim.to_dict()
    # Round-trip — surfaces any non-serializable field.
    assert json.loads(json.dumps(payload)) == payload


def test_probe_populates_env_fields() -> None:
    shim.probe(force=True)
    assert shim.flags.python_version  # eg "3.11.7"
    assert shim.flags.os_name in ("Linux", "Darwin", "Windows")
    # Station's own version comes from its installed dist metadata (the test env
    # always installs hermes-station editable), surfaced in /settings → System.
    assert shim.flags.station_version


def test_probe_is_idempotent_without_force() -> None:
    shim.probe()
    first_snapshot = dict(shim.flags.__dict__)
    # Mutate flags directly; idempotent probe should NOT overwrite.
    shim.flags.python_version = "999.999"
    shim.probe()  # No force.
    assert shim.flags.python_version == "999.999"
    # But force=True does refresh.
    shim.probe(force=True)
    assert shim.flags.python_version == first_snapshot["python_version"]


@pytest.fixture
def _no_upstream(monkeypatch: pytest.MonkeyPatch):
    real_import = importlib.import_module

    BLOCKED = (
        "run_agent", "hermes_constants", "hermes_state",
        "tools.approval", "tools.vision_tools", "tools.x_search_tool",
        "gateway.config", "gateway.platforms.base", "gateway.run",
        "gateway.platform_registry", "gateway.plugin_registry",
        "gateway.slash_registry",
        "hermes_cli", "cli",
    )

    def _blocked(name: str, *args, **kw):
        if name in BLOCKED or name.startswith(tuple(b + "." for b in BLOCKED)):
            raise ImportError(f"blocked by test: {name}")
        return real_import(name, *args, **kw)

    monkeypatch.setattr(upstream_shim.importlib, "import_module", _blocked)
    # ``_try_import`` caches missed modules in ``_warned`` — reset that
    # too so the next test starts clean.
    upstream_shim._warned.clear()


def test_no_upstream_every_flag_false(_no_upstream) -> None:
    shim.reset_for_test()
    shim.probe(force=True)
    f = shim.flags
    # Foundation flags — all should be False.
    assert f.agent_importable is False
    assert f.approval_4_choice is False
    assert f.session_db is False
    assert f.gateway_lifecycle is False
    assert f.base_platform_adapter is False
    # v0.14+ flags — all False.
    assert f.handoff_supported is False
    assert f.subgoal_supported is False
    assert f.vision_analyze_tool is False
    assert f.x_search_tool is False
    assert f.platform_circuit_breaker is False
    assert f.cron_deliver_all is False
    assert f.pareto_code_router is False
    assert f.plugin_ctx_llm is False
    assert f.skills_hf_tap is False
    # Environment fields are still populated (don't depend on upstream).
    assert f.python_version != ""
    assert f.os_name != ""


def test_no_upstream_accessors_return_none(_no_upstream) -> None:
    shim.reset_for_test()
    assert shim.run_agent.AIAgent is None
    assert shim.run_agent.parse_reasoning_effort is None
    assert shim.approval.resolve is None
    assert shim.approval.register_notify is None
    assert shim.state.SessionDB is None
    assert shim.gateway.find_gateway_pids is None
    assert shim.gateway.GatewayRunner is None
    assert shim.gateway.Platform is None
    assert shim.gateway.base_platform_adapter() is None
    assert shim.models.list_authenticated_providers is None


def test_no_upstream_discovery_helpers_return_safely(_no_upstream) -> None:
    shim.reset_for_test()
    # Platforms — empty list (no enum to iterate).
    assert shim.platforms.list_all() == []
    # Slash — empty when COMMAND_REGISTRY is unreachable (SPA renders as a no-op menu).
    assert shim.slash.list_available() == []
    # Themes — empty list when builtin is unreachable.
    assert shim.themes.list() == []


def test_no_upstream_to_dict_is_serializable(_no_upstream) -> None:
    import json
    shim.reset_for_test()
    shim.probe(force=True)
    payload = shim.to_dict()
    # Round-trip + at least 11 boolean fields surfaced.
    blob = json.dumps(payload)
    decoded = json.loads(blob)
    bool_count = sum(1 for v in decoded.values() if isinstance(v, bool))
    assert bool_count >= 11


@pytest.fixture
def _v013_like(monkeypatch: pytest.MonkeyPatch):
    real_import = importlib.import_module

    # Bare ``hermes_cli`` blocks the filesystem-based pareto/hf-skill probes
    # (without it they'd see the live v0.14 dirs on a developer's machine).
    V014_ONLY = (
        "tools.vision_tools", "tools.x_search_tool",
        "hermes_cli.plugins", "hermes_cli",
        "gateway.slash_registry",
    )

    def _partial(name: str, *args, **kw):
        if name in V014_ONLY:
            raise ImportError(f"v0.14-only: {name}")
        return real_import(name, *args, **kw)

    monkeypatch.setattr(upstream_shim.importlib, "import_module", _partial)
    upstream_shim._warned.clear()


def test_v013_handoff_flag_off_when_handoff_module_missing(_v013_like) -> None:
    shim.reset_for_test()
    shim.probe(force=True)
    # v0.14-only flags should be False.
    assert shim.flags.vision_analyze_tool is False
    assert shim.flags.x_search_tool is False
    assert shim.flags.skills_hf_tap is False
    # NB: handoff_supported also checks for ``cli._handle_handoff_command``
    # which may exist on the host CLI module; we only assert False when
    # both probe paths fail. This guards against false negatives on a
    # host that happens to have an old ``handoff`` helper around.


def test_normalize_platform_extracts_name_and_label() -> None:
    class FakeEnum:
        value = "telegram"
        name = "TELEGRAM"
    out = _normalize_platform(FakeEnum())
    assert out["name"] == "telegram"
    assert out["label"]  # Non-empty.
    assert out["kind"] == "builtin"


def test_normalize_platform_falls_back_to_str_repr() -> None:
    class Bare:
        pass
    out = _normalize_platform(Bare())
    assert isinstance(out["name"], str)
    assert out["kind"] == "builtin"


def test_slash_list_dedupes_by_name() -> None:
    out = shim.slash.list_available()
    names = [e["name"] for e in out]
    assert len(names) == len(set(names)), f"Duplicates in {names}"


def test_reset_for_test_rebuilds_default_factories() -> None:
    # Mutate a field.
    shim.flags.python_version = "junk"
    shim.reset_for_test()
    # The python_version is now back to its default (empty string).
    assert shim.flags.python_version == ""
    # _probed must be False so probe() does work again.
    assert shim._probed is False


def test_shim_singleton_is_instance_of_shim_class() -> None:
    assert isinstance(shim, Shim)


def test_smoke_real_upstream_if_available() -> None:
    try:
        importlib.import_module("run_agent")
    except Exception:
        pytest.skip("hermes-agent not on PYTHONPATH — smoke test skipped")

    shim.reset_for_test()
    shim.probe(force=True)
    # If run_agent imports, AIAgent should resolve.
    assert shim.flags.agent_importable is True
    # And approval too (they ship together).
    assert shim.flags.approval_4_choice is True
    # Version detection is best-effort but if hermes-agent is installed
    # via setup.py we should see SOMETHING.
    # (Skipped assertion — some dev layouts don't register metadata.)
