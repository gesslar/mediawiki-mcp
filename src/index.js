#!/usr/bin/env node

import Wikid from "@gesslar/wikid"
import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js"
import {StdioServerTransport} from "@modelcontextprotocol/sdk/server/stdio.js"
import * as z from "zod/v4"
import pkg from "../package.json" with {type: "json"}

class MediaWikiMCPServer {
  #client

  constructor() {
    this.server = new McpServer(
      {
        name: "mediawiki-mcp-server",
        version: pkg.version,
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

    this.setupTools()
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

  setupTools() {
    this.server.registerTool("mediawiki_create_article", {
      description:
        "Create a new article on the MediaWiki instance. Will fail if the article already exists.",
      inputSchema: z.object({
        title: z.string().describe("Title of the article to create"),
        content: z.string().describe("Wikitext content for the article"),
        summary: z.string().optional().describe("Edit summary (reason for creating the article)"),
      }),
    }, async({title, content, summary}) => {
      try {
        await this.#assureClient()

        const result = await this.#client.post("api.php", {
          action: "edit",
          title,
          text: content,
          summary: summary || "Created via MediaWiki MCP",
          createonly: "true",
          format: "json"
        })

        if(result.edit?.result !== "Success")
          throw new Error(`Edit failed: ${JSON.stringify(result)}`)

        return {
          content: [
            {
              type: "text",
              text: `✓ Successfully created article "${title}"\nRevision ID: ${result.edit.newrevid}\nTimestamp: ${result.edit.newtimestamp}`,
            },
          ],
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

    this.server.registerTool("mediawiki_edit_article", {
      description:
        "Edit an existing article on the MediaWiki instance. Can create a new article if it doesn't exist (use createonly=false).",
      inputSchema: z.object({
        title: z.string().describe("Title of the article to edit"),
        content: z.string().describe("New wikitext content for the article"),
        summary: z.string().optional().describe("Edit summary (reason for the edit)"),
        append: z.boolean().optional().describe("If true, append content instead of replacing. Default: false"),
        prepend: z.boolean().optional().describe("If true, prepend content instead of replacing. Default: false"),
      }),
    }, async({title, content, summary, append, prepend}) => {
      try {
        await this.#assureClient()

        const editParams = {
          action: "edit",
          title,
          summary: summary || "Edited via MediaWiki MCP",
          format: "json"
        }

        if(append)
          editParams.appendtext = content
        else if(prepend)
          editParams.prependtext = content
        else
          editParams.text = content

        const result = await this.#client.post("api.php", editParams)

        if(result.edit?.result !== "Success")
          throw new Error(`Edit failed: ${JSON.stringify(result)}`)

        const action = result.edit.new ? "created" : "edited"

        return {
          content: [
            {
              type: "text",
              text: `✓ Successfully ${action} article "${title}"\nRevision ID: ${result.edit.newrevid}\nTimestamp: ${result.edit.newtimestamp}`,
            },
          ],
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

    this.server.registerTool("mediawiki_delete_article", {
      description:
        "Delete an article from the MediaWiki instance. Requires appropriate permissions.",
      inputSchema: z.object({
        title: z.string().describe("Title of the article to delete"),
        reason: z.string().optional().describe("Reason for deletion"),
      }),
    }, async({title, reason}) => {
      try {
        await this.#assureClient()

        const deleteReason = reason || "Deleted via MediaWiki MCP"
        const result = await this.#client.post("api.php", {
          action: "delete",
          title,
          reason: deleteReason,
          format: "json"
        })

        if(!result.delete)
          throw new Error(`Delete failed: ${JSON.stringify(result)}`)

        return {
          content: [
            {
              type: "text",
              text: `✓ Successfully deleted article "${title}"\nReason: ${deleteReason}`,
            },
          ],
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

    this.server.registerTool("mediawiki_get_article", {
      description:
        "Get the current content of an article from the MediaWiki instance.",
      inputSchema: z.object({
        title: z.string().describe("Title of the article to retrieve"),
      }),
    }, async({title}) => {
      try {
        await this.#assureClient()

        const data = await this.#client.get("api.php", {
          action: "query",
          titles: title,
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
                text: `Article "${title}" does not exist.`,
              },
            ],
          }
        }

        const content = page.revisions[0].slots.main["*"]

        return {
          content: [
            {
              type: "text",
              text: `Content of "${title}":\n\n${content}`,
            },
          ],
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

    this.server.registerTool("mediawiki_search", {
      description: "Search for articles on the MediaWiki instance.",
      inputSchema: z.object({
        query: z.string().describe("Search query"),
        limit: z.number().optional().describe("Maximum number of results to return (default: 10)"),
      }),
    }, async({query, limit}) => {
      try {
        await this.#assureClient()

        const data = await this.#client.get("api.php", {
          action: "query",
          list: "search",
          srsearch: query,
          srlimit: limit || 10,
          format: "json"
        })

        const results = data.query.search

        if(results.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No results found for "${query}".`,
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
              text: `Found ${results.length} result(s) for "${query}":\n\n${formatted}`,
            },
          ],
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
