# @gesslar/mediawiki-mcp

A [Model Context Protocol](https://modelcontextprotocol.io/) server that lets
MCP-compatible clients create, edit, delete, read, and search articles on a
MediaWiki instance.

## Requirements

- Node.js `>=24.11.0`
- A MediaWiki instance with API access
- A [bot account](https://www.mediawiki.org/wiki/Manual:Bot_passwords) with
  sufficient permissions for the operations you intend to perform

## Installation

```bash
npm install -g @gesslar/mediawiki-mcp
```

Or run it directly via `npx`:

```bash
npx @gesslar/mediawiki-mcp
```

## Configuration

The server is configured through environment variables:

| Variable | Description |
| --- | --- |
| `MEDIAWIKI_URL` | Base URL of the MediaWiki instance (e.g. `https://wiki.example.com`) |
| `MEDIAWIKI_BOT_USERNAME` | Bot account username |
| `MEDIAWIKI_BOT_PASSWORD` | Bot account password |

All three variables are required. The server will exit on startup if any are
missing.

## Usage with an MCP client

Add the server to your MCP client configuration. For example, in a Claude
Desktop `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "mediawiki": {
      "command": "npx",
      "args": ["-y", "@gesslar/mediawiki-mcp"],
      "env": {
        "MEDIAWIKI_URL": "https://wiki.example.com",
        "MEDIAWIKI_BOT_USERNAME": "YourBot@YourBotPassword",
        "MEDIAWIKI_BOT_PASSWORD": "your-bot-password"
      }
    }
  }
}
```

The server communicates over stdio.

## Tools

The server exposes the following tools:

### `mediawiki_create_article`

Create a new article. Fails if the article already exists.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `title` | string | yes | Title of the article to create |
| `content` | string | yes | Wikitext content for the article |
| `summary` | string | no | Edit summary |

### `mediawiki_edit_article`

Edit an existing article. Supports full replacement, append, or prepend.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `title` | string | yes | Title of the article to edit |
| `content` | string | yes | New wikitext content |
| `summary` | string | no | Edit summary |
| `append` | boolean | no | Append `content` instead of replacing |
| `prepend` | boolean | no | Prepend `content` instead of replacing |

### `mediawiki_delete_article`

Delete an article. Requires delete permissions on the bot account.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `title` | string | yes | Title of the article to delete |
| `reason` | string | no | Reason for deletion |

### `mediawiki_get_article`

Return the current wikitext content of an article.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `title` | string | yes | Title of the article to retrieve |

### `mediawiki_search`

Search articles on the wiki.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `query` | string | yes | Search query |
| `limit` | number | no | Maximum number of results (default: 10) |

## Development

```bash
# Start the server locally
npm start

# Lint
npm run lint
npm run lint:fix

# Generate TypeScript definitions
npm run types:build
```

## License

`@gesslar/mediawiki-mcp` is released under the [0BSD](LICENSE.txt).

This package includes or depends on third-party components under their own
licenses:

| Dependency | License |
| --- | --- |
| [@gesslar/wikid](https://github.com/gesslar/wikid) | 0BSD |
| [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk) | MIT |
| [vscode-jsonrpc](https://github.com/Microsoft/vscode-languageserver-node) | MIT |
