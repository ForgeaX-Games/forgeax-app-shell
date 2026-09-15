import type { ApplicationMenuItem, ApplicationMenuRegistry } from './application-menus';

export interface ApplicationNativeMenuItem {
  id: string;
  label: string;
  enabled: boolean;
  accelerator?: string;
  danger?: boolean;
  separatorBefore?: boolean;
  children?: ApplicationNativeMenuItem[];
}
export interface ApplicationNativeMenu<MenuId extends string = string> {
  menu: MenuId;
  title: string;
  items: ApplicationNativeMenuItem[];
}

function serializeItem(item: ApplicationMenuItem): ApplicationNativeMenuItem | null {
	if (item.when && !item.when()) return null;
	const children = item.children?.length
		? item.children
		: item.dynamicChildren?.();
	const result: ApplicationNativeMenuItem = {
		id: item.id,
		// Already resolved by the owner, including live locale getters. Never
		// reinterpret a contributor's literal label as an Interface locale key.
		label: item.label,
		enabled: item.enabled
			? item.enabled()
			: children?.length
				? true
				: !!item.commandId,
	};
	if (item.keybinding) {
		result.accelerator = item.keybinding
			.split("+")
			.map((part) => (part === "Ctrl" ? "CmdOrCtrl" : part))
			.join("+");
	}
	if (item.danger) result.danger = true;
	if (children?.length) {
		const projected = children
			.map(serializeItem)
			.filter((child): child is ApplicationNativeMenuItem => child !== null);
		if (projected.length) result.children = projected;
	}
	return result;
}

function findInList(
	list: readonly ApplicationMenuItem[],
	id: string,
): ApplicationMenuItem | undefined {
	for (const item of list) {
		if ((item.when && !item.when()) || (item.enabled && !item.enabled()))
			continue;
		if (item.id === id) return item;
		// Recurse into static children AND dynamic ones — a native click on a
		// dynamically-derived row (e.g. an item under Open Recent) must resolve
		// to its def so its commandId + args get dispatched. dynamicChildren is
		// re-derived here (cache current at click time), matching what was pushed.
		const kids =
			item.children && item.children.length > 0
				? item.children
				: item.dynamicChildren
					? item.dynamicChildren()
					: null;
		if (kids && kids.length > 0) {
			const nested = findInList(kids, id);
			if (nested) return nested;
		}
	}
	return undefined;
}

/** Project the same live menu snapshot with caller-selected locations/titles. */
export function serializeApplicationNativeMenus<MenuId extends string>(
  items: readonly ApplicationMenuItem[],
  menuIds: readonly MenuId[],
  title: (id: MenuId) => string,
): ApplicationNativeMenu<MenuId>[] {
  return menuIds.map(menu => {
    const projected: ApplicationNativeMenuItem[] = [];
    let previousGroup: string | null = null;
    for (const item of items.filter(item => item.menu === menu)) {
      const native = serializeItem(item);
      if (native) {
        if (previousGroup !== null && previousGroup !== item.group) native.separatorBefore = true;
        projected.push(native);
      }
      previousGroup = item.group;
    }
    return { menu, title: title(menu), items: projected };
  });
}

export interface ApplicationNativeMenuTransport {
  publish(payload: readonly ApplicationNativeMenu[]): Promise<unknown>;
  listen(listener: (id: string) => void): Promise<() => void>;
}
export interface ApplicationNativeMenuBridgeOptions {
  readonly menus: ApplicationMenuRegistry;
  readonly menuIds: readonly string[];
  readonly title: (menuId: string) => string;
  readonly execute: (id: string, args?: unknown) => void | Promise<unknown>;
  readonly loadTransport: () => Promise<ApplicationNativeMenuTransport>;
  readonly prepare: () => Promise<void>;
  readonly subscribeLabels: (listener: () => void) => () => void;
  readonly reportError: (error: unknown) => void;
}

/** Own asynchronous subscription cleanup and serialized native-menu updates.
 * Platform transport, menu choice, data warming and labels remain caller-owned. */
export function installApplicationNativeMenuBridge(options: ApplicationNativeMenuBridgeOptions): () => void {
	let disposed = false;
	const cleanups: Array<() => void> = [];
	const report = (error: unknown) => {
		try {
			options.reportError(error);
		} catch {
			/* Reporting must not prevent cleanup. */
		}
	};
	const safely = (cleanup: () => void) => {
		try {
			cleanup();
		} catch (error) {
			report(error);
		}
	};
	const retain = (cleanup: () => void) => {
		if (disposed) safely(cleanup);
		else cleanups.push(cleanup);
	};
	const dispose = () => {
		if (disposed) return;
		disposed = true;
		for (const cleanup of cleanups.splice(0).reverse()) safely(cleanup);
	};

	void (async () => {
		const transport = await options.loadTransport();
		if (disposed) return;
		// Subscribe before warming so existing native items remain responsive.
		const off = await transport.listen((id) => {
			if (disposed || !id) return;
			try {
				const snapshot = options.menus.snapshot();
        const item = findInList(options.menuIds.flatMap(menu => snapshot.filter(item => item.menu === menu)), id);
				if (!item?.commandId) return;
				void Promise.resolve(options.execute(item.commandId, item.args)).catch(
					report,
				);
			} catch (error) {
				report(error);
			}
		});
		retain(off);
		if (disposed) return;

		// Serialize pushes: a slower old update must not overwrite a newer locale
		// or host snapshot. Events arriving during warming are read in that push.
		let dirty = false;
		let running = false;
		const refresh = () => {
			if (disposed) return;
			dirty = true;
			if (running) return;
			running = true;
			void (async () => {
				try {
					while (!disposed && dirty) {
						dirty = false;
						try {
							await options.prepare();
							if (disposed) return;
							dirty = false;
              const payload = serializeApplicationNativeMenus(options.menus.snapshot(), options.menuIds, options.title);
              await transport.publish(payload);
						} catch (error) {
							report(error);
						}
					}
				} finally {
					running = false;
				}
			})();
		};
		retain(options.menus.subscribe(refresh));
		retain(options.subscribeLabels(refresh));
		refresh();
	})().catch((error) => {
		report(error);
		dispose();
	});
	return dispose;
}

