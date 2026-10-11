#!/usr/bin/env node

import Wikid from "@gesslar/wikid"
import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js"
import {StdioServerTransport} from "@modelcontextprotocol/sdk/server/stdio.js"
import * as z from "zod/v4"
import pkg from "../package.json" with {type: "json"}

// Section numbers also accept digit strings, for clients that send "2"
// instead of 2.
const sectionNumber = z.union([
  z.number().int().min(0),
  z.string().regex(/^\d+$/).transform(Number),
])

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

      const loginResult = await client.login()

      if(!loginResult.ok)
        throw new Error(`Login failed: ${loginResult.error?.message ?? "unknown error"}`)

      this.#client = client
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
        "Edit an existing article on the MediaWiki instance. Creates the article if it does not already exist. " +
        "Pass `section` to edit a single section instead of the whole page; use mediawiki_get_sections to find section numbers.",
      inputSchema: z.object({
        title: z.string().describe("Title of the article to edit"),
        content: z.string().describe(
          "Wikitext to write. By default it replaces the whole page. " +
          "With a numbered `section`, it replaces that section and must include the section's heading line. " +
          "With `section: \"new\"`, it is the new section's body; the heading comes from `sectiontitle`. " +
          "With `append` or `prepend`, it is only the text to add."
        ),
        summary: z.string().optional().describe("Edit summary (reason for the edit)"),
        append: z.boolean().optional().describe("If true, append content instead of replacing. Default: false"),
        prepend: z.boolean().optional().describe("If true, prepend content instead of replacing. Default: false"),
        section: z.union([sectionNumber, z.literal("new")]).optional()
          .describe("Section to edit: 0 for the lead, 1+ for numbered sections, or \"new\" to add a new section at the end. Omit to edit the whole page"),
        sectiontitle: z.string().optional().describe("Heading for the new section when `section` is \"new\""),
      }),
    }, async({
      title, content, summary, append, prepend, section, sectiontitle
    }) => {
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

        if(section !== undefined)
          editParams.section = String(section)

        if(sectiontitle)
          editParams.sectiontitle = sectiontitle

        const result = await this.#client.post("api.php", editParams)

        if(result.edit?.result !== "Success")
          throw new Error(`Edit failed: ${JSON.stringify(result)}`)

        const where = section === undefined ? "" : ` (section ${section})`

        if("nochange" in result.edit) {
          return {
            content: [
              {
                type: "text",
                text: `✓ No change to article "${title}"${where}; content was identical, so no revision was made`,
              },
            ],
          }
        }

        const action = result.edit.new ? "created" : "edited"

        return {
          content: [
            {
              type: "text",
              text: `✓ Successfully ${action} article "${title}"${where}\nRevision ID: ${result.edit.newrevid}\nTimestamp: ${result.edit.newtimestamp}`,
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
        "Get the current content of an article from the MediaWiki instance, optionally just one section.",
      inputSchema: z.object({
        title: z.string().describe("Title of the article to retrieve"),
        section: sectionNumber.optional()
          .describe("Section number to retrieve (0 for the lead). Omit for the whole page"),
      }),
    }, async({title, section}) => {
      try {
        await this.#assureClient()

        const params = {
          action: "query",
          titles: title,
          prop: "revisions",
          rvprop: "content",
          rvslots: "main",
          format: "json"
        }

        if(section !== undefined)
          params.rvsection = section

        const data = await this.#client.get("api.php", params)

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

        const slot = page.revisions?.[0]?.slots?.main

        if(slot && "nosuchsection" in slot)
          throw new Error(`Article "${title}" has no section ${section}.`)

        const content = slot?.["*"] ?? ""

        if(!content) {
          return {
            content: [
              {
                type: "text",
                text: `Article "${title}" exists but has no readable content.`,
              },
            ],
          }
        }

        return {
          content: [
            {
              type: "text",
              text: `Content of "${title}"${section === undefined ? "" : ` (section ${section})`}:\n\n${content}`,
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

    this.server.registerTool("mediawiki_get_sections", {
      description:
        "List the sections of an article with their numbers, for use with the `section` parameter of mediawiki_get_article and mediawiki_edit_article.",
      inputSchema: z.object({
        title: z.string().describe("Title of the article"),
      }),
    }, async({title}) => {
      try {
        await this.#assureClient()

        const data = await this.#client.get("api.php", {
          action: "parse",
          page: title,
          prop: "sections",
          format: "json"
        })

        if(!data.parse)
          throw new Error(`Parse failed: ${JSON.stringify(data)}`)

        // Sections pulled in from templates (index "T-n") cannot be edited
        // through this page.
        const sections = data.parse.sections.filter(s => /^\d+$/.test(s.index))

        if(sections.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `Article "${title}" has no sections; only section 0 (the whole page) exists.`,
              },
            ],
          }
        }

        const formatted = sections.map(s =>
          `${s.index}. ${"  ".repeat(Math.max(0, Number(s.level) - 2))}${s.line}`
        ).join("\n")

        return {
          content: [
            {
              type: "text",
              text: `Sections of "${title}" (0 is the lead before the first heading):\n\n${formatted}`,
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

        const stripTags = s => {
          let prev
          let curr = s

          do {
            prev = curr
            curr = curr.replace(/<[^<>]*>/g, "")
          } while(curr !== prev)

          return curr
        }

        const formatted = results.map((r, i) =>
          `${i + 1}. ${r.title}\n   Snippet: ${stripTags(r.snippet)}`
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
