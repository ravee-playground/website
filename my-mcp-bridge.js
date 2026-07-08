import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

// 1. Initialize the MCP Server
const server = new Server(
  { name: "docs-search-bridge", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// 2. Tell Cursor what tools are available and what arguments they take
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "search_documentation",
        description: "Searches the documentation database for a given query.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The search term or phrase to look up in the docs."
            }
          },
          required: ["query"]
        }
      }
    ]
  };
});

// 3. Handle the execution when Cursor calls the tool
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "search_documentation") {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }

  const query = request.params.arguments?.query;

  try {
    // Exactly replicating your successful curl request
    const response = await fetch("https://mcp.thetechnicalwriter.com/tools/search_documentation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: query })
    });

    if (!response.ok) {
      return {
        content: [{ type: "text", text: `API Error: Server responded with status ${response.status}` }],
        isError: true
      };
    }

    const data = await response.text(); // or response.json() depending on what your API outputs

    // Return the results back to Cursor
    return {
      content: [{ type: "text", text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }]
    };

  } catch (error) {
    return {
      content: [{ type: "text", text: `Bridge connection error: ${error.message}` }],
      isError: true
    };
  }
});

// 4. Connect using Standard Input/Output (stdio)
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("MCP Bridge Server running on stdio");
