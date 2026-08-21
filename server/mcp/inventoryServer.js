import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { inventory, shipments, customerArr, customerPayments } from './data.js';

const TOOLS = [
  {
    name: 'get_inventory_details',
    description: 'Get current inventory details: SKUs, quantities on hand, reorder levels, and warehouse locations.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_last_5_shipments',
    description: 'Get the 5 most recent outbound shipments with carrier, status, destination, and tracking numbers.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_customer_arr',
    description: 'Get customer Annual Recurring Revenue (ARR) with segment, renewal date, and account health.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_customer_payment_details',
    description: 'Get customer payment details: invoices, amounts, payment method, and status.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

let mcpClient = null;

/** Stand up the in-process Inventory MCP server and a linked client. */
export async function initMcp() {
  const server = new Server(
    { name: 'inventory-mcp', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name } = req.params;
    let payload;
    if (name === 'get_inventory_details') {
      payload = { generatedAt: new Date().toISOString(), count: inventory.length, items: inventory };
    } else if (name === 'get_last_5_shipments') {
      payload = { generatedAt: new Date().toISOString(), count: shipments.length, shipments };
    } else if (name === 'get_customer_arr') {
      payload = { generatedAt: new Date().toISOString(), count: customerArr.length, customers: customerArr };
    } else if (name === 'get_customer_payment_details') {
      payload = { generatedAt: new Date().toISOString(), count: customerPayments.length, payments: customerPayments };
    } else {
      throw new Error(`Unknown tool: ${name}`);
    }
    return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
  });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  mcpClient = new Client({ name: 'xaa-agent', version: '1.0.0' }, { capabilities: {} });
  await mcpClient.connect(clientTransport);
  console.log('✓ Inventory MCP server ready (tools: get_inventory_details, get_last_5_shipments)');
}

export function listToolDefs() {
  return TOOLS;
}

export async function callMcpTool(name, args = {}) {
  if (!mcpClient) throw new Error('MCP client not initialized');
  const result = await mcpClient.callTool({ name, arguments: args });
  // Tools return JSON-encoded text content; parse it back for the UI.
  const text = result?.content?.[0]?.text;
  try {
    return JSON.parse(text);
  } catch {
    return result;
  }
}
