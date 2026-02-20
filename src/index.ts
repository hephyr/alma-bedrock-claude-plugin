import type { PluginContext, PluginActivation } from 'alma-plugin-api';
import { BedrockClient } from './bedrock.js';

export async function activate(context: PluginContext): Promise<PluginActivation> {
    const client = new BedrockClient(context);

    const disposable = context.providers.register({
        id: 'alma-plugin-bedrock',
        name: 'AWS Bedrock',
        icon: '☁️',
        authType: 'api-key',
        sdkType: 'anthropic',

        isAuthenticated: () => client.isReady(),
        getModels: () => client.listModels(),
        getSDKConfig: () => client.getSDKConfig(),
    });

    const settingsDisposable = context.settings.onDidChange((e) => {
        if (e.key.startsWith('bedrock.')) client.reload(context);
    });

    return {
        dispose: () => {
            disposable.dispose();
            settingsDisposable.dispose();
        },
    };
}
