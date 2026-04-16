import React from 'react'

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export default class ErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('ErrorBoundary caught:', error, errorInfo)
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null })
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-parchment-50 dark:bg-ink-950 font-body">
          <div className="max-w-md text-center p-8">
            <h1 className="text-2xl font-bold text-ink-850 dark:text-cream font-heading mb-2">Something went wrong</h1>
            <p className="text-sm text-parchment-500 dark:text-cream-muted mb-6">
              {this.state.error?.message || 'An unexpected error occurred while rendering the page.'}
            </p>
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={this.handleReset}
                className="px-4 py-2 bg-gold text-ink-950 rounded-md text-sm font-semibold hover:bg-gold-light transition-colors"
              >
                Try Again
              </button>
              <button
                onClick={() => { window.location.href = '/books' }}
                className="px-4 py-2 border border-parchment-300 dark:border-ink-600 text-parchment-500 dark:text-cream-muted rounded-md text-sm hover:bg-parchment-100 dark:hover:bg-ink-700 transition-colors"
              >
                Go to Library
              </button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
