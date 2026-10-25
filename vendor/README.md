# Vendored Meterless engines

These are the official reference implementations from [Meterless/Meterless](https://github.com/Meterless/Meterless), copied unmodified with `degit`:

| Folder | Source |
|---|---|
| `meterless-hmem/` | `engines/hmem/reference` (H-MEM: hierarchical durable memory, trust ledger, dreaming) |
| `meterless-markovian/` | `engines/markovian/reference` (Markovian bounded-state chain) |

Both are licensed under the Apache License 2.0 by their authors; see the upstream repository for the full licence text. Traceon uses them through [src/lib/meterless.ts](../src/lib/meterless.ts).
