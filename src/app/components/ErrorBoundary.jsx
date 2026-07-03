
import React from 'react';
import { Button } from '@/components/ui/button';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { 
      hasError: false, 
      error: null, 
      errorInfo: null,
      retryCount: 0 
    };
  }

  static getDerivedStateFromError(error) {
    // Update state so the next render will show the fallback UI
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    // Log the error details
    console.error('Error Boundary caught an error:', error);
    console.error('Error Info:', errorInfo);

    // Store error details in state
    this.setState({
      error: error,
      errorInfo: errorInfo
    });

    // Check if this is the React #130 error
    const isReactError130 = error.message?.includes('Minified React error #130') ||
                           error.stack?.includes('130');
    
    if (isReactError130) {
      console.error('React Error #130 detected - likely auth state/promise issue');
      
      // Try to recover from auth-related errors
      if (typeof window !== 'undefined') {
        // Clear any corrupted localStorage data
        try {
          const supabaseKeys = Object.keys(localStorage).filter(key => 
            key.startsWith('supabase.auth') || key.startsWith('sb-')
          );
          supabaseKeys.forEach(key => localStorage.removeItem(key));
          console.log('Cleared Supabase session data');
        } catch (e) {
          console.warn('Could not clear localStorage:', e);
        }
      }
    }

    // Report to error tracking service if available
    if (typeof window !== 'undefined' && window.gtag) {
      window.gtag('event', 'exception', {
        description: error.message,
        fatal: true
      });
    }
  }

  handleRetry = () => {
    this.setState(prevState => ({
      hasError: false,
      error: null,
      errorInfo: null,
      retryCount: prevState.retryCount + 1
    }));
  };

  handleReload = () => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  render() {
    if (this.state.hasError) {
      const { error, retryCount } = this.state;
      const isReactError130 = error?.message?.includes('Minified React error #130');
      
      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-6 text-center">
            <div className="mb-4">
              <div className="mx-auto w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <h1 className="text-xl font-semibold text-gray-900 mb-2">
                Something went wrong
              </h1>
              <p className="text-gray-600 mb-4">
                {isReactError130 
                  ? "Authentication error detected. This usually resolves with a page refresh."
                  : "An unexpected error occurred. Please try again."
                }
              </p>
            </div>

            <div className="space-y-3">
              {retryCount < 2 && (
                <Button 
                  onClick={this.handleRetry}
                  className="w-full"
                >
                  Try Again
                </Button>
              )}
              
              <Button 
                onClick={this.handleReload}
                variant="outline"
                className="w-full"
              >
                Reload Page
              </Button>
              
              <Button 
                onClick={() => window.location.href = '/login'}
                variant="ghost"
                className="w-full text-sm"
              >
                Return to Login
              </Button>
            </div>

            {process.env.NODE_ENV === 'development' && error && (
              <details className="mt-4 text-left">
                <summary className="text-sm text-gray-500 cursor-pointer">
                  Error Details (Development)
                </summary>
                <pre className="mt-2 text-xs bg-gray-100 p-2 rounded overflow-auto max-h-32">
                  {error.message}
                  {error.stack}
                </pre>
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
