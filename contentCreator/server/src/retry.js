/**
 * Retry helper for transient quota / rate-limit errors with exponential backoff.
 * Provider-agnostic: matches Gemini (RESOURCE_EXHAUSTED / 429) and
 * OpenAI (status===429, code "rate_limit_exceeded" / "insufficient_quota").
 */
export async function withRetry(apiCall, maxRetries = 5) {
  let lastError = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await apiCall();
    } catch (error) {
      lastError = error;

      if (isQuotaError(error)) {
        if (attempt < maxRetries - 1) {
          const delay = Math.pow(2, attempt) * 15000 + Math.random() * 5000;
          console.warn(
            `[llm] quota/rate-limit error, retrying ${attempt + 1}/${maxRetries} in ${Math.round(
              delay / 1000,
            )}s`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
      }
      throw error;
    }
  }
  throw lastError;
}

export function isQuotaError(error) {
  if (!error) return false;

  // OpenAI SDK errors expose `status` and `code` on the thrown object.
  if (typeof error.status === "number" && error.status === 429) return true;
  const code = error.code || error?.error?.code;
  if (
    code === "rate_limit_exceeded" ||
    code === "insufficient_quota" ||
    code === "RESOURCE_EXHAUSTED"
  ) {
    return true;
  }

  // Fallback: stringify and pattern-match (covers Gemini + assorted shapes).
  let errorString = "";
  try {
    errorString =
      typeof error === "object" && error !== null ? JSON.stringify(error) : String(error);
  } catch {
    errorString = String(error?.message || error || "");
  }
  if (
    errorString.includes("RESOURCE_EXHAUSTED") ||
    errorString.includes("rate_limit_exceeded") ||
    errorString.includes("insufficient_quota") ||
    /\b429\b/.test(errorString)
  ) {
    return true;
  }
  return false;
}
