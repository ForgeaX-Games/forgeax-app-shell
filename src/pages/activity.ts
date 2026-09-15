import type { QualifiedActivityId } from "@forgeax/types/page";
import type { CommandsRegistry } from "@forgeax/extension-platform/platform";
import type { ContributionRegistry } from "@forgeax/extension-platform/platform";
import type {
	ActivityRegistry,
	PagePlatformContribution,
	PagePort,
} from "./types";

// Rail sort layers (§ActivityRegistration.sourceLayer). Lower rank ⇒ earlier;
// builtin core nav always precedes plugins, which caps any plugin `order`.
const LAYER_RANK: Record<string, number> = {
	builtin: 0,
	project: 1,
	installed: 2,
	user: 3,
};
// Keep unspecified order in the middle of its layer, leaving room on both sides.
const ORDER_BASE = 1000;
// Absent / unknown layer ⇒ treated as installed (rank 2), so it sits with
// plugins below builtin. Literal fallback keeps the return a plain `number`
// under noUncheckedIndexedAccess.
const layerRank = (layer?: string): number =>
	LAYER_RANK[layer ?? "installed"] ?? 2;

export function createActivityRegistry(
	contributions: ContributionRegistry<PagePlatformContribution>,
	pages: PagePort,
	commands: CommandsRegistry,
): ActivityRegistry {
	let cache:
		| {
				readonly version: number;
				readonly snapshot: ReturnType<ActivityRegistry["getSnapshot"]>;
		  }
		| undefined;

	const derive = (): ReturnType<ActivityRegistry["getSnapshot"]> => {
		const version = contributions.version();
		if (cache?.version === version) return cache.snapshot;

		const activities = contributions
			.entries()
			.flatMap(({ owner, item }) =>
				(item.activities ?? []).map((activity) => ({ ...activity, owner })),
			)
			.sort(
				(a, b) =>
					layerRank(a.sourceLayer) - layerRank(b.sourceLayer) ||
					(a.order ?? ORDER_BASE) - (b.order ?? ORDER_BASE) ||
					a.id.localeCompare(b.id),
			);
		const snapshot = { generation: version, activities };
		cache = { version, snapshot };
		return snapshot;
	};

	return {
		getSnapshot: derive,
		subscribe(listener) {
			return contributions.onChange(listener);
		},
		async launch(id: QualifiedActivityId) {
			const activity = this.getSnapshot().activities.find(
				(candidate) => candidate.id === id,
			);
			if (!activity) throw new Error(`activity "${id}" is not registered`);
			if (activity.pageTypeId) {
				await pages.open({ typeId: activity.pageTypeId });
				return;
			}
			if (activity.commandId) {
				await commands.execute(activity.commandId);
				return;
			}
			throw new Error(`activity "${id}" has no launch target`);
		},
	};
}
