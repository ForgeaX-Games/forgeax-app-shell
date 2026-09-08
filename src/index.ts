import type { ContributionDeclaration } from '@forgeax/extension-contracts';

export type ShellSlot = 'dock' | 'window' | 'panel';

export interface ShellContribution {
  id: string;
  slot: ShellSlot;
  title: string;
  contribution: ContributionDeclaration;
}

export class AppShellRegistry {
  #contributions = new Map<string, ShellContribution>();

  register(contribution: ShellContribution): void {
    if (this.#contributions.has(contribution.id)) {
      throw new Error(`Duplicate shell contribution: ${contribution.id}`);
    }
    this.#contributions.set(contribution.id, contribution);
  }

  list(slot?: ShellSlot): readonly ShellContribution[] {
    const values = [...this.#contributions.values()];
    return slot ? values.filter((item) => item.slot === slot) : values;
  }
}

export function createShellContribution(
  input: Omit<ShellContribution, 'contribution'> & {
    contribution: ContributionDeclaration;
  },
): ShellContribution {
  return { ...input };
}

export type ShellSnapshotPatch<T extends Record<string, unknown>> = {
  readonly [K in keyof T]?: T[K] extends readonly unknown[]
    ? T[K]
    : T[K] extends Record<string, unknown>
      ? Partial<T[K]>
      : T[K];
};

/**
 * Folds ordered shell contributions into an immutable derived snapshot.
 * Object-valued fields merge one level; arrays and scalar values replace the
 * previous value. Undefined fields do not contribute.
 */
export function deriveShellSnapshot<T extends Record<string, unknown>>(
  base: T,
  patches: ReadonlyArray<ShellSnapshotPatch<T>>,
): T {
  const output: Record<string, unknown> = { ...base };

  for (const patch of patches) {
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        output[key] = {
          ...(output[key] as Record<string, unknown> | undefined),
          ...value,
        };
      } else {
        output[key] = value;
      }
    }
  }

  return output as T;
}
