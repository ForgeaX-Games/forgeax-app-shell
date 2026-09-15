import { createContributionRegistry, type CommandsRegistry } from '@forgeax/extension-platform/platform';
import { ExtensionCleanupDeferredError } from '@forgeax/extension-platform/extensions';
import { createPageRegistry } from './registry';
import { createPageSession, PageClosePreparationDeferredError, type PageSession, type PageProjectContext } from './session';
import { createActivityRegistry } from './activity';
import { createResourceEditorResolver } from './resource-editor';
import type { PagePlatformContribution, PageRegistry } from './types';

export function createPageServices<LegacyLayout = unknown>(commands: CommandsRegistry, project: PageProjectContext) {
	// Page Types and Panel Types share one owner-tagged contribution bundle.
	// A bundle publish is one registry change, so the PageRegistry never exposes
	// a page without the panel types activated in the same extension setup.
	const pageContributions =
		createContributionRegistry<PagePlatformContribution<LegacyLayout>>();
	const pageRegistry: PageRegistry<LegacyLayout> = createPageRegistry(pageContributions);
	const pageSession: PageSession = createPageSession(pageRegistry, { project });
	const activities = createActivityRegistry(
		pageContributions,
		pageSession,
		commands,
	);
	const resourceEditors = createResourceEditorResolver(
		pageContributions,
		pageSession,
	);
	return {
		pages: pageSession,
		pageRegistry,
		activities,
		resourceEditors,
		contributePagePlatform(
			owner: string,
			contribution: PagePlatformContribution<LegacyLayout>,
		) {
			pageRegistry.validateContribution(owner, contribution);
			const removeContribution = pageContributions.contribute(
				owner,
				contribution,
			);
			let removed = false;
			return async () => {
				if (removed) return;
				// The registry still knows the owner while controllers preflight close.
				// A dirty/vetoed page rejects cleanup and leaves the contribution live.
				try {
					await pageSession.closeOwnedBy(owner);
				} catch (error) {
					if (error instanceof PageClosePreparationDeferredError) {
						throw new ExtensionCleanupDeferredError(error.message);
					}
					throw error;
				}
				removeContribution();
				removed = true;
			};
		},
		dispose: () => pageSession.dispose(),
	};
}
