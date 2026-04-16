import axios from 'axios'

/**
 * Extract a human-readable error message from an unknown error value.
 * Handles Axios errors (with FastAPI's `detail` field), standard Errors, and strings.
 */
export function extractErrorMessage(err: unknown, fallback = 'An unexpected error occurred'): string {
  if (axios.isAxiosError(err)) {
    const detail = err.response?.data?.detail
    if (typeof detail === 'string' && detail.length > 0) return detail
    const message = err.response?.data?.message
    if (typeof message === 'string' && message.length > 0) return message
    if (err.message) return err.message
  }

  if (err instanceof Error) return err.message

  if (typeof err === 'string' && err.length > 0) return err

  return fallback
}
