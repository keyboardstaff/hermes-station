# Hermes Station WebSocket Protocol

> Status: stable.
> Mirror types in [`src/lib/ws-types.ts`](../src/lib/ws-types.ts).

The Station exposes a single WebSocket endpoint at **`/ws`**. Every
frame is JSON `{ "type": "<domain>.<verb>", ... }`. The vocabulary is
closed — unknown `type`s are silently dropped server-side.

## Endpoint

```
GET /ws
  Cookie: hms_session=<token>            # password mode only
  Sec-WebSocket-Protocol: ...
```

- Heartbeat: aiohttp sends a server-side ping every **20s** so a
  backgrounded mobile tab notices a dead socket within ~25s.
- Client-side ping interval: **20s** (`src/store/ws.ts`).
- Auth: same cookie / IP rules as REST. Localhost is trusted; LAN
  requires `hms_session` set by `POST /api/login`.

## Subscriptions

The server fan-outs broadcasts on named channels. A connection must
subscribe to receive frames for a given channel. Channels are flat
strings; the wildcard `*` plus per-domain prefix wildcards (e.g.
`run:*`) are supported.

| Channel | Producer | Frames |
|---|---|---|
| `run:<run_id>` | `server.runs` | `run.event` |
| `approval` | `server.approvals` | `approval.requested` |
| `discovery` | `server.routes.plugins` | `discovery.changed` |
| `lifecycle` | `server.routes.lifecycle` | `lifecycle.changed` |
| `logs:<source>` | (planned) | `log.line` |
| `capabilities` | `server.capabilities` | `capabilities` |
| `*` | — | every frame any subscriber would receive |

## Client → Server

```ts
type ClientMessage =
  | { type: "ws.subscribe";    channel: string; last_seq?: number }
  | { type: "ws.unsubscribe";  channel: string }
  | { type: "ws.ping" }
  | { type: "run.stop";        run_id: string }
  | {
      type: "approval.resolve";
      session_key?: string;   // preferred
      run_id?: string;        // fallback — server resolves to session
      choice: "once" | "session" | "always" | "deny";
    };
```

| Type | Routed via | Handled in |
|---|---|---|
| `ws.subscribe` | inline (`server.ws.drive_connection`) | mutates `WSConnection._subscriptions` |
| `ws.unsubscribe` | inline | mutates subscriptions |
| `ws.ping` | inline | replies `ws.pong` |
| `run.stop` | `ws_dispatch` `@register` | `server.routes.runs._ws_run_stop` |
| `approval.resolve` | `ws_dispatch` `@register` | `server.routes.approvals._ws_approval_resolve` |

## Server → Client

```ts
type ServerMessage =
  | { type: "ws.pong" }
  | { type: "run.event";          run_id: string; event: RunEventKind; /* delta / tool / usage / ... */ }
  | { type: "run.stop.ack";       run_id: string; ok: boolean }
  | { type: "approval.requested"; run_id: string; session_key: string; command: string; description: string; pattern_key: string; pattern_keys?: string[] }
  | { type: "approval.ack";       ok: boolean; run_id?: string; session_key?: string; choice?: string; resolved?: number; error?: string }
  | { type: "discovery.changed";  resource: string; timestamp?: number }
  | { type: "lifecycle.changed";  /* gateway / platform fields */ }
  | { type: "capabilities";       fsReadable: boolean; dashboardReachable: boolean; agentReady: boolean; mode: "ready"|"degraded"; reasons: string[] }
  | { type: "log.line";           channel: string; text: string };
```

### `run.event` sub-kinds

```ts
type RunEventKind =
  | "message.delta"
  | "stream.reset"
  | "reasoning.available"
  | "tool.started"
  | "tool.completed"
  | "run.completed"
  | "run.failed"
  | "run.cancelled";
```

## Adding a new message type

1. Pick a name `<domain>.<verb>`. Keep verbs in present tense for
   client→server (`run.stop`, `approval.resolve`) and past tense for
   server→client (`run.stop.ack`, `run.event`, `discovery.changed`).
2. **Server**: add the handler in the domain's route file and decorate
   with `@register("<your.type>")`:
   ```python
   from server.ws import WSConnection
   from server.ws_dispatch import register

   @register("cron.trigger")
   async def _ws_cron_trigger(conn: WSConnection, payload: dict) -> None:
       ...
   ```
   The decorator runs at import time; make sure
  `server.routes.ws` imports your module (or chain through
   `server.app`'s setup) so the handler lands in the registry before
   the first connection arrives.
3. **Client**: append the type to `ClientMessage` / `ServerMessage` in
   `src/lib/ws-types.ts` and send/listen through `useWSStore`.
4. **Docs**: add a row to the tables above.
5. **Tests**: cover the round-trip in
   `tests/unit/test_ws_dispatch.py` (or a domain-specific test).

## Compatibility

This protocol uses namespaced verbs only: there is no `subscribe` / `stop` /
`ping` / `pong` / `stop.ack` legacy alias. Old clients will see
their messages silently dropped (server) or fail typing (client).
The open-source dev branch is the only supported consumer; no migration
path is provided.
