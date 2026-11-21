package com.qatrahayat.app;

import android.app.Activity;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.ViewGroup;
import android.view.ViewParent;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.core.splashscreen.SplashScreen;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Logger;
import com.getcapacitor.WebViewListener;
import java.io.File;

public class MainActivity extends BridgeActivity {

    private static final String LOG_TAG = "BankAlDamLifecycle";
    private static final int APP_BACKGROUND_COLOR = Color.parseColor("#F8FAFC");
    private static final long BACKGROUND_HEALTH_CHECK_THRESHOLD_MS = 15_000L;
    private static final long RECOVERY_WINDOW_MS = 20_000L;
    private static final int MAX_CONSECUTIVE_RECOVERIES = 3;

    private static long lastRecoveryElapsedMs = 0L;
    private static int consecutiveRecoveries = 0;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private Runnable pendingHealthCheckRunnable;
    private Runnable resetRecoveryCounterRunnable;

    private boolean isActivityForeground = false;
    private boolean wasStoppedInBackground = false;
    private boolean pageCommittedVisible = false;
    private boolean rendererLost = false;
    private boolean pendingRendererRecovery = false;
    private boolean listenerRegistered = false;
    private long pausedAtElapsedMs = 0L;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        try {
            SplashScreen splashScreen = SplashScreen.installSplashScreen(this);
            splashScreen.setKeepOnScreenCondition(() -> false);
        } catch (Throwable ignored) {
            // Fallback gracefully if platform handles theme transition directly
        }

        // Before Bridge initializes WebViewLocalServer, verify any persisted OTA path
        // still contains a valid index.html, and fall back to built-in assets if in a crash loop.
        if (consecutiveRecoveries >= 2) {
            clearCustomServerPath("repeated_recovery");
        } else {
            validateCustomServerPathBeforeBridgeInit();
        }

        super.onCreate(savedInstanceState);

        try {
            getWindow().setBackgroundDrawable(new ColorDrawable(APP_BACKGROUND_COLOR));
        } catch (Throwable ignored) {
            // Keep existing window background if window decoration isn't ready
        }

        configureWebViewSafely();
        registerWebViewHealthListener();
    }

    @Override
    public void onStart() {
        super.onStart();
        if (pendingRendererRecovery && !isFinishing() && !isDestroyed()) {
            Logger.debug(LOG_TAG, "Detected pending WebView renderer recovery in onStart");
        }
    }

    @Override
    public void onRestart() {
        super.onRestart();
    }

    @Override
    public void onResume() {
        super.onResume();
        isActivityForeground = true;
        cancelScheduledHealthChecks();

        if (pendingRendererRecovery || rendererLost) {
            pendingRendererRecovery = false;
            performSafeActivityRecovery("resume_after_renderer_loss", false);
            return;
        }

        WebView webView = getAttachedWebView();
        if (webView == null) {
            performSafeActivityRecovery("missing_webview_on_resume", false);
            return;
        }

        try {
            webView.onResume();
            webView.resumeTimers();
            webView.requestLayout();
            webView.invalidate();
        } catch (Throwable ex) {
            Logger.warn(LOG_TAG, "WebView resume warning: " + ex.getMessage());
        }

        long pausedDurationMs = pausedAtElapsedMs > 0L
            ? (SystemClock.elapsedRealtime() - pausedAtElapsedMs)
            : 0L;

        if (wasStoppedInBackground || pausedDurationMs >= BACKGROUND_HEALTH_CHECK_THRESHOLD_MS) {
            wasStoppedInBackground = false;
            scheduleDomHealthCheck(webView, 450L, "background_resume", 0);
        }
    }

    @Override
    public void onPause() {
        isActivityForeground = false;
        pausedAtElapsedMs = SystemClock.elapsedRealtime();
        cancelScheduledHealthChecks();
        super.onPause();
    }

    @Override
    public void onStop() {
        wasStoppedInBackground = true;
        cancelScheduledHealthChecks();
        super.onStop();
    }

    @Override
    public void onDestroy() {
        cancelScheduledHealthChecks();
        super.onDestroy();
    }

    private WebView getAttachedWebView() {
        Bridge activeBridge = getBridge();
        return activeBridge != null ? activeBridge.getWebView() : null;
    }

    private void configureWebViewSafely() {
        WebView webView = getAttachedWebView();
        if (webView == null) {
            return;
        }

        try {
            webView.setBackgroundColor(APP_BACKGROUND_COLOR);
            WebSettings settings = webView.getSettings();
            if (settings != null) {
                settings.setDomStorageEnabled(true);
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                // Keep renderer prioritized while visible, waive when backgrounded so battery isn't drained.
                webView.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, true);
            }
        } catch (Throwable ex) {
            Logger.warn(LOG_TAG, "Failed to configure WebView hardening: " + ex.getMessage());
        }
    }

    private void registerWebViewHealthListener() {
        Bridge activeBridge = getBridge();
        if (activeBridge == null || listenerRegistered) {
            return;
        }
        listenerRegistered = true;

        activeBridge.addWebViewListener(
            new WebViewListener() {
                @Override
                public void onPageStarted(WebView webView) {
                    pageCommittedVisible = false;
                }

                @Override
                public void onPageCommitVisible(WebView view, String url) {
                    pageCommittedVisible = true;
                    scheduleRecoveryCounterReset();
                }

                @Override
                public void onPageLoaded(WebView webView) {
                    pageCommittedVisible = true;
                    scheduleRecoveryCounterReset();
                }

                @Override
                public void onReceivedError(WebView webView) {
                    if (!pageCommittedVisible && isActivityForeground) {
                        scheduleDomHealthCheck(webView, 750L, "received_error", 0);
                    }
                }

                @Override
                public void onReceivedHttpError(WebView webView) {
                    if (!pageCommittedVisible && isActivityForeground) {
                        scheduleDomHealthCheck(webView, 750L, "received_http_error", 0);
                    }
                }

                @Override
                public boolean onRenderProcessGone(WebView deadWebView, RenderProcessGoneDetail detail) {
                    boolean didCrash = detail != null && detail.didCrash();
                    Logger.error(
                        LOG_TAG,
                        "WebView renderer process gone (didCrash=" + didCrash + ", foreground=" + isActivityForeground + ")",
                        null
                    );

                    rendererLost = true;
                    mainHandler.post(() -> {
                        detachAndDestroyDeadWebView(deadWebView);
                        if (isFinishing() || isDestroyed()) {
                            return;
                        }
                        if (isActivityForeground) {
                            performSafeActivityRecovery("render_process_gone", didCrash);
                        } else {
                            pendingRendererRecovery = true;
                        }
                    });

                    // Must return true so Android does not kill the app process abruptly.
                    return true;
                }
            }
        );
    }

    private void detachAndDestroyDeadWebView(WebView deadWebView) {
        if (deadWebView == null) {
            return;
        }
        try {
            ViewParent parent = deadWebView.getParent();
            if (parent instanceof ViewGroup) {
                ((ViewGroup) parent).removeView(deadWebView);
            }
            deadWebView.stopLoading();
            deadWebView.setWebChromeClient(null);
            deadWebView.setWebViewClient(null);
            deadWebView.destroy();
        } catch (Throwable ex) {
            Logger.warn(LOG_TAG, "Error destroying dead WebView: " + ex.getMessage());
        }
    }

    private void scheduleDomHealthCheck(WebView webView, long delayMs, String reason, int attempt) {
        cancelScheduledHealthChecks();
        pendingHealthCheckRunnable = () -> {
            if (!isActivityForeground || isFinishing() || isDestroyed() || rendererLost) {
                return;
            }
            Bridge activeBridge = getBridge();
            WebView currentWebView = activeBridge != null ? activeBridge.getWebView() : null;
            if (currentWebView == null || currentWebView != webView) {
                performSafeActivityRecovery("detached_webview_" + reason, false);
                return;
            }

            String currentUrl = null;
            try {
                currentUrl = currentWebView.getUrl();
            } catch (Throwable ignored) {
                currentUrl = null;
            }

            if (currentUrl == null || currentUrl.trim().isEmpty() || "about:blank".equals(currentUrl)) {
                Logger.warn(LOG_TAG, "WebView URL is blank after " + reason + " (attempt " + attempt + ")");
                if (attempt == 0) {
                    reloadBridgeSafely(activeBridge, currentWebView);
                    scheduleDomHealthCheck(currentWebView, 1200L, reason, 1);
                } else {
                    performSafeActivityRecovery("blank_url_" + reason, true);
                }
                return;
            }

            try {
                currentWebView.evaluateJavascript(
                    "(function(){try{var r=document.getElementById('root');if(!r){return 'NO_ROOT';}if(r.children&&r.children.length>0){return 'OK';}return 'EMPTY:'+document.readyState;}catch(e){return 'ERR';}})()",
                    value -> {
                        if (!isActivityForeground || isFinishing() || isDestroyed() || rendererLost) {
                            return;
                        }
                        if ("\"OK\"".equals(value)) {
                            return;
                        }

                        Logger.warn(LOG_TAG, "WebView health probe result=" + value + " reason=" + reason + " attempt=" + attempt);
                        if (value == null) {
                            // Null callback from evaluateJavascript typically indicates a dead/unresponsive renderer.
                            if (attempt == 0) {
                                scheduleDomHealthCheck(currentWebView, 700L, reason, 1);
                            } else {
                                performSafeActivityRecovery("unresponsive_renderer_" + reason, false);
                            }
                            return;
                        }

                        if (attempt == 0) {
                            scheduleDomHealthCheck(currentWebView, 900L, reason, 1);
                        } else if (attempt == 1) {
                            validateCustomServerPathBeforeBridgeInit();
                            reloadBridgeSafely(activeBridge, currentWebView);
                            scheduleDomHealthCheck(currentWebView, 1500L, reason, 2);
                        } else {
                            performSafeActivityRecovery("empty_root_" + reason, true);
                        }
                    }
                );
            } catch (Throwable ex) {
                Logger.error(LOG_TAG, "evaluateJavascript failed: " + ex.getMessage(), ex);
                performSafeActivityRecovery("eval_exception_" + reason, false);
            }
        };
        mainHandler.postDelayed(pendingHealthCheckRunnable, delayMs);
    }

    private void reloadBridgeSafely(Bridge activeBridge, WebView webView) {
        try {
            String appUrl = activeBridge != null ? activeBridge.getAppUrl() : null;
            if (activeBridge != null && appUrl != null && !appUrl.isEmpty()) {
                webView.loadUrl(appUrl);
            } else if (activeBridge != null) {
                activeBridge.reload();
            } else {
                webView.reload();
            }
        } catch (Throwable ex) {
            Logger.warn(LOG_TAG, "Fallback reload warning: " + ex.getMessage());
            performSafeActivityRecovery("reload_failed", false);
        }
    }

    private void performSafeActivityRecovery(String reason, boolean resetOtaOnCrash) {
        if (isFinishing() || isDestroyed()) {
            return;
        }

        long now = SystemClock.elapsedRealtime();
        if (lastRecoveryElapsedMs > 0L && (now - lastRecoveryElapsedMs) < RECOVERY_WINDOW_MS) {
            consecutiveRecoveries++;
        } else {
            consecutiveRecoveries = 1;
        }
        lastRecoveryElapsedMs = now;

        if (resetOtaOnCrash || consecutiveRecoveries >= 2) {
            clearCustomServerPath(reason);
        }

        if (consecutiveRecoveries > MAX_CONSECUTIVE_RECOVERIES) {
            Logger.error(LOG_TAG, "Skipping activity recreate to avoid recovery loop (reason=" + reason + ")", null);
            return;
        }

        Logger.warn(
            LOG_TAG,
            "Recovering MainActivity cleanly (reason=" + reason + ", attempt=" + consecutiveRecoveries + ")"
        );
        rendererLost = false;
        pendingRendererRecovery = false;
        cancelScheduledHealthChecks();
        recreate();
    }

    private void scheduleRecoveryCounterReset() {
        if (resetRecoveryCounterRunnable != null) {
            mainHandler.removeCallbacks(resetRecoveryCounterRunnable);
        }
        resetRecoveryCounterRunnable = () -> {
            if (pageCommittedVisible && !rendererLost) {
                consecutiveRecoveries = 0;
            }
        };
        mainHandler.postDelayed(resetRecoveryCounterRunnable, 8_000L);
    }

    private void cancelScheduledHealthChecks() {
        if (pendingHealthCheckRunnable != null) {
            mainHandler.removeCallbacks(pendingHealthCheckRunnable);
            pendingHealthCheckRunnable = null;
        }
        if (resetRecoveryCounterRunnable != null) {
            mainHandler.removeCallbacks(resetRecoveryCounterRunnable);
            resetRecoveryCounterRunnable = null;
        }
    }

    private void validateCustomServerPathBeforeBridgeInit() {
        try {
            SharedPreferences prefs = getSharedPreferences(
                com.getcapacitor.plugin.WebView.WEBVIEW_PREFS_NAME,
                Activity.MODE_PRIVATE
            );
            String serverPath = prefs.getString(com.getcapacitor.plugin.WebView.CAP_SERVER_PATH, null);
            if (serverPath == null || serverPath.trim().isEmpty() || Bridge.DEFAULT_WEB_ASSET_DIR.equals(serverPath)) {
                return;
            }

            File bundleDir = new File(serverPath);
            File indexHtml = new File(bundleDir, "index.html");
            if (!bundleDir.isDirectory() || !indexHtml.isFile() || indexHtml.length() == 0L) {
                Logger.warn(LOG_TAG, "Persisted OTA serverPath is missing index.html; reverting to built-in assets: " + serverPath);
                prefs.edit().putString(com.getcapacitor.plugin.WebView.CAP_SERVER_PATH, "").commit();
            }
        } catch (Throwable ex) {
            Logger.warn(LOG_TAG, "Could not validate custom server path: " + ex.getMessage());
        }
    }

    private void clearCustomServerPath(String reason) {
        try {
            SharedPreferences prefs = getSharedPreferences(
                com.getcapacitor.plugin.WebView.WEBVIEW_PREFS_NAME,
                Activity.MODE_PRIVATE
            );
            String current = prefs.getString(com.getcapacitor.plugin.WebView.CAP_SERVER_PATH, "");
            if (current != null && !current.isEmpty()) {
                Logger.warn(LOG_TAG, "Clearing custom OTA serverBasePath due to " + reason);
                prefs.edit().putString(com.getcapacitor.plugin.WebView.CAP_SERVER_PATH, "").commit();
            }
        } catch (Throwable ex) {
            Logger.warn(LOG_TAG, "Could not clear custom server path: " + ex.getMessage());
        }
    }
}
