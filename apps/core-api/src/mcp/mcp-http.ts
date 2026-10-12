import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Request, Response } from "express";

const logger = new Logger("Mcp");

/**
 * Stateless Streamable HTTP: a fresh McpServer + transport per request, no
 * Mcp-Session-Id, nothing held in memory between requests. Every request
 * carries its own credentials and the server is rebuilt around that
 * request's verified actor (the tools close over it), so any core-api
 * instance can serve any request and no tool can ever run with another
 * request's identity. enableJsonResponse returns a plain JSON body instead
 * of an SSE stream — none of these tools stream progress.
 */
export async function serveMcpRequest(req: Request, res: Response, server: McpServer): Promise<void> {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}

export function newMcpServer(name: string): McpServer {
  return new McpServer({ name, version: "1.0.0" }, { capabilities: { tools: {} } });
}

/**
 * Error codes ai-service maps to its own ToolOutcome states (see
 * apps/ai-service/app/infrastructure/tools/mcp/adapter.py). `internal` is
 * the only one ai-service can't treat as "definitely not applied" for a
 * mutation — anything else means the command rejected the input before
 * writing.
 */
export type ToolErrorCode = "not_found" | "invalid_argument" | "forbidden" | "conflict" | "internal";

export function toolOk(data: Record<string, unknown>): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data };
}

export function toolError(code: ToolErrorCode, message: string): CallToolResult {
  const body = { error_code: code, message };
  return { content: [{ type: "text", text: JSON.stringify(body) }], structuredContent: body, isError: true };
}

/**
 * Runs a tool body and turns Nest's HTTP exceptions (what every existing
 * service already throws) into a tool-level error result rather than a
 * JSON-RPC error — the model gets a readable reason and the agent loop gets
 * a machine-readable code. Unexpected errors are logged in full here and
 * reported to the caller only as `internal`, never with a stack trace or a
 * raw database message.
 */
export async function runTool(
  name: string,
  body: () => Promise<Record<string, unknown>>,
): Promise<CallToolResult> {
  try {
    return toolOk(await body());
  } catch (err) {
    if (err instanceof NotFoundException) return toolError("not_found", err.message);
    if (err instanceof BadRequestException) return toolError("invalid_argument", err.message);
    if (err instanceof ForbiddenException) return toolError("forbidden", err.message);
    if (err instanceof ConflictException) return toolError("conflict", err.message);
    if (err instanceof HttpException) return toolError("invalid_argument", err.message);
    logger.error(`tool ${name} failed`, err instanceof Error ? err.stack : String(err));
    return toolError("internal", "The tool failed unexpectedly");
  }
}
