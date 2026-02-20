# alma-plugin-bedrock

AWS Bedrock provider plugin for [Alma](https://github.com/yetone/alma). Adds support for Claude models via Amazon Bedrock using API Key authentication.

## Installation

In Alma, go to **Settings → Plugins → Install Plugin → URL**, then enter:

```
https://github.com/hephyr/alma-bedrock#release
```

> The `#release` branch contains pre-built artifacts. The `main` branch holds source code only.

## Configuration

After installing, go to **Settings → Plugins → Amazon Bedrock** and configure:

| Setting | Description | Default |
|---|---|---|
| `bedrock.region` | AWS Region | `us-east-1` |
| `bedrock.apiKey` | Your Bedrock API Key | _(required)_ |

## Supported Models

Automatically lists all active Claude inference profiles in your AWS account:

- Claude 4 family (Opus, Sonnet, Haiku) — vision, function calling, reasoning, 200k context
- Claude 3.5 family — vision, function calling, 200k context
- Claude 3 family — vision, function calling, 200k context

## Development

```bash
pnpm install
pnpm build
```

CI automatically builds and deploys to the `release` branch on every push to `main`.

## License

MIT
