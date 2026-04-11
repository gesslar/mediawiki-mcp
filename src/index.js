#!/usr/bin/env node

import Wikid from "@gesslar/wikid"
import {Server} from "@modelcontextprotocol/sdk/server/index.js"
import {StdioServerTransport} from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"

class MediaWikiMCPServer {
  #client

  constructor() {
    this.server = new Server(
      {
        name: "mediawiki-mcp-server",
        version: "0.1.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    )

    // Required environment variables
    this.wikiUrl = process.env.MEDIAWIKI_URL
    this.botUsername = process.env.MEDIAWIKI_BOT_USERNAME
    this.botPassword = process.env.MEDIAWIKI_BOT_PASSWORD

    if(!this.wikiUrl || !this.botUsername || !this.botPassword) {
      console.error("Error: Required environment variables not set:")
      console.error("  MEDIAWIKI_URL - The base URL of your MediaWiki instance")
      console.error("  MEDIAWIKI_BOT_USERNAME - Bot account username")
      console.error("  MEDIAWIKI_BOT_PASSWORD - Bot account password")
      process.exit(1)
    }

    // Normalize URL (remove trailing slash)
    this.wikiUrl = this.wikiUrl.replace(/\/$/, "")
    this.apiUrl = `${this.wikiUrl}/api.php`

    console.error(`MediaWiki URL: ${this.wikiUrl}`)
    console.error(`Bot username: ${this.botUsername}`)

    this.setupHandlers()
  }

  /**
   * Create and authenticate a MediaWiki client
   *
   * @returns {Promise<Wikid>} Authenticated client
   */
  async #assureClient() {
    if(!this.#client) {
      const client = new Wikid({
        baseUrl: this.wikiUrl,
        botUsername: this.botUsername,
        botPassword: this.botPassword,
        private: true // Your wiki requires auth for reads
      })

      this.#client = await client.login()
    }

    return this.#client
  }

  setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async() => ({
      tools: [
        {
          name: "mediawiki_create_article",
          description:
            "Create a new article on the MediaWiki instance. Will fail if the article already exists.",
          inputSchema: {
            type: "object",
            properties: {
              title: {
                type: "string",
                description: "Title of the article to create",
              },
              content: {
                type: "string",
                description: "Wikitext content for the article",
              },
              summary: {
                type: "string",
                description: "Edit summary (reason for creating the article)",
              },
            },
            required: ["title", "content"],
          },
        },
        {
          name: "mediawiki_edit_article",
          description:
            "Edit an existing article on the MediaWiki instance. Can create a new article if it doesn't exist (use createonly=false).",
          inputSchema: {
            type: "object",
            properties: {
              title: {
                type: "string",
                description: "Title of the article to edit",
              },
              content: {
                type: "string",
                description: "New wikitext content for the article",
              },
              summary: {
                type: "string",
                description: "Edit summary (reason for the edit)",
              },
              append: {
                type: "boolean",
                description: "If true, append content instead of replacing. Default: false",
              },
              prepend: {
                type: "boolean",
                description: "If true, prepend content instead of replacing. Default: false",
              },
            },
            required: ["title", "content"],
          },
        },
        {
          name: "mediawiki_delete_article",
          description:
            "Delete an article from the MediaWiki instance. Requires appropriate permissions.",
          inputSchema: {
            type: "object",
            properties: {
              title: {
                type: "string",
                description: "Title of the article to delete",
              },
              reason: {
                type: "string",
                description: "Reason for deletion",
              },
            },
            required: ["title"],
          },
        },
        {
          name: "mediawiki_get_article",
          description:
            "Get the current content of an article from the MediaWiki instance.",
          inputSchema: {
            type: "object",
            properties: {
              title: {
                type: "string",
                description: "Title of the article to retrieve",
              },
            },
            required: ["title"],
          },
        },
        {
          name: "mediawiki_search",
          description:
            "Search for articles on the MediaWiki instance.",
          inputSchema: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: "Search query",
              },
              limit: {
                type: "number",
                description: "Maximum number of results to return (default: 10)",
              },
            },
            required: ["query"],
          },
        },
      ],
    }))

    this.server.setRequestHandler(CallToolRequestSchema, async request => {
      const {name, arguments: args} = request.params

      try {
        switch(name) {
          case "mediawiki_create_article": {
            await this.#assureClient()

            const result = await this.#client.post("api.php", {
              action: "edit",
              title: args.title,
              text: args.content,
              summary: args.summary || "Created via MediaWiki MCP",
              createonly: "true",
              format: "json"
            })

            if(result.edit?.result === "Success") {
              return {
                content: [
                  {
                    type: "text",
                    text: `✓ Successfully created article "${args.title}"\nRevision ID: ${result.edit.newrevid}\nTimestamp: ${result.edit.newtimestamp}`,
                  },
                ],
              }
            } else {
              throw new Error(`Edit failed: ${JSON.stringify(result)}`)
            }
          }

          case "mediawiki_edit_article": {
            await this.#assureClient()

            const editParams = {
              action: "edit",
              title: args.title,
              summary: args.summary || "Edited via MediaWiki MCP",
              format: "json"
            }

            if(args.append) {
              editParams.appendtext = args.content
            } else if(args.prepend) {
              editParams.prependtext = args.content
            } else {
              editParams.text = args.content
            }

            const result = await this.#client.post("api.php", editParams)

            if(result.edit?.result === "Success") {
              const action = result.edit.new ? "created" : "edited"

              return {
                content: [
                  {
                    type: "text",
                    text: `✓ Successfully ${action} article "${args.title}"\nRevision ID: ${result.edit.newrevid}\nTimestamp: ${result.edit.newtimestamp}`,
                  },
                ],
              }
            } else {
              throw new Error(`Edit failed: ${JSON.stringify(result)}`)
            }
          }

          case "mediawiki_delete_article": {
            await this.#assureClient()

            const result = await this.#client.post("api.php", {
              action: "delete",
              title: args.title,
              reason: args.reason || "Deleted via MediaWiki MCP",
              format: "json"
            })

            if(result.delete) {
              return {
                content: [
                  {
                    type: "text",
                    text: `✓ Successfully deleted article "${args.title}"\nReason: ${args.reason || "Deleted via MediaWiki MCP"}`,
                  },
                ],
              }
            } else {
              throw new Error(`Delete failed: ${JSON.stringify(result)}`)
            }
          }

          case "mediawiki_get_article": {
            await this.#assureClient()

            const data = await this.#client.get("api.php", {
              action: "query",
              titles: args.title,
              prop: "revisions",
              rvprop: "content",
              rvslots: "main",
              format: "json"
            })

            const pages = data.query.pages
            const pageId = Object.keys(pages)[0]
            const page = pages[pageId]

            if(page.missing) {
              return {
                content: [
                  {
                    type: "text",
                    text: `Article "${args.title}" does not exist.`,
                  },
                ],
              }
            }

            const content = page.revisions[0].slots.main["*"]

            return {
              content: [
                {
                  type: "text",
                  text: `Content of "${args.title}":\n\n${content}`,
                },
              ],
            }
          }

          case "mediawiki_search": {
            await this.#assureClient()

            const limit = args.limit || 10

            const data = await this.#client.get("api.php", {
              action: "query",
              list: "search",
              srsearch: args.query,
              srlimit: limit,
              format: "json"
            })

            const results = data.query.search

            if(results.length === 0) {
              return {
                content: [
                  {
                    type: "text",
                    text: `No results found for "${args.query}".`,
                  },
                ],
              }
            }

            const formatted = results.map((r, i) =>
              `${i + 1}. ${r.title}\n   Snippet: ${r.snippet.replace(/<[^>]+>/g, "")}`
            ).join("\n\n")

            return {
              content: [
                {
                  type: "text",
                  text: `Found ${results.length} result(s) for "${args.query}":\n\n${formatted}`,
                },
              ],
            }
          }

          default:
            throw new Error(`Unknown tool: ${name}`)
        }
      } catch(error) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${error.message}`,
            },
          ],
          isError: true,
        }
      }
    })
  }

  async run() {
    const transport = new StdioServerTransport()
    await this.server.connect(transport)

    console.error("MediaWiki MCP Server running on stdio")
  }
}

const server = new MediaWikiMCPServer()
server.run().catch(console.error)
