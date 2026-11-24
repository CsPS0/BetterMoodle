package io.github.csps0.bettermoodle;

import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import androidx.activity.ComponentActivity;
import androidx.activity.EdgeToEdge;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.SystemBarStyle;
import androidx.activity.result.ActivityResult;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.content.ContextCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.ScriptHandler;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * BetterMoodle for Android: a single WebView that opens the user's own Moodle site and runs the
 * browser extension's unchanged content.js / content.css on it. No school domain is built in; the
 * site is chosen on first launch and every native hook is restricted to that origin.
 */
public class MainActivity extends ComponentActivity {

    static final String ACTION_CHANGE_SITE = "io.github.csps0.bettermoodle.CHANGE_SITE";

    private static final String PREFS = "bettermoodle";
    private static final String KEY_SITE = "site";
    private static final String ASSET_ORIGIN = "https://appassets.androidplatform.net";
    private static final String SETUP_URL = ASSET_ORIGIN + "/assets/setup.html";
    private static final String SITE_BRIDGE = "BetterMoodleAndroid";
    private static final String SETUP_BRIDGE = "BetterMoodleSetup";

    private FrameLayout root;
    private WebView web;
    private WebViewAssetLoader assetLoader;

    private String siteUrl;    // normalised Moodle wwwroot, no trailing slash
    private String siteOrigin; // scheme://host[:port] of siteUrl
    private String injectedScript;
    private ScriptHandler startScript;
    private boolean siteBridgeInstalled;

    private ValueCallback<Uri[]> pendingFiles;
    private ActivityResultLauncher<Intent> filePicker;
    private View customView;
    private WebChromeClient.CustomViewCallback customViewCallback;

    // ------------------------------------------------------------------------------------------
    // Lifecycle
    // ------------------------------------------------------------------------------------------

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        EdgeToEdge.enable(this,
                SystemBarStyle.dark(Color.TRANSPARENT),
                SystemBarStyle.dark(Color.TRANSPARENT));
        super.onCreate(savedInstanceState);

        filePicker = registerForActivityResult(
                new ActivityResultContracts.StartActivityForResult(), this::onFilesPicked);

        root = new FrameLayout(this);
        root.setBackgroundColor(ContextCompat.getColor(this, R.color.canvas));
        web = new WebView(this);
        root.addView(web, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        // Edge-to-edge: keep Moodle clear of the status bar, cutout and keyboard
        ViewCompat.setOnApplyWindowInsetsListener(root, (v, insets) -> {
            if (customView != null) {
                v.setPadding(0, 0, 0, 0);
                return insets;
            }
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars()
                    | WindowInsetsCompat.Type.displayCutout()
                    | WindowInsetsCompat.Type.ime());
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return WindowInsetsCompat.CONSUMED;
        });

        configureWebView();

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (customView != null) {
                    hideCustomView();
                } else if (siteOrigin != null && siteOrigin.equals(originOf(web.getUrl()))) {
                    // Let the page close an open file picker, dialog, menu or customizer first
                    web.evaluateJavascript(
                            "(window.__bmAndroidBack ? window.__bmAndroidBack() : false)",
                            handled -> {
                                if (!"true".equals(handled)) navigateBack();
                            });
                } else {
                    navigateBack();
                }
            }

            private void navigateBack() {
                if (web.canGoBack()) {
                    web.goBack();
                } else {
                    setEnabled(false);
                    getOnBackPressedDispatcher().onBackPressed();
                    setEnabled(true);
                }
            }
        });

        String saved = prefs().getString(KEY_SITE, null);
        boolean changeSite = ACTION_CHANGE_SITE.equals(getIntent().getAction());
        if (saved == null || changeSite) {
            if (saved != null) setSite(saved);
            showSetup(null, null);
        } else {
            setSite(saved);
            if (savedInstanceState == null || web.restoreState(savedInstanceState) == null) {
                web.loadUrl(siteUrl + "/");
            }
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (ACTION_CHANGE_SITE.equals(intent.getAction())) {
            showSetup(null, null);
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onPause() {
        CookieManager.getInstance().flush();
        web.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (pendingFiles != null) {
            pendingFiles.onReceiveValue(null);
            pendingFiles = null;
        }
        root.removeView(web);
        web.destroy();
        super.onDestroy();
    }

    // ------------------------------------------------------------------------------------------
    // WebView setup
    // ------------------------------------------------------------------------------------------

    private void configureWebView() {
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true); // content.js keeps its settings in localStorage here
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(true);
        s.setBuiltInZoomControls(true);
        s.setDisplayZoomControls(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportMultipleWindows(false); // target=_blank opens in place
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
            // The extension themes Moodle itself; WebView auto-darkening would fight it
            WebSettingsCompat.setAlgorithmicDarkeningAllowed(s, false);
        }

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(web, true); // SSO providers inside the login flow

        web.setBackgroundColor(ContextCompat.getColor(this, R.color.canvas));

        assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());
        web.setDownloadListener((url, userAgent, contentDisposition, mimeType, length) ->
                enqueueDownload(url, null, contentDisposition, mimeType));

        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(web, SETUP_BRIDGE, Set.of(ASSET_ORIGIN),
                    (view, message, sourceOrigin, isMainFrame, reply) ->
                            onSetupMessage(message.getData(), reply));
        }
    }

    /** Points every native hook at one Moodle origin. Called on first run and on site change. */
    private void setSite(String normalisedSite) {
        siteUrl = normalisedSite;
        siteOrigin = originOf(normalisedSite);

        if (startScript != null) {
            startScript.remove();
            startScript = null;
        }
        if (siteBridgeInstalled) {
            WebViewCompat.removeWebMessageListener(web, SITE_BRIDGE);
            siteBridgeInstalled = false;
        }
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return;

        Set<String> rules = Set.of(siteOrigin);
        WebViewCompat.addWebMessageListener(web, SITE_BRIDGE, rules,
                (view, message, sourceOrigin, isMainFrame, reply) -> {
                    if (isMainFrame) onSiteMessage(message.getData());
                });
        siteBridgeInstalled = true;

        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            startScript = WebViewCompat.addDocumentStartJavaScript(web, contentScript(), rules);
        }
    }

    /** android-bridge.js + the extension's content.css / content.js, run like an MV3 content script. */
    private String contentScript() {
        if (injectedScript != null) return injectedScript;
        String css = readAsset("content.css");
        String js = readAsset("content.js");
        String bridge = readAsset("android-bridge.js");
        injectedScript = "(function () {\n"
                + "if (window.top !== window || window.__bmAndroid) return;\n"
                + "window.__bmAndroid = true;\n"
                + "var BM_VERSION = " + JSONObject.quote(versionName()) + ";\n"
                + "var BM_CSS = " + JSONObject.quote(css) + ";\n"
                + bridge + "\n"
                // content.js bails out unless the Moodle DOM exists, so run it at document_end
                + "var bmRunContent = function () {\n" + js + "\n};\n"
                + "if (document.readyState === 'loading') {\n"
                + "  document.addEventListener('DOMContentLoaded', bmRunContent, { once: true });\n"
                + "} else {\n"
                + "  bmRunContent();\n"
                + "}\n"
                + "})();";
        return injectedScript;
    }

    // ------------------------------------------------------------------------------------------
    // Messages from the pages
    // ------------------------------------------------------------------------------------------

    private void onSetupMessage(String data, JavaScriptReplyProxy reply) {
        try {
            JSONObject msg = new JSONObject(data);
            if (!"SET_SITE".equals(msg.optString("type"))) return;
            String normalised = normaliseSite(msg.optString("url"));
            if (normalised == null) {
                reply.postMessage(new JSONObject()
                        .put("type", "ERROR")
                        .put("message", "Érvénytelen cím. Írd be a teljes HTTPS-címet, például https://moodle.iskola.hu")
                        .toString());
                return;
            }
            prefs().edit().putString(KEY_SITE, normalised).apply();
            setSite(normalised);
            String retry = msg.optString("retry", "");
            if (!retry.isEmpty() && siteOrigin.equals(originOf(retry))) {
                web.loadUrl(retry);
            } else {
                web.loadUrl(normalised + "/");
            }
        } catch (Exception ignored) {
            // Malformed message from the setup page: nothing to do
        }
    }

    private void onSiteMessage(String data) {
        try {
            JSONObject msg = new JSONObject(data);
            if ("DOWNLOAD_FILE".equals(msg.optString("type"))) {
                enqueueDownload(msg.optString("url"), msg.optString("filename", null), null, null);
            }
        } catch (Exception ignored) {
            // Malformed message: ignore
        }
    }

    private void showSetup(String error, String retryUrl) {
        Uri.Builder b = Uri.parse(SETUP_URL).buildUpon();
        String current = siteUrl != null ? siteUrl : prefs().getString(KEY_SITE, null);
        if (current != null) b.appendQueryParameter("site", current);
        if (error != null) b.appendQueryParameter("error", error);
        if (retryUrl != null) b.appendQueryParameter("retry", retryUrl);
        web.loadUrl(b.build().toString());
    }

    // ------------------------------------------------------------------------------------------
    // Navigation
    // ------------------------------------------------------------------------------------------

    private class Client extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            return assetLoader.shouldInterceptRequest(request.getUrl());
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
            if (!"https".equals(scheme)) {
                openExternally(uri); // mailto:, tel:, intent:, plain http
                return true;
            }
            if (!request.isForMainFrame()) return false;

            String target = originOf(uri.toString());
            String current = originOf(view.getUrl());
            boolean sameSite = target.equals(siteOrigin) || target.equals(ASSET_ORIGIN);
            boolean sameAsCurrent = target.equals(current);
            // Redirects and script navigations stay in the app so SSO logins keep working;
            // a link the user taps that leaves the Moodle site opens in the browser.
            if (sameSite || sameAsCurrent || request.isRedirect() || !request.hasGesture()) {
                return false;
            }
            openExternally(uri);
            return true;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            CookieManager.getInstance().flush();
            // Old WebViews without document-start scripts: inject after load instead
            if (siteOrigin != null
                    && !WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)
                    && siteOrigin.equals(originOf(url))) {
                view.evaluateJavascript(contentScript(), null);
            }
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (!request.isForMainFrame()) return;
            String failed = request.getUrl().toString();
            if (failed.startsWith(ASSET_ORIGIN)) return;
            // A link that turns into a download (DownloadListener) aborts its navigation
            CharSequence description = error.getDescription();
            if (description != null && description.toString().contains("ERR_ABORTED")) return;
            showSetup("Az oldal nem tölthető be (" + error.getDescription()
                    + "). Ellenőrizd a kapcsolatot, majd próbáld újra.", failed);
        }
    }

    private void openExternally(Uri uri) {
        try {
            Intent intent;
            if ("intent".equalsIgnoreCase(uri.getScheme())) {
                intent = Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME);
                intent.addCategory(Intent.CATEGORY_BROWSABLE);
                intent.setComponent(null);
                intent.setSelector(null);
            } else {
                intent = new Intent(Intent.ACTION_VIEW, uri);
            }
            startActivity(intent);
        } catch (ActivityNotFoundException | java.net.URISyntaxException e) {
            toast(getString(R.string.no_app_for_link));
        }
    }

    // ------------------------------------------------------------------------------------------
    // File uploads, fullscreen video
    // ------------------------------------------------------------------------------------------

    private class Chrome extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                         FileChooserParams params) {
            if (pendingFiles != null) pendingFiles.onReceiveValue(null);
            pendingFiles = callback;

            // No MIME filtering: Moodle validates types server-side, and ".zip"-style accept
            // lists map to inconsistent MIME types across file providers.
            Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("*/*");
            if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) {
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            }
            try {
                filePicker.launch(Intent.createChooser(intent, null));
                return true;
            } catch (ActivityNotFoundException e) {
                pendingFiles = null;
                toast(getString(R.string.no_file_picker));
                return false;
            }
        }

        @Override
        public void onShowCustomView(View view, CustomViewCallback callback) {
            if (customView != null) {
                callback.onCustomViewHidden();
                return;
            }
            customView = view;
            customViewCallback = callback;
            view.setBackgroundColor(Color.BLACK);
            root.addView(view, new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            WindowInsetsControllerCompat c = WindowCompat.getInsetsController(getWindow(), root);
            c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            c.hide(WindowInsetsCompat.Type.systemBars());
            ViewCompat.requestApplyInsets(root);
        }

        @Override
        public void onHideCustomView() {
            hideCustomView();
        }
    }

    private void onFilesPicked(ActivityResult result) {
        if (pendingFiles == null) return;
        Uri[] uris = null;
        Intent data = result.getData();
        if (result.getResultCode() == RESULT_OK && data != null) {
            List<Uri> picked = new ArrayList<>();
            ClipData clip = data.getClipData();
            if (clip != null) {
                for (int i = 0; i < clip.getItemCount(); i++) {
                    Uri u = clip.getItemAt(i).getUri();
                    if (u != null) picked.add(u);
                }
            } else if (data.getData() != null) {
                picked.add(data.getData());
            }
            if (!picked.isEmpty()) uris = picked.toArray(new Uri[0]);
        }
        pendingFiles.onReceiveValue(uris);
        pendingFiles = null;
    }

    private void hideCustomView() {
        if (customView == null) return;
        root.removeView(customView);
        customView = null;
        WindowCompat.getInsetsController(getWindow(), root).show(WindowInsetsCompat.Type.systemBars());
        if (customViewCallback != null) customViewCallback.onCustomViewHidden();
        customViewCallback = null;
        ViewCompat.requestApplyInsets(root);
    }

    // ------------------------------------------------------------------------------------------
    // Downloads (Moodle files need the session cookie)
    // ------------------------------------------------------------------------------------------

    private void enqueueDownload(String url, String filename, String contentDisposition, String mimeType) {
        Uri uri = url == null ? null : Uri.parse(url);
        String scheme = uri == null || uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        if (!"https".equals(scheme) && !"http".equals(scheme)) {
            toast(getString(R.string.download_unsupported));
            return;
        }
        String name = sanitiseFileName(filename);
        if (name == null) name = URLUtil.guessFileName(url, contentDisposition, mimeType);
        try {
            DownloadManager.Request request = new DownloadManager.Request(uri);
            String cookie = CookieManager.getInstance().getCookie(url);
            if (cookie != null) request.addRequestHeader("Cookie", cookie);
            request.addRequestHeader("User-Agent", web.getSettings().getUserAgentString());
            if (mimeType != null && !mimeType.isEmpty()) request.setMimeType(mimeType);
            request.setTitle(name);
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
            DownloadManager dm = getSystemService(DownloadManager.class);
            dm.enqueue(request);
            toast(getString(R.string.download_started, name));
        } catch (Exception e) {
            toast(getString(R.string.download_unsupported));
        }
    }

    private static String sanitiseFileName(String name) {
        if (name == null) return null;
        String clean = name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").trim();
        if (clean.isEmpty() || clean.equals(".") || clean.equals("..")) return null;
        return clean.length() > 120 ? clean.substring(0, 120) : clean;
    }

    // ------------------------------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------------------------------

    /** Accepts anything a user might paste (bare host, login page, a course link) and returns the
     *  Moodle root, e.g. https://example.org/moodle. HTTPS only. */
    static String normaliseSite(String raw) {
        if (raw == null) return null;
        String s = raw.trim();
        if (s.isEmpty()) return null;
        if (!s.matches("(?i)^[a-z][a-z0-9+.-]*://.*")) s = "https://" + s;
        Uri u = Uri.parse(s);
        if (!"https".equalsIgnoreCase(u.getScheme())) return null;
        String host = u.getHost();
        if (host == null || host.isEmpty() || !host.contains(".") && !host.equals("localhost")) return null;
        String path = u.getPath() == null ? "" : u.getPath();
        path = path.replaceAll("(?i)/(login|my|course|mod|user|calendar|grade|message|admin|pluginfile\\.php)(/.*)?$", "");
        path = path.replaceAll("(?i)/index\\.php$", "");
        path = path.replaceAll("/+$", "");
        int port = u.getPort();
        return "https://" + host.toLowerCase(Locale.ROOT)
                + (port > 0 && port != 443 ? ":" + port : "") + path;
    }

    static String originOf(String url) {
        if (url == null) return "";
        Uri u = Uri.parse(url);
        if (u.getScheme() == null || u.getHost() == null) return "";
        String scheme = u.getScheme().toLowerCase(Locale.ROOT);
        int port = u.getPort();
        boolean defaultPort = port < 0 || ("https".equals(scheme) && port == 443) || ("http".equals(scheme) && port == 80);
        return scheme + "://" + u.getHost().toLowerCase(Locale.ROOT) + (defaultPort ? "" : ":" + port);
    }

    private String readAsset(String name) {
        try (InputStream in = getAssets().open(name)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return out.toString(StandardCharsets.UTF_8.name());
        } catch (IOException e) {
            throw new IllegalStateException("Missing bundled asset: " + name, e);
        }
    }

    private String versionName() {
        try {
            String v = getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
            return v == null ? "" : v;
        } catch (Exception e) {
            return "";
        }
    }

    private SharedPreferences prefs() {
        return getSharedPreferences(PREFS, MODE_PRIVATE);
    }

    private void toast(String text) {
        Toast.makeText(this, text, Toast.LENGTH_SHORT).show();
    }
}
