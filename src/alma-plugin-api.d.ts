/**
 * Type declarations for alma-plugin-api.
 * These types are based on the official Alma Plugin API Reference.
 * Remove this file once the alma-plugin-api package provides its own types.
 */
declare module 'alma-plugin-api' {
    // ─── Core ────────────────────────────────────────────────────────

    export interface PluginContext {
        readonly id: string;
        readonly extensionPath: string;
        readonly storagePath: string;
        readonly globalStoragePath: string;
        readonly logger: Logger;
        readonly storage: StorageAPIs;
        readonly tools: ToolsAPI;
        readonly commands: CommandsAPI;
        readonly events: EventsAPI;
        readonly ui: UIAPI;
        readonly chat: ChatAPI;
        readonly providers: ProvidersAPI;
        readonly workspace: WorkspaceAPI;
        readonly settings: SettingsAPI;
        readonly i18n: I18nAPI;
    }

    export interface PluginActivation {
        dispose: () => void;
    }

    export interface Disposable {
        dispose(): void;
    }

    // ─── Logger ──────────────────────────────────────────────────────

    export interface Logger {
        info(message: string, ...args: unknown[]): void;
        warn(message: string, ...args: unknown[]): void;
        error(message: string, ...args: unknown[]): void;
        debug(message: string, ...args: unknown[]): void;
    }

    // ─── Storage ─────────────────────────────────────────────────────

    export interface StorageAPIs {
        local: Storage;
        workspace: Storage;
        secrets: SecretStorage;
    }

    export interface Storage {
        get<T>(key: string): Promise<T | undefined>;
        get<T>(key: string, defaultValue: T): Promise<T>;
        set(key: string, value: unknown): Promise<void>;
        delete(key: string): Promise<void>;
        keys(): Promise<string[]>;
        clear(): Promise<void>;
    }

    export interface SecretStorage {
        get(key: string): Promise<string | undefined>;
        set(key: string, value: string): Promise<void>;
        delete(key: string): Promise<void>;
    }

    // ─── Settings ────────────────────────────────────────────────────

    export interface SettingsAPI {
        get<T>(key: string): T | undefined;
        get<T>(key: string, defaultValue: T): T;
        update(key: string, value: unknown): Promise<void>;
        onDidChange: Event<SettingsChangeEvent>;
    }

    export interface SettingsChangeEvent {
        key: string;
        oldValue: unknown;
        newValue: unknown;
    }

    // ─── Providers ───────────────────────────────────────────────────

    export interface ProvidersAPI {
        list(): Promise<Provider[]>;
        get(id: string): Promise<Provider | undefined>;
        register(provider: ProviderDefinition): Disposable;
    }

    export interface Provider {
        id: string;
        name: string;
        type: string;
        enabled: boolean;
    }

    export interface ModelCapabilities {
        vision?: boolean;
        imageOutput?: boolean;
        functionCalling?: boolean;
        functionCallingViaXml?: boolean;
        jsonMode?: boolean;
        streaming?: boolean;
        reasoning?: boolean;
        contextWindow?: number;
        maxOutputTokens?: number;
    }

    export interface ProviderModel {
        id: string;
        name: string;
        capabilities?: ModelCapabilities;
    }

    export interface ProviderDefinition {
        id: string;
        name: string;
        icon?: string;
        description?: string;
        authType?: 'api-key' | 'oauth' | 'none';
        sdkType?: 'openai' | 'anthropic' | 'google';

        isAuthenticated(): boolean | Promise<boolean>;
        getModels(): Promise<ProviderModel[]>;
        getSDKConfig(): {
            baseURL: string;
            apiKey: string;
            fetch?: typeof fetch;
            headers?: Record<string, string>;
        };

        authenticate?(): Promise<{ success: boolean; error?: string }>;
        fetchModels?(): Promise<ProviderModel[]>;
    }

    // ─── Chat ────────────────────────────────────────────────────────

    export interface ChatAPI {
        getThread(id: string): Promise<Thread | undefined>;
        getActiveThread(): Promise<Thread | undefined>;
        createThread(options?: { title?: string; model?: string }): Promise<Thread>;
        getMessages(threadId: string): Promise<Message[]>;
    }

    export interface Thread {
        id: string;
        title: string;
        model?: string;
        createdAt: string;
        updatedAt: string;
    }

    export interface Message {
        id: string;
        role: 'user' | 'assistant' | 'system';
        content: string;
        createdAt: string;
    }

    // ─── Commands ────────────────────────────────────────────────────

    export interface CommandsAPI {
        register(
            id: string,
            handler: (...args: unknown[]) => Promise<unknown> | unknown
        ): Disposable;
        execute<T>(id: string, ...args: unknown[]): Promise<T>;
    }

    // ─── Events ──────────────────────────────────────────────────────

    export type Event<T> = (handler: (e: T) => void) => Disposable;

    export interface EventsAPI {
        on<T extends string>(
            hookName: T,
            handler: (...args: unknown[]) => void | Promise<void>,
            options?: { priority?: number }
        ): Disposable;
        once<T extends string>(
            hookName: T,
            handler: (...args: unknown[]) => void | Promise<void>
        ): Disposable;
    }

    // ─── UI ──────────────────────────────────────────────────────────

    export interface UIAPI {
        showNotification(options: {
            type: 'info' | 'warning' | 'error';
            message: string;
        }): void;
        showInputBox(options: {
            title?: string;
            placeholder?: string;
            value?: string;
            password?: boolean;
        }): Promise<string | undefined>;
    }

    // ─── Tools ───────────────────────────────────────────────────────

    export interface ToolsAPI {
        register(id: string, definition: unknown): Disposable;
        unregister(id: string): void;
    }

    // ─── Workspace ───────────────────────────────────────────────────

    export interface WorkspaceAPI {
        readonly rootPath: string | undefined;
        readonly workspaceFolders: Array<{ id: string; path: string; name: string }>;
        readFile(filePath: string): Promise<Uint8Array>;
        writeFile(filePath: string, content: Uint8Array): Promise<void>;
    }

    // ─── I18n ────────────────────────────────────────────────────────

    export interface I18nAPI {
        t(key: string, params?: Record<string, unknown>): string;
        locale: string;
        onDidChangeLocale: Event<string>;
    }
}
