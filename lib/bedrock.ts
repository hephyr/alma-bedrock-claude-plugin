import type { PluginContext, Storage } from 'alma-plugin-api';
import AnthropicBedrock from '@anthropic-ai/bedrock-sdk';

export interface ModelCapabilities {
    vision?: boolean;
    functionCalling?: boolean;
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

interface InferenceProfile {
    inferenceProfileId: string;
    inferenceProfileName: string;
    status: string;
}

interface ListInferenceProfilesResponse {
    inferenceProfileSummaries?: InferenceProfile[];
    nextToken?: string;
}

export class BedrockClient {
    private anthropicClient: AnthropicBedrock | null = null;
    private region = '';
    private apiKey = '';
    private logger: PluginContext['logger'];
    private storage: Storage;
    private modelsCache: Promise<ProviderModel[]> | null = null;

    constructor(context: PluginContext) {
        this.logger = context.logger;
        this.storage = context.storage.local;
        this.init(context);
    }

    reload(context: PluginContext): void {
        const newRegion = context.settings.get<string>('bedrock.region', 'us-east-1');
        const newApiKey = context.settings.get<string>('bedrock.apiKey', '');
        if (newRegion === this.region && newApiKey === this.apiKey) return;

        this.anthropicClient = null;
        this.modelsCache = null;
        this.storage.delete('models');
        this.init(context);
    }

    /** Whether the client is configured and ready to use. */
    isReady(): boolean {
        return this.anthropicClient !== null;
    }

    /**
     * Returns SDK config for Alma's Vercel AI SDK integration.
     * The custom fetch intercepts Anthropic-format requests and routes them through Bedrock.
     */
    getSDKConfig(): { baseURL: string; apiKey: string; fetch: typeof fetch } {
        return {
            baseURL: 'https://bedrock.local/v1',
            apiKey: 'bedrock-via-plugin',
            fetch: this.createCustomFetch(),
        };
    }

    // ─── Initialization ───────────────────────────────────────────────

    private init(context: PluginContext): void {
        this.region = context.settings.get<string>('bedrock.region', 'us-east-1');
        this.apiKey = context.settings.get<string>('bedrock.apiKey', '');

        if (!this.apiKey) return;

        this.anthropicClient = new AnthropicBedrock({
            awsRegion: this.region,
            skipAuth: true,
            fetch: (url: RequestInfo | URL, init?: RequestInit) => {
                const headers = new Headers(init?.headers);
                headers.set('authorization', `Bearer ${this.apiKey}`);
                return fetch(url, { ...init, headers });
            },
        });

        this.logger.info(`Bedrock client initialized (region: ${this.region})`);
    }

    // ─── Model listing ────────────────────────────────────────────────

    listModels(): Promise<ProviderModel[]> {
        if (!this.apiKey) {
            throw new Error('Bedrock not configured. Set API Key in plugin settings.');
        }

        if (!this.modelsCache) {
            this.modelsCache = this.loadModels().catch((err) => {
                this.modelsCache = null;
                throw err;
            });
        }
        return this.modelsCache;
    }

    private async loadModels(): Promise<ProviderModel[]> {
        const cached = await this.storage.get<ProviderModel[]>('models');
        if (cached) {
            this.refreshModelsInBackground();
            return cached;
        }
        return this.fetchModels();
    }

    private refreshModelsInBackground(): void {
        this.fetchModels()
            .then((models) => { this.modelsCache = Promise.resolve(models); })
            .catch((err) => { this.logger.warn(`Background model refresh failed: ${err}`); });
    }

    private async fetchModels(): Promise<ProviderModel[]> {
        const models: ProviderModel[] = [];
        let nextToken: string | undefined;

        do {
            const url = new URL(`https://bedrock.${this.region}.amazonaws.com/inference-profiles`);
            url.searchParams.set('maxResults', '100');
            if (nextToken) url.searchParams.set('nextToken', nextToken);

            const resp = await fetch(url, {
                headers: { authorization: `Bearer ${this.apiKey}` },
            });

            if (!resp.ok) {
                throw new Error(`Failed to list inference profiles: ${resp.status} ${resp.statusText}`);
            }

            const data: ListInferenceProfilesResponse = await resp.json();

            for (const p of data.inferenceProfileSummaries ?? []) {
                if (
                    p.inferenceProfileId &&
                    p.inferenceProfileName &&
                    p.status === 'ACTIVE' &&
                    p.inferenceProfileId.includes('anthropic.claude')
                ) {
                    models.push({
                        id: p.inferenceProfileId,
                        name: p.inferenceProfileName,
                        capabilities: this.getModelCapabilities(p.inferenceProfileId),
                    });
                }
            }
            nextToken = data.nextToken;
        } while (nextToken);

        this.logger.info(`Fetched ${models.length} Claude inference profiles`);
        await this.storage.set('models', models);
        return models;
    }

    // ─── Capability inference ──────────────────────────────────────────

    private getModelCapabilities(modelId: string): ModelCapabilities {
        // Strip regional prefix (e.g. "us." or "eu.") for matching
        const id = modelId.replace(/^[a-z]{2}\./, '');

        // Claude 4+ family (claude-4, claude-sonnet-4, claude-opus-4, etc.)
        if (/anthropic\.claude-(?:sonnet|opus|haiku)-?4/.test(id) || /anthropic\.claude-4/.test(id)) {
            return {
                vision: true,
                functionCalling: true,
                streaming: true,
                reasoning: true,
                contextWindow: 200_000,
                maxOutputTokens: 16_384,
            };
        }

        // Claude 3.5 family
        if (/anthropic\.claude-3-5/.test(id)) {
            return {
                vision: true,
                functionCalling: true,
                streaming: true,
                reasoning: false,
                contextWindow: 200_000,
                maxOutputTokens: 8_192,
            };
        }

        // Claude 3 family
        if (/anthropic\.claude-3/.test(id)) {
            return {
                vision: true,
                functionCalling: true,
                streaming: true,
                reasoning: false,
                contextWindow: 200_000,
                maxOutputTokens: 4_096,
            };
        }

        // Fallback for older or unknown Claude models
        return {
            vision: false,
            functionCalling: false,
            streaming: true,
            reasoning: false,
            contextWindow: 128_000,
            maxOutputTokens: 4_096,
        };
    }

    // ─── Custom fetch (Anthropic format → AnthropicBedrock SDK) ───────

    private createCustomFetch(): typeof fetch {
        const self = this;
        return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
            try {
                const body = JSON.parse(init?.body as string ?? '{}');
                const isStream = body.stream === true;
                delete body.stream; // SDK methods handle streaming separately

                if (isStream) {
                    const stream = self.anthropicClient!.messages.stream(body);
                    const readable = new ReadableStream<Uint8Array>({
                        async start(controller) {
                            const encoder = new TextEncoder();
                            for await (const event of stream) {
                                controller.enqueue(encoder.encode(
                                    `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
                                ));
                            }
                            controller.close();
                        },
                    });
                    return new Response(readable, {
                        status: 200,
                        headers: { 'content-type': 'text/event-stream' },
                    });
                } else {
                    const resp = await self.anthropicClient!.messages.create(body);
                    return new Response(JSON.stringify(resp), {
                        status: 200,
                        headers: { 'content-type': 'application/json' },
                    });
                }
            } catch (err) {
                self.logger.error(`Custom fetch error: ${err}`);
                return new Response(
                    JSON.stringify({ error: { message: String(err), type: 'bedrock_error' } }),
                    { status: 500, headers: { 'content-type': 'application/json' } },
                );
            }
        };
    }
}
