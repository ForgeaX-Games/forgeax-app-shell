import {
  installApplicationNativeMenuBridge,
  type ApplicationMenuRegistry,
} from '../src/application';

export interface NativeMenuTransport {
  invoke(command: string, args: Record<string, unknown>): Promise<unknown>;
  listen(listener: (id: string) => void): Promise<() => void>;
}
export function installNativeMenuBridge(opts: {
  menus: ApplicationMenuRegistry;
  translate(key: string): string;
  execute(id: string, args?: unknown): void | Promise<unknown>;
}, deps: {
  loadTransport(): Promise<NativeMenuTransport>;
  warmRecentGames(): Promise<void>;
  subscribeLocale(listener: () => void): () => void;
  reportError(error: unknown): void;
}) {
  return installApplicationNativeMenuBridge({
    menus: opts.menus, menuIds: ['file', 'edit'], title: id => opts.translate(`menubar.${id}`),
    execute: opts.execute,
    async loadTransport() {
      const transport = await deps.loadTransport();
      return { listen: transport.listen, publish: payload => transport.invoke('set_app_menu', { payload }) };
    },
    prepare: deps.warmRecentGames, subscribeLabels: deps.subscribeLocale, reportError: deps.reportError,
  });
}
