import React from 'react';
import { RefreshCw, ShieldAlert } from 'lucide-react';

interface AppErrorBoundaryProps {
  children: React.ReactNode;
}

interface AppErrorBoundaryState {
  hasError: boolean;
  recoveryAttempts: number;
}

export class AppErrorBoundary extends React.Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  constructor(props: AppErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      recoveryAttempts: 0,
    };
  }

  static getDerivedStateFromError(): Partial<AppErrorBoundaryState> {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[BankAlDam ErrorBoundary]', error, info?.componentStack);
  }

  private handleSoftRecover = (): void => {
    this.setState((prev) => ({
      hasError: false,
      recoveryAttempts: prev.recoveryAttempts + 1,
    }));
  };

  private handleSafeReload = (): void => {
    try {
      window.location.reload();
    } catch {
      this.handleSoftRecover();
    }
  };

  render(): React.ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div
        dir="rtl"
        className="min-h-screen bg-slate-50 text-slate-800 flex items-center justify-center p-5 font-['Cairo',sans-serif]"
      >
        <div className="w-full max-w-md bg-white rounded-3xl p-6 sm:p-7 shadow-xl border border-slate-200 text-center space-y-5">
          <div className="w-16 h-16 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center mx-auto border border-red-100">
            <ShieldAlert className="w-8 h-8" />
          </div>

          <div className="space-y-2">
            <h1 className="text-lg sm:text-xl font-black text-slate-900">
              تعذر عرض الصفحة مؤقتاً
            </h1>
            <p className="text-xs sm:text-sm text-slate-600 font-medium leading-relaxed">
              حدث خلل مؤقت بعد استئناف التطبيق. بيانات المتبرعين وجلسة حسابك محفوظة بأمان، ويمكنك استعادة الواجهة الآن.
            </p>
          </div>

          <div className="flex flex-col gap-2.5 pt-1">
            {this.state.recoveryAttempts < 2 && (
              <button
                type="button"
                onClick={this.handleSoftRecover}
                className="w-full py-3 px-4 rounded-2xl bg-red-600 hover:bg-red-700 text-white font-black text-sm shadow-md transition-colors active:scale-98 flex items-center justify-center gap-2 cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
                <span>استعادة الواجهة الآن</span>
              </button>
            )}
            <button
              type="button"
              onClick={this.handleSafeReload}
              className={`w-full py-3 px-4 rounded-2xl font-bold text-sm transition-colors active:scale-98 cursor-pointer ${
                this.state.recoveryAttempts < 2
                  ? 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                  : 'bg-red-600 hover:bg-red-700 text-white shadow-md'
              }`}
            >
              إعادة تشغيل الواجهة
            </button>
          </div>
        </div>
      </div>
    );
  }
}
