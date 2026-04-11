export interface McpRequestOptions {
  userId: string;
  scopes?: string[];
}

export declare function handleMcpRequest(
  req: Request,
  options: McpRequestOptions,
): Promise<Response>;

export declare function unauthorizedResponse(baseUrl: string): Response;
