const CLAUDE_AUTHENTICATION_ERROR =
  /(?:failed to authenticate|oauth[^\n]*(?:expired|refresh)|authentication[^\n]*(?:expired|failed)|not logged in)/i;

/** Authentication is an interactive CLI concern, not a generic ACP failure.
 * Keep this deliberately narrow so ordinary model output and provider errors
 * never acquire a misleading login action. */
export function needsInteractiveAgentLogin(agentId: string, error: string | undefined): boolean {
  return agentId === "claude" && Boolean(error && CLAUDE_AUTHENTICATION_ERROR.test(error));
}

export function authenticationErrorSummary(error: string): string {
  return error.replace(/^internal error:\s*/i, "").trim();
}
