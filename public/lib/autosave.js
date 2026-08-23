/* ============================================================
 * Genograph — autosave generation coordinator (pure: no DOM)
 *
 * A completed older write must never mark a newer edit as saved. Writes are
 * serialized and failures leave the current revision dirty.
 * ============================================================ */
'use strict';

export class SaveCoordinator {
  #revision = 0;
  #savedRevision = 0;
  #tail = Promise.resolve();

  get dirty() { return this.#savedRevision < this.#revision; }
  get revision() { return this.#revision; }

  reset() {
    this.#revision = 0;
    this.#savedRevision = 0;
    this.#tail = Promise.resolve();
  }

  markDirty() { return ++this.#revision; }

  async save(write) {
    const revision = this.#revision;
    if (revision <= this.#savedRevision) return { ok: true, dirty: false, revision };
    const run = this.#tail.catch(() => {}).then(() => write(revision));
    this.#tail = run;
    try {
      const value = await run;
      this.#savedRevision = Math.max(this.#savedRevision, revision);
      return { ok: true, dirty: this.dirty, revision, value };
    } catch (error) {
      return { ok: false, dirty: true, revision, error };
    }
  }
}
