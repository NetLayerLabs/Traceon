# Vendored Meterless engines

These are the official reference implementations from [Meterless/Meterless](https://github.com/Meterless/Meterless), copied unmodified with `degit`:

| Folder | Source |
|---|---|
| `meterless-hmem/` | `engines/hmem/reference` (H-MEM: hierarchical durable memory, trust ledger, dreaming) |
| `meterless-markovian/` | `engines/markovian/reference` (Markovian bounded-state chain) |

Both are licensed under the Apache License 2.0 by their authors. The full licence text is in each folder's `LICENSE`, copied unchanged from upstream (`engines/hmem/LICENSE` and `engines/markovian/LICENSE`); upstream ships no NOTICE file. Traceon uses them through [src/lib/meterless.ts](../src/lib/meterless.ts).

The vendored READMEs link to `../AGENTS.md` and `../examples/`. Those are each engine's spec and examples in the upstream repository ([engines/hmem](https://github.com/Meterless/Meterless/tree/main/engines/hmem), [engines/markovian](https://github.com/Meterless/Meterless/tree/main/engines/markovian)), and were not vendored.
