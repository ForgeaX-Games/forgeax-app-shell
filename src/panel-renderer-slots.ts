import type { ComponentType } from 'react';
import type {
  Transport, CreateExtensionPortOptions as PlatformCreateExtensionPortOptions,
  ExtensionPort as PlatformExtensionPort, WindowTransportOptions as PlatformWindowTransportOptions,
} from '@forgeax/extension-platform/transport';

export type ExtensionTransport = Transport;
export type CreateExtensionPortOptions = PlatformCreateExtensionPortOptions;
export type WindowTransportOptions = PlatformWindowTransportOptions;
export type ExtensionPort = Pick<PlatformExtensionPort,
  'onChat' | 'onToolCall' | 'setTheme' | 'setVisibility' | 'onNavigate' | 'close'
> & { surface: Pick<PlatformExtensionPort['surface'], 'subscribe'> };
type ToolHandler = Parameters<PlatformExtensionPort['onToolCall']>[0];
export type ExtensionToolCall = Parameters<ToolHandler>[0];
export type ExtensionToolResult = Awaited<ReturnType<ToolHandler>>;
export type CreateExtensionPort = (options: CreateExtensionPortOptions) => ExtensionPort;
export type CreateWindowTransport = (options: WindowTransportOptions) => ExtensionTransport;
export interface PanelExtensionTransport {
  readonly createExtensionPort?: CreateExtensionPort;
  readonly createWindowTransport?: CreateWindowTransport;
}

export interface EditorContextMenuItem {
	label?: string;
	title?: string;
	icon?: string;
	shortcut?: string;
	forge?: boolean;
	onClick?: () => void;
	disabled?: boolean;
	danger?: boolean;
	sep?: boolean;
	children?: EditorContextMenuItem[];
}

/**
 * Host-owned source import request for page-generated assets.
 *
 * This is deliberately an Editor host seam, not a plugin tool contract. The
 * host decides how the bytes enter the Editor product; page runtimes only
 * provide the project-relative destination and source bytes.
 */
export interface EditorAssetImportSourceRequest {
	readonly base64: string;
	readonly destPath: string;
	readonly sourceName: string;
	readonly requestId: string;
}

export type EditorAssetImportSourceHandler = (
	request: EditorAssetImportSourceRequest,
) => unknown | Promise<unknown>;

export interface PanelEditorBindings {
	/** Import bytes through the mounted Editor product's Gateway. */
	importAssetSource?: EditorAssetImportSourceHandler;
	setContextMenuRenderer?: (
		renderer: (
			menu: {
				x: number;
				y: number;
				items: EditorContextMenuItem[];
			} | null,
		) => void,
	) => () => void;
	installBridge?: (handlers: {
		onEditorHealth(entry: {
			level: "info" | "warn" | "error";
			code: string;
			message: string;
			ts: number;
		}): void;
		onEditorConsole(entry: {
			level: "log" | "warn" | "error" | "info" | "debug";
			text: string;
			ts: number;
		}): void;
		onEditorNetwork(entry: {
			kind: "fetch" | "xhr" | "ws";
			method: string;
			url: string;
			status: number;
			ms: number;
			ok: boolean;
			ts: number;
		}): void;
		onEditorRef(
			payload:
				| {
						kind: "entity";
						id: number;
						name: string;
						components: string[];
						source?: { plugin?: string; docId?: string };
				  }
				| {
						kind: "component";
						entityId: number;
						entityName: string;
						comp: string;
						value: unknown;
				  }
				| {
						kind: "asset";
						guid: string;
						assetKind: string;
						name: string;
						packPath?: string;
				  },
		): void;
		onAddAssetToChat(
			refs: Array<{
				type: "asset" | "folder";
				guid?: string;
				kind?: string;
				name: string;
				path: string;
				payload?: Record<string, unknown>;
				summary?: {
					totalAssets: number;
					kinds: Record<string, number>;
					guids: string[];
				};
			}>,
		): void;
	}) => () => void;
}

export interface PanelComponentSlots {
	/** MainArea body when app mode is not the SceneEditor mode (i.e., 'ai'). */
	MainAreaBody?: ComponentType;
	/** Sidebar's Agents sub-nav body. */
	SidebarAgents?: ComponentType;
	/** Extension-host top-right widget shown when an extension Page is expanded. */
	CornerAgentPicker?: ComponentType<{ preferredAgentExtensionId?: string }>;
}
