import { describe, it, expect } from 'vitest'
import { AxiosError } from 'axios'
import { extractErrorMessage } from './extractErrorMessage'

function makeAxiosError(responseData?: Record<string, unknown>, message?: string): AxiosError {
  const error = new AxiosError(message || 'Request failed')
  if (responseData) {
    error.response = {
      data: responseData,
      status: 400,
      statusText: 'Bad Request',
      headers: {},
      config: {} as never,
    }
  }
  return error
}

describe('extractErrorMessage', () => {
  it('extracts detail from Axios error response', () => {
    const err = makeAxiosError({ detail: 'Term not found' })
    expect(extractErrorMessage(err)).toBe('Term not found')
  })

  it('extracts message from Axios error response', () => {
    const err = makeAxiosError({ message: 'Validation failed' })
    expect(extractErrorMessage(err)).toBe('Validation failed')
  })

  it('prefers detail over message', () => {
    const err = makeAxiosError({ detail: 'Specific error', message: 'Generic error' })
    expect(extractErrorMessage(err)).toBe('Specific error')
  })

  it('falls back to Axios error message', () => {
    const err = makeAxiosError(undefined, 'Network Error')
    expect(extractErrorMessage(err)).toBe('Network Error')
  })

  it('handles standard Error objects', () => {
    const err = new Error('Something broke')
    expect(extractErrorMessage(err)).toBe('Something broke')
  })

  it('handles string errors', () => {
    expect(extractErrorMessage('Connection lost')).toBe('Connection lost')
  })

  it('returns fallback for unknown error types', () => {
    expect(extractErrorMessage(42)).toBe('An unexpected error occurred')
    expect(extractErrorMessage(null)).toBe('An unexpected error occurred')
    expect(extractErrorMessage(undefined)).toBe('An unexpected error occurred')
  })

  it('accepts custom fallback message', () => {
    expect(extractErrorMessage(null, 'Import failed')).toBe('Import failed')
  })

  it('ignores empty detail string', () => {
    const err = makeAxiosError({ detail: '' })
    expect(extractErrorMessage(err)).toBe('Request failed')
  })

  it('ignores non-string detail', () => {
    const err = makeAxiosError({ detail: 123 })
    expect(extractErrorMessage(err)).toBe('Request failed')
  })
})
