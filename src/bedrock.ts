import type { PluginContext, ModelCapabilities, ProviderModel } from 'alma-plugin-api';
import AnthropicBedrock from '@anthropic-ai/bedrock-sdk';
import {
    BedrockClient as AWSBedrockClient,
    ListInferenceProfilesCommand,
} from '@aws-sdk/client-bedrock';

export class BedrockClient {
    private anthropicClient: AnthropicBedrock | null = null;
    private controlClient: AWSBedrockClient | null = null;
    private logger: PluginContext['logger'];

    constructor(context: PluginContext) {
        this.logger = context.logger;
        this.init(context);
    }

    reload(context: PluginContext): void {
        this.anthropicClient = null;
        this.controlClient = null;
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
        const region = context.settings.get<string>('bedrock.region', 'us-east-1');
        const apiKey = context.settings.get<string>('bedrock.apiKey', '');

        if (!apiKey) return;

        // AnthropicBedrock with skipAuth + custom fetch to inject Bearer token
        this.anthropicClient = new AnthropicBedrock({
            awsRegion: region,
            skipAuth: true,
            fetch: (url: RequestInfo | URL, init?: RequestInit) => {
                const headers = new Headers(init?.headers);
                headers.set('authorization', `Bearer ${apiKey}`);
                return fetch(url, { ...init, headers });
            },
        });

        // controlClient for ListInferenceProfilesCommand (model listing)
        const controlEndpoint = `https://bedrock.${region}.amazonaws.com`;
        const dummyCreds = { accessKeyId: 'unused', secretAccessKey: 'unused' };

        const apiKeyMiddleware = (next: any) => async (args: any) => {
            if (args.request?.headers) {
                args.request.headers['authorization'] = `Bearer ${apiKey}`;
                delete args.request.headers['x-amz-date'];
                delete args.request.headers['x-amz-security-token'];
                delete args.request.headers['x-amz-content-sha256'];
            }
            return next(args);
        };
        const middlewareOpts = { step: 'finalizeRequest' as const, name: 'apiKeyAuth', priority: 'low' as const };

        this.controlClient = new AWSBedrockClient({
            endpoint: controlEndpoint,
            region,
            credentials: dummyCreds,
        });
        this.controlClient.middlewareStack.add(apiKeyMiddleware, middlewareOpts);

        this.logger.info(`Bedrock client initialized (region: ${region})`);
    }

    // ─── Model listing ────────────────────────────────────────────────

    async listModels(): Promise<ProviderModel[]> {
        if (!this.controlClient) {
            throw new Error('Bedrock not configured. Set API Key in plugin settings.');
        }

        const models: ProviderModel[] = [];
        let nextToken: string | undefined;

        do {
            const resp = await this.controlClient.send(
                new ListInferenceProfilesCommand({
                    maxResults: 100,
                    ...(nextToken ? { nextToken } : {}),
                })
            );

            for (const p of resp.inferenceProfileSummaries ?? []) {
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
            nextToken = resp.nextToken;
        } while (nextToken);

        this.logger.info(`Fetched ${models.length} Claude inference profiles`);
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
