import { Component, type ReactNode } from 'react';

export function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    return false;
  }
}

interface Props {
  children: ReactNode;
}

/** Catches render/WebGL failures in the 3D view so the UI around it keeps working. */
export class SceneBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.warn('3D view failed:', error);
  }

  render() {
    if (this.state.error || !hasWebGL()) {
      return (
        <div className="scene-fallback" role="alert">
          <h2>3D view unavailable</h2>
          <p>
            {this.state.error
              ? 'The 3D view crashed. The fleet keeps running; reload to try again.'
              : 'Your browser has WebGL disabled or unsupported. The fleet keeps running and the panels still work; enable hardware acceleration to see the battlefield.'}
          </p>
          {this.state.error && <button onClick={() => location.reload()}>Reload</button>}
        </div>
      );
    }
    return this.props.children;
  }
}
