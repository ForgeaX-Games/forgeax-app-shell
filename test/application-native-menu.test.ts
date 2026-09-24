import { expect, test } from "bun:test";
import { createApplicationMenuRegistry } from "../src/application";
import {
	installNativeMenuBridge,
	type NativeMenuTransport,
} from "./native-menu-fixture";

const settle = async () => {
	for (let i = 0; i < 12; i++) await Promise.resolve();
};
function fixture() {
	const menus = createApplicationMenuRegistry();
	let locale = "en";
	menus.register({
		id: "save",
		menu: "file",
		group: "file",
		groupOrder: 10,
		order: 10,
		get label() {
			return locale === "en" ? "Save" : "Save localized";
		},
		commandId: "save",
	});
	const events: string[] = [];
	const payloads: unknown[] = [];
	let listener: ((id: string) => void) | undefined;
	let localeListener: (() => void) | undefined;
	const transport: NativeMenuTransport = {
		async listen(next) {
			listener = next;
			events.push("listen");
			return () => {
				events.push("unlisten");
			};
		},
		async invoke(command, args) {
			if (command === "set_app_menu") payloads.push(args.payload);
		},
	};
	const deps = {
		loadTransport: async () => transport,
		warmRecentGames: async () => {
			events.push("warm");
		},
		subscribeLocale(next: () => void) {
			localeListener = next;
			return () => {
				events.push("unlocale");
			};
		},
		reportError: (error: unknown) => {
			events.push(`error:${String(error)}`);
		},
	};
	return {
		menus,
		events,
		payloads,
		transport,
		deps,
		invoke: (id: string) => listener?.(id),
		changeLocale: () => {
			locale = "other";
			localeListener?.();
		},
	};
}

test("balances host lifetime, locale rebuilding, and fences a retained native listener", async () => {
	const f = fixture();
	const commands: string[] = [];
	const dispose = installNativeMenuBridge(
		{
			menus: f.menus,
			translate: (key) => key,
			execute: (id) => {
				commands.push(id);
			},
		},
		f.deps,
	);
	await settle();
	expect(f.events.indexOf("listen")).toBeLessThan(f.events.indexOf("warm"));
	f.invoke("save");
	expect(commands).toEqual(["save"]);
	f.changeLocale();
	await settle();
	expect(JSON.stringify(f.payloads.at(-1))).toContain("Save localized");
	dispose();
	dispose();
	const count = f.payloads.length;
	f.invoke("save");
	f.changeLocale();
	f.menus.register({
		id: "late",
		menu: "file",
		group: "file",
		groupOrder: 10,
		order: 20,
		label: "Late",
	});
	await settle();
	expect(commands).toEqual(["save"]);
	expect(f.payloads).toHaveLength(count);
	expect(f.events.filter((event) => event === "unlisten")).toHaveLength(1);
	expect(f.events.filter((event) => event === "unlocale")).toHaveLength(1);
});

test("disposal before asynchronous listener registration resolves still releases it", async () => {
	const f = fixture();
	let resolve!: (off: () => void) => void;
	f.transport.listen = () =>
		new Promise((done) => {
			resolve = done;
		});
	const dispose = installNativeMenuBridge(
		{ menus: f.menus, translate: (key) => key, execute() {} },
		f.deps,
	);
	await settle();
	dispose();
	let removed = 0;
	resolve(() => {
		removed++;
	});
	await settle();
	expect(removed).toBe(1);
	expect(f.payloads).toEqual([]);
});

test("publishes static menus before pending warming and fences disposal", async () => {
	const f = fixture();
	let resolve!: () => void;
	f.deps.warmRecentGames = () =>
		new Promise<void>((done) => {
			resolve = done;
		});
	const dispose = installNativeMenuBridge(
		{ menus: f.menus, translate: (key) => key, execute() {} },
		f.deps,
	);
	await settle();
	expect(f.payloads).toHaveLength(1);
	dispose();
	resolve();
	await settle();
	expect(f.payloads).toHaveLength(1);
});

test("native invocation respects hidden ancestors and current disabled state", async () => {
	const f = fixture();
	let enabled = false;
	f.menus.register({
		id: "disabled",
		menu: "file",
		group: "file",
		groupOrder: 10,
		order: 20,
		label: "Disabled",
		commandId: "disabled",
		enabled: () => enabled,
	});
	f.menus.register({
		id: "hidden",
		menu: "file",
		group: "file",
		groupOrder: 10,
		order: 30,
		label: "Hidden",
		when: () => false,
		children: [
			{
				id: "hidden-child",
				menu: "file",
				group: "file",
				groupOrder: 10,
				order: 1,
				label: "Child",
				commandId: "hidden-child",
			},
		],
	});
	const commands: string[] = [];
	const dispose = installNativeMenuBridge(
		{
			menus: f.menus,
			translate: (key) => key,
			execute: (id) => {
				commands.push(id);
			},
		},
		f.deps,
	);
	await settle();
	f.invoke("disabled");
	f.invoke("hidden-child");
	expect(commands).toEqual([]);
	enabled = true;
	f.invoke("disabled");
	expect(commands).toEqual(["disabled"]);
	dispose();
});

test("cleanup failures do not prevent other cleanup or retained-listener fencing", async () => {
	const f = fixture();
	const listen = f.transport.listen;
	f.transport.listen = async (listener) => {
		const off = await listen(listener);
		return () => {
			off();
			throw new Error("cleanup failure");
		};
	};
	const commands: string[] = [];
	const dispose = installNativeMenuBridge(
		{
			menus: f.menus,
			translate: (key) => key,
			execute: (id) => {
				commands.push(id);
			},
		},
		f.deps,
	);
	await settle();
	dispose();
	f.invoke("save");
	expect(commands).toEqual([]);
	expect(f.events).toContain("unlocale");
	expect(f.events).toContain("unlisten");
	expect(f.events.some((event) => event.includes("cleanup failure"))).toBe(
		true,
	);
});

test("failed setup releases partial subscriptions and a fresh host can still install", async () => {
	const f = fixture();
	const failed = installNativeMenuBridge(
		{ menus: f.menus, translate: (key) => key, execute() {} },
		{
			...f.deps,
			subscribeLocale() {
				throw new Error("locale subscription failed");
			},
		},
	);
	await settle();
	expect(f.events).toContain("unlisten");
	expect(f.payloads).toEqual([]);
	failed();
	const next = fixture();
	const dispose = installNativeMenuBridge(
		{ menus: next.menus, translate: (key) => key, execute() {} },
		next.deps,
	);
	await settle();
	expect(next.payloads).toHaveLength(2);
	dispose();
});

test("a pending transport import cannot install after cleanup", async () => {
	const f = fixture();
	let resolve!: (transport: NativeMenuTransport) => void;
	const dispose = installNativeMenuBridge(
		{ menus: f.menus, translate: (key) => key, execute() {} },
		{
			...f.deps,
			loadTransport: () =>
				new Promise((done) => {
					resolve = done;
				}),
		},
	);
	dispose();
	resolve(f.transport);
	await settle();
	expect(f.events).toEqual([]);
	expect(f.payloads).toEqual([]);
});

test("native payload writes are serialized and a queued locale change uses fresh labels", async () => {
	const f = fixture();
	const complete: Array<() => void> = [];
	f.transport.invoke = (command, args) => {
		if (command !== "set_app_menu") return Promise.resolve();
		f.payloads.push(args.payload);
		return new Promise<void>((resolve) => {
			complete.push(resolve);
		});
	};
	const dispose = installNativeMenuBridge(
		{ menus: f.menus, translate: (key) => key, execute() {} },
		f.deps,
	);
	await settle();
	expect(f.payloads).toHaveLength(1);
	f.changeLocale();
	await settle();
	expect(f.payloads).toHaveLength(1);
	complete[0]!();
	await settle();
	expect(f.payloads).toHaveLength(2);
	expect(JSON.stringify(f.payloads[1])).toContain("Save localized");
	dispose();
	complete[1]!();
	await settle();
	expect(f.payloads).toHaveLength(2);
});


test('native invocation follows product menu order for colliding child IDs', async () => {
  const f = fixture();
  for (const [menu, groupOrder, commandId] of [['file', 20, 'file.command'], ['edit', 1, 'edit.command']] as const) {
    f.menus.register({ id: `${menu}.parent`, menu, group: 'group', groupOrder, order: 0, label: menu,
      children: [{ id: 'shared-child', menu, group: 'group', groupOrder, order: 0, label: 'Child', commandId }] });
  }
  const commands: string[] = [];
  const dispose = installNativeMenuBridge({ menus: f.menus, translate: key => key, execute: id => { commands.push(id); } }, f.deps);
  await settle();
  f.invoke('shared-child');
  expect(commands).toEqual(['file.command']);
  dispose(); f.menus.dispose();
});


test("failed warming leaves synchronous commands installed", async () => {
 const f = fixture();
 f.deps.warmRecentGames = async () => {throw new Error("offline");};
 const dispose = installNativeMenuBridge({menus:f.menus,translate:(key)=>key,execute(){}},f.deps);
 await settle();
 expect(f.payloads).toHaveLength(1);
 expect(f.events).toContain("error:Error: offline");
 dispose();
});
