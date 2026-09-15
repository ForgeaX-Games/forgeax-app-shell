import { expect, test } from "bun:test";
import {
	type ApplicationMenuItem,
	createApplicationMenuRegistry,
} from "../src/application";
import { serializeApplicationNativeMenus } from '../src/application';
const serializeApplicationMenusForNative = (items: readonly ApplicationMenuItem[]) =>
  serializeApplicationNativeMenus(items, ['edit'], id => `Product ${id}`);
const projectApplicationMenus = (items: readonly ApplicationMenuItem[]) => ({ edit: items.filter(item => item.menu === 'edit') });

const row = (
	id: string,
	group = "history",
	groupOrder = 10,
): ApplicationMenuItem => ({
	id,
	menu: "edit",
	group,
	groupOrder,
	order: 10,
	label: id,
});

test("web and native projections consume the same host ordering without owning registrations", () => {
	const menus = createApplicationMenuRegistry();
	menus.register({ ...row("cut", "clipboard", 20), commandId: "text.cut" });
	const undo = {
		...row("undo"),
		commandId: "editor.undo",
		keybinding: "Ctrl+Z",
	};
	const remove = menus.register(undo);
	expect(
		projectApplicationMenus(menus.snapshot()).edit.map((item) => item.id),
	).toEqual(["undo", "cut"]);
	expect(
		serializeApplicationMenusForNative(menus.snapshot()).find(
			(menu) => menu.menu === "edit",
		)?.items,
	).toEqual([
		{ id: "undo", label: "undo", enabled: true, accelerator: "CmdOrCtrl+Z" },
		{ id: "cut", label: "cut", enabled: true, separatorBefore: true },
	]);
	remove();
	expect(
		projectApplicationMenus(menus.snapshot()).edit.map((item) => item.id),
	).toEqual(["cut"]);
	menus.dispose();
	expect(projectApplicationMenus(menus.snapshot()).edit).toEqual([]);
});

test("labels remain contributor-owned and native payloads are rebuilt for locale changes", () => {
	const menus = createApplicationMenuRegistry();
	let title = "Undo";
	menus.register({
		...row("undo"),
		get label() {
			return title;
		},
	});
	const snapshot = menus.snapshot();
	title = "Undo localized";
	expect(projectApplicationMenus(snapshot).edit[0]?.label).toBe(title);
	expect(
		serializeApplicationMenusForNative(snapshot).find(
			(menu) => menu.menu === "edit",
		)?.items[0]?.label,
	).toBe(title);
});

test("retains placeholders, explicit disabled state, dynamic children and native JSON shape", () => {
	const menus = createApplicationMenuRegistry();
	let childName = "First";
	menus.register(row("placeholder"));
	menus.register({
		...row("disabled"),
		commandId: "editor.stop",
		enabled: () => false,
		danger: true,
	});
	menus.register({
		...row("recent"),
		dynamicChildren: () => [
			{ ...row("child"), label: childName, commandId: "game.pick" },
		],
	});
	menus.register({ ...row("hidden"), when: () => false });
	childName = "Second";
	const payload = serializeApplicationMenusForNative(menus.snapshot());
	const items = payload.find((menu) => menu.menu === "edit")!.items;
	expect(items.map((item) => item.id)).toEqual([
		"placeholder",
		"disabled",
		"recent",
	]);
	expect(items[0]?.enabled).toBe(false);
	expect(items[1]).toMatchObject({ enabled: false, danger: true });
	expect(items[2]).toMatchObject({
		enabled: true,
		children: [{ id: "child", label: "Second", enabled: true }],
	});
	expect(JSON.parse(JSON.stringify(payload))).toEqual(payload);
});

test("preserves the existing static-children precedence over dynamic children", () => {
	const menus = createApplicationMenuRegistry();
	menus.register({
		...row("parent"),
		children: [row("static")],
		dynamicChildren: () => {
			throw new Error("must not run");
		},
	});
	expect(
		serializeApplicationMenusForNative(menus.snapshot()).find(
			(menu) => menu.menu === "edit",
		)?.items[0]?.children,
	).toEqual([{ id: "static", label: "static", enabled: false }]);
});


test('menu choice, order and top-level titles belong to the caller', () => {
  const payload = serializeApplicationNativeMenus([{ ...row('undo'), menu: 'edit' }, { ...row('hidden-location'), menu: 'other' }], ['custom', 'edit'] as const, id => `Title ${id}`);
  expect(payload.map(menu => [menu.menu, menu.title])).toEqual([['custom', 'Title custom'], ['edit', 'Title edit']]);
  expect(payload[0]?.items).toEqual([]);
  expect(payload[1]?.items.map(item => item.id)).toEqual(['undo']);
});
