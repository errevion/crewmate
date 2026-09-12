/**
 * In-flight secret redaction utility to prevent sensitive credentials
 * from being stored in persistent project memory.
 */

const REDACTION_PATTERNS: Array<{ regex: RegExp; placeholder: string }> = [
  // Private keys (PEM format)
  {
    regex: /-----BEGIN [A-Z ]+ PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+ PRIVATE KEY-----/g,
    placeholder: '[REDACTED:PRIVATE_KEY]',
  },
  // OpenAI / Anthropic / Generic API keys (sk-...)
  {
    regex: /\b(sk-[A-Za-z0-9_-]{20,})\b/g,
    placeholder: '[REDACTED:API_KEY]',
  },
  // GitHub PATs (classic & fine-grained)
  {
    regex: /\b(gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{40,})\b/g,
    placeholder: '[REDACTED:GITHUB_TOKEN]',
  },
  // AWS Access Key IDs
  {
    regex: /\b(AKIA[0-9A-Z]{16})\b/g,
    placeholder: '[REDACTED:AWS_KEY]',
  },
  // Google API Keys
  {
    regex: /\b(AIza[0-9A-Za-z-_]{35})\b/g,
    placeholder: '[REDACTED:GOOGLE_KEY]',
  },
  // Slack Tokens
  {
    regex: /\b(xox[baprs]-[0-9A-Za-z-]{10,})\b/g,
    placeholder: '[REDACTED:SLACK_TOKEN]',
  },
  // Stripe API Keys
  {
    regex: /\b(sk_live_[0-9a-zA-Z]{24})\b/g,
    placeholder: '[REDACTED:STRIPE_KEY]',
  },
  // JSON Web Tokens (JWT)
  {
    regex: /\b(eyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*)\b/g,
    placeholder: '[REDACTED:JWT]',
  },
  // Generic Bearer Tokens
  {
    regex: /\bBearer\s+([A-Za-z0-9\-._~+/]{20,}=*)/gi,
    placeholder: 'Bearer [REDACTED:BEARER_TOKEN]',
  },
];

/**
 * Scrubs known secret and credential patterns from text before persistence.
 * Can be bypassed for testing if process.env.CREWMATE_NO_REDACT is set to '1'.
 */
export function redactSecrets(text: string): string {
  if (!text || typeof text !== 'string') {
    return text;
  }
  if (process.env.CREWMATE_NO_REDACT === '1') {
    return text;
  }

  let sanitized = text;
  for (const { regex, placeholder } of REDACTION_PATTERNS) {
    sanitized = sanitized.replace(regex, placeholder);
  }
  return sanitized;
}
