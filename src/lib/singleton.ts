// Process-wide singletons. Next.js may evaluate a module once per route bundle
// (and again on dev hot reload); pinning state to globalThis guarantees every
// route sees the same mirrors, memory and run registry.
const store = ((globalThis as unknown as { __traceon?: Record<string, unknown> }).__traceon ??= {});

export function singleton<T>(key: string, create: () => T): T {
  if (!(key in store)) store[key] = create();
  return store[key] as T;
}
