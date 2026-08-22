/**
 * The redaction seam (NFR-003).
 *
 * No logger implements what the specs require: pino and winston match *keys*,
 * and the requirement is value substitution inside arbitrary strings, so that a
 * vault-sourced fragment of an RPC URL renders as `.../v2/[vault.alchemyKey]`
 * while the rest of the URL stays readable
 * ([design-decisions.md → Vault redaction](../../../../../docs/specs/design-decisions.md#vault-redaction-show-the-reference-never-the-secret)).
 *
 * Nothing is registered here yet — secrets first exist in memory in S3, and the
 * registration call site is the load layer that resolves them. What this module
 * guarantees is that there is exactly **one** place to add to, and that every
 * line leaving either sink has passed through it: redaction is a property of the
 * sink, never of the call site.
 */

interface Registration {
  readonly value: string;
  readonly rendering: string;
}

export class SecretRegistry {
  /** Keyed by value so registering the same credential twice is idempotent. */
  #byValue = new Map<string, string>();

  /** Rebuilt on registration, longest value first — see `redactText`. */
  #ordered: readonly Registration[] = [];

  /**
   * @param value     The resolved credential, exactly as it will appear in memory.
   * @param rendering What appears in its place: `[vault.<name>]` for a
   *                  vault-sourced value, `[redacted: <slot>]` otherwise.
   */
  register(value: string, rendering: string): void {
    // An empty value would match at every index and erase the output; a caller
    // handing one over has a resolution bug, not a redaction need.
    if (value === '') return;

    this.#byValue.set(value, rendering);
    this.#ordered = [...this.#byValue]
      .map(([registered, rendering_]) => ({ value: registered, rendering: rendering_ }))
      .sort((left, right) => right.value.length - left.value.length);
  }

  get size(): number {
    return this.#byValue.size;
  }

  /** Test seam. The registry is process-wide, so a test must be able to reset it. */
  clear(): void {
    this.#byValue.clear();
    this.#ordered = [];
  }

  /**
   * Substitutes every registered value found anywhere in `text`.
   *
   * Longest first, so that a credential which contains a shorter registered
   * value as a substring is replaced as a whole rather than being half-rendered.
   */
  redactText(text: string): string {
    let redacted = text;
    for (const { value, rendering } of this.#ordered) {
      if (redacted.includes(value)) {
        redacted = redacted.replaceAll(value, rendering);
      }
    }
    return redacted;
  }

  /**
   * Walks an already-plain structure — the output of `toPlain` — redacting
   * strings in both value and key position. A credential used as an object key
   * is unlikely and would still be a leak.
   */
  redactPlain(value: unknown): unknown {
    if (this.#ordered.length === 0) return value;
    return this.#walk(value);
  }

  #walk(value: unknown): unknown {
    if (typeof value === 'string') return this.redactText(value);
    if (Array.isArray(value)) return value.map((entry) => this.#walk(entry));

    if (value !== null && typeof value === 'object') {
      const walked: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(value)) {
        walked[this.redactText(key)] = this.#walk(entry);
      }
      return walked;
    }

    return value;
  }
}

/**
 * The process-wide registry. One instance, because a credential resolved by any
 * phase must be invisible to every sink from that moment on.
 */
export const secretRegistry = new SecretRegistry();
