import { Component, type ReactNode } from 'react'

export class TabBoundary extends Component<{ children: ReactNode }, { reason: string }> {
  state = { reason: '' }

  static getDerivedStateFromError(error: unknown): { reason: string } {
    const reason = error instanceof Error && error.message ? error.message : 'Unknown error'
    return { reason }
  }

  render() {
    if (this.state.reason) return <p className="save-off" role="alert">This view could not load: {this.state.reason}</p>
    return this.props.children
  }
}
