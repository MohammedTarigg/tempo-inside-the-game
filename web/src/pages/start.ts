// Every page starts the same way: build, and if anything fails, say so on the page instead of leaving it blank.
import { fail } from '../shared/util.ts';

export function start(build: () => Promise<unknown>) {
  build().catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)));
}
