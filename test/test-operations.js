#!/usr/bin/env node

/**
 * Test script for mediawiki-mcp operations
 *
 * Tests: login, search, create article, delete article
 *
 * Usage:
 *   node test/test-operations.js
 *
 * Required environment variables:
 *   MEDIAWIKI_URL - Base URL of your MediaWiki instance
 *   MEDIAWIKI_BOT_USERNAME - Bot account username
 *   MEDIAWIKI_BOT_PASSWORD - Bot account password
 */

import Wikid from "@gesslar/wikid"

// Test configuration
const TEST_ARTICLE_TITLE = "Gesslar"
const TEST_ARTICLE_CONTENT = "This is a test article created by the mediawiki-mcp test suite.\n\n== Testing ==\n\nThis article will be deleted shortly."

/**
 *
 */
async function runTests() {
  console.log("=".repeat(60))
  console.log("MediaWiki MCP Operations Test")
  console.log("=".repeat(60))
  console.log()

  // Check environment variables
  const wikiUrl = process.env.MEDIAWIKI_URL
  const botUsername = process.env.MEDIAWIKI_BOT_USERNAME
  const botPassword = process.env.MEDIAWIKI_BOT_PASSWORD

  if(!wikiUrl || !botUsername || !botPassword) {
    console.error("❌ Error: Missing required environment variables:")
    console.error("   MEDIAWIKI_URL")
    console.error("   MEDIAWIKI_BOT_USERNAME")
    console.error("   MEDIAWIKI_BOT_PASSWORD")
    process.exit(1)
  }

  console.log(`🌐 Wiki URL: ${wikiUrl}`)
  console.log(`👤 Bot user: ${botUsername}`)
  console.log()

  try {
    // Test 1: Create client and login
    console.log("📝 Test 1: Login")
    console.log("-".repeat(60))

    const client = new Wikid({
      baseUrl: wikiUrl,
      botUsername: botUsername,
      botPassword: botPassword,
      private: true
    })

    const loginResult = await client.login()

    if(loginResult.ok) {
      console.log("✅ Login successful")
    } else {
      throw new Error(`Login failed: ${loginResult.error?.message}`)
    }
    console.log()

    // Test 2: Search for "Gesslar"
    console.log("📝 Test 2: Search for 'Gesslar'")
    console.log("-".repeat(60))

    const searchData = await client.get("api.php", {
      action: "query",
      list: "search",
      srsearch: TEST_ARTICLE_TITLE,
      srlimit: 5,
      format: "json"
    })

    const searchResults = searchData.query.search
    console.log(`🔍 Found ${searchResults.length} result(s)`)

    if(searchResults.length > 0) {
      searchResults.forEach((result, i) => {
        console.log(`   ${i + 1}. ${result.title}`)
      })
    }
    console.log()

    // Test 3: Create article "Gesslar"
    console.log("📝 Test 3: Create article 'Gesslar'")
    console.log("-".repeat(60))

    try {
      const createResult = await client.post("api.php", {
        action: "edit",
        title: TEST_ARTICLE_TITLE,
        text: TEST_ARTICLE_CONTENT,
        summary: "Test article created by mediawiki-mcp test suite",
        createonly: "true",
        format: "json"
      })

      if(createResult.edit?.result === "Success") {
        console.log(`✅ Article created successfully`)
        console.log(`   Revision ID: ${createResult.edit.newrevid}`)
        console.log(`   Timestamp: ${createResult.edit.newtimestamp}`)
      } else if(createResult.error?.code === "articleexists") {
        console.log(`ℹ️  Article already exists (this is expected if re-running)`)
      } else {
        throw new Error(`Create failed: ${JSON.stringify(createResult)}`)
      }
    } catch(error) {
      if(error.message.includes("articleexists")) {
        console.log(`ℹ️  Article already exists (this is expected if re-running)`)
      } else {
        throw error
      }
    }
    console.log()

    // Test 4: Delete article "Gesslar"
    console.log("📝 Test 4: Delete article 'Gesslar'")
    console.log("-".repeat(60))

    try {
      const deleteResult = await client.post("api.php", {
        action: "delete",
        title: TEST_ARTICLE_TITLE,
        reason: "Test cleanup - article created by mediawiki-mcp test suite",
        format: "json"
      })

      if(deleteResult.delete) {
        console.log(`✅ Article deleted successfully`)
        console.log(`   Title: ${deleteResult.delete.title}`)
        console.log(`   Reason: Test cleanup`)
      } else if(deleteResult.error?.code === "missingtitle") {
        console.log(`ℹ️  Article doesn't exist (may have been deleted already)`)
      } else {
        throw new Error(`Delete failed: ${JSON.stringify(deleteResult)}`)
      }
    } catch(error) {
      if(error.message.includes("missingtitle")) {
        console.log(`ℹ️  Article doesn't exist (may have been deleted already)`)
      } else {
        throw error
      }
    }
    console.log()

    // Summary
    console.log("=".repeat(60))
    console.log("✅ All tests completed successfully!")
    console.log("=".repeat(60))

  } catch(error) {
    console.error()
    console.error("=".repeat(60))
    console.error("❌ Test failed:")
    console.error("=".repeat(60))
    console.error(error.message)
    console.error()
    if(error.stack) {
      console.error("Stack trace:")
      console.error(error.stack)
    }
    process.exit(1)
  }
}

// Run tests
runTests()
