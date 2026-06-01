"""Analytics endpoints that need direct state.db access (not exposed by dashboard proxy)."""

from __future__ import annotations

import logging
import time

from aiohttp import web

from server.lib.state_db import db, run_db

logger = logging.getLogger(__name__)


async def _get_sources(request: web.Request) -> web.Response:
    """GET /api/analytics/sources — sessions + token totals grouped by source platform."""
    try:
        days = int(request.query.get("days", "30"))
    except (ValueError, TypeError):
        days = 30
    days = max(1, min(days, 365))

    try:
        sdb = db()
        cutoff = time.time() - days * 86400

        def _query():
            cur = sdb._conn.execute(
                """
                SELECT COALESCE(source, 'unknown') AS source,
                       COUNT(*)                     AS sessions,
                       SUM(COALESCE(input_tokens, 0)
                           + COALESCE(output_tokens, 0)) AS total_tokens
                FROM sessions
                WHERE started_at > ?
                GROUP BY source
                ORDER BY sessions DESC
                """,
                (cutoff,),
            )
            return [dict(r) for r in cur.fetchall()]

        rows = await run_db(_query)
    except Exception as exc:
        logger.warning("[hms.analytics] sources query failed: %s", exc)
        return web.json_response(
            {"sources": [], "period_days": days, "error": "db_unavailable"},
            status=200,
        )

    return web.json_response({"sources": rows, "period_days": days})


def attach(app: web.Application) -> None:
    app.router.add_get("/api/analytics/sources", _get_sources)


__all__ = ["attach"]
