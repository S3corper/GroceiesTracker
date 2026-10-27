package com.groceriestracker.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Bundle;
import android.provider.MediaStore;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;
import androidx.core.content.FileProvider;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import org.json.JSONObject;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
    private static final int PICK_FILE = 10, SAVE_BACKUP = 11;
    private static final long MAX_BACKUP = 512L * 1024 * 1024;
    private WebView web;
    private ProgressBar loading;
    private LinearLayout errorView;
    private ValueCallback<Uri[]> fileCallback;
    private Uri cameraUri;
    private File backupFile;
    private OutputStream backupStream;
    private long expectedBytes, receivedBytes;
    private String backupName;
    private boolean savingBackup;
    private JavaScriptReplyProxy saveReply;
    private final ExecutorService fileWorker = Executors.newSingleThreadExecutor();
    private String bridgeScript;

    @SuppressLint("SetJavaScriptEnabled")
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        androidx.core.view.WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        cleanOldCameraFiles();
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xfff4f2ef);
        // Keep the website clear of system bars, display cutouts and the keyboard.
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (android.os.Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars()
                    | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            } else {
                view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                    insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            }
            return android.os.Build.VERSION.SDK_INT >= 30 ? WindowInsets.CONSUMED : insets.consumeSystemWindowInsets();
        });
        web = new WebView(this);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        loading = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        root.addView(loading, new FrameLayout.LayoutParams(-1, dp(3), Gravity.TOP));
        errorView = new LinearLayout(this);
        errorView.setOrientation(LinearLayout.VERTICAL);
        errorView.setGravity(Gravity.CENTER);
        errorView.setPadding(dp(28), dp(28), dp(28), dp(28));
        errorView.setBackgroundColor(0xfff4f2ef);
        TextView errorText = new TextView(this);
        errorText.setText("Grocery Tracker couldn't connect.\nCheck your internet connection and try again.");
        errorText.setGravity(Gravity.CENTER);
        errorText.setTextSize(18);
        errorView.addView(errorText);
        Button retry = new Button(this);
        retry.setText("Try again");
        retry.setOnClickListener(v -> { errorView.setVisibility(View.GONE); web.loadUrl(WebPolicy.HOME); });
        errorView.addView(retry);
        root.addView(errorView, new FrameLayout.LayoutParams(-1, -1));
        errorView.setVisibility(View.GONE);
        setContentView(root);

        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true); // Android document picker and camera URIs.
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSafeBrowsingEnabled(true);
        settings.setSupportMultipleWindows(false);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        WebView.setWebContentsDebuggingEnabled(false);

        try (java.io.InputStream script = getAssets().open("android-bridge.js")) {
            java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
            byte[] buffer = new byte[4096];
            int count;
            while ((count = script.read(buffer)) != -1) bytes.write(buffer, 0, count);
            bridgeScript = bytes.toString(StandardCharsets.UTF_8.name());
        } catch (Exception e) { throw new IllegalStateException("Missing Android bridge", e); }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(web, "GroceryNative", Collections.singleton(WebPolicy.ORIGIN),
                (view, message, origin, mainFrame, reply) -> {
                    if (mainFrame && WebPolicy.ORIGIN.equals(origin.toString()) && WebPolicy.trusted(view.getUrl())) {
                        receiveMessage(message.getData(), reply);
                    }
                });
        } else {
            new AlertDialog.Builder(this).setTitle("Update Android System WebView")
                .setMessage("Update Android System WebView or Chrome to enable backup downloads and invitation copying.")
                .setPositiveButton("OK", null).show();
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(web, bridgeScript, Collections.singleton(WebPolicy.ORIGIN));
        }
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (!request.isForMainFrame()) return false;
                String url = request.getUrl().toString();
                if (WebPolicy.trusted(url)) return false;
                openExternal(request.getUrl());
                return true;
            }
            @Override public void onPageStarted(WebView view, String url, Bitmap favicon) {
                loading.setVisibility(View.VISIBLE);
                errorView.setVisibility(View.GONE);
                if (!savingBackup) clearBackup();
            }
            @Override public void onPageFinished(WebView view, String url) {
                loading.setVisibility(View.GONE);
                CookieManager.getInstance().flush();
                if (WebPolicy.trusted(url)) view.evaluateJavascript(bridgeScript, null);
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showConnectionError();
            }
            @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (request.isForMainFrame()) showConnectionError();
            }
            // WebView's default SSL handler cancels invalid certificates. Never bypass it.
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView view, int progress) { loading.setProgress(progress); }
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (!WebPolicy.trusted(view.getUrl())) return false;
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                cameraUri = null;
                try {
                    if (params.isCaptureEnabled()) {
                        File folder = new File(getCacheDir(), "camera");
                        if (!folder.exists() && !folder.mkdirs()) throw new java.io.IOException("Camera folder unavailable");
                        File photo = File.createTempFile("receipt-", ".jpg", folder);
                        cameraUri = FileProvider.getUriForFile(MainActivity.this, getPackageName() + ".files", photo);
                        Intent camera = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                        camera.putExtra(MediaStore.EXTRA_OUTPUT, cameraUri);
                        camera.setClipData(ClipData.newRawUri("Receipt photo", cameraUri));
                        camera.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        if (camera.resolveActivity(getPackageManager()) != null) {
                            startActivityForResult(camera, PICK_FILE);
                            return true;
                        }
                        cameraUri = null;
                        toast("No camera app found. Choose an existing photo instead.");
                    }
                    Intent picker = new Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE);
                    String[] accepts = params.getAcceptTypes();
                    boolean image = accepts.length > 0 && accepts[0].startsWith("image/");
                    picker.setType(image ? "image/*" : "*/*");
                    if (!image && accepts.length > 0 && accepts[0].contains("json")) {
                        picker.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/json", "text/plain", "application/octet-stream"});
                    }
                    picker.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                    startActivityForResult(Intent.createChooser(picker, image ? "Choose a photo" : "Choose a backup"), PICK_FILE);
                } catch (Exception error) {
                    fileCallback.onReceiveValue(null);
                    fileCallback = null;
                    toast("Couldn't open the camera or file picker. Try uploading a file.");
                }
                return true;
            }
        });
        web.setDownloadListener((url, agent, disposition, type, size) -> {
            if (url.startsWith("https://")) openExternal(Uri.parse(url));
            else toast("Try exporting the backup again, or use the website in your browser.");
        });
        if (state == null || web.restoreState(state) == null) web.loadUrl(WebPolicy.HOME);
    }

    @SuppressLint("RequiresFeature") // Called only by the feature-gated WebMessageListener above.
    private void receiveMessage(String raw, JavaScriptReplyProxy reply) {
        try {
            if (raw == null || raw.length() > 100000) throw new IllegalArgumentException("Invalid message");
            JSONObject message = new JSONObject(raw);
            String kind = message.getString("type");
            switch (kind) {
                case "clipboard":
                    String text = message.getString("text");
                    if (text.length() > 8192) throw new IllegalArgumentException("Text too long");
                    ((ClipboardManager)getSystemService(CLIPBOARD_SERVICE)).setPrimaryClip(ClipData.newPlainText("Grocery Tracker", text));
                    reply.postMessage("ok");
                    break;
                case "begin":
                    if (backupFile != null || savingBackup) throw new IllegalStateException("A backup is already being saved");
                    expectedBytes = message.getLong("size");
                    if (expectedBytes < 1 || expectedBytes > MAX_BACKUP) throw new IllegalArgumentException("Backup must be under 512 MB");
                    backupName = WebPolicy.backupName(message.getString("name"));
                    backupFile = File.createTempFile("export-", ".json", getCacheDir());
                    backupStream = new FileOutputStream(backupFile);
                    receivedBytes = 0;
                    reply.postMessage("ok");
                    break;
                case "chunk":
                    if (backupStream == null) throw new IllegalStateException("No export in progress");
                    byte[] chunk = android.util.Base64.decode(message.getString("data"), android.util.Base64.NO_WRAP);
                    if (chunk.length > 49152 || receivedBytes + chunk.length > expectedBytes) throw new IllegalArgumentException("Invalid backup size");
                    backupStream.write(chunk);
                    receivedBytes += chunk.length;
                    reply.postMessage("ok");
                    break;
                case "finish":
                    if (backupStream == null || receivedBytes != expectedBytes) throw new IllegalStateException("Incomplete backup");
                    backupStream.close();
                    backupStream = null;
                    Intent save = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                        .setType("application/json").putExtra(Intent.EXTRA_TITLE, backupName);
                    savingBackup = true;
                    saveReply = reply;
                    try { startActivityForResult(save, SAVE_BACKUP); }
                    catch (Exception error) {
                        savingBackup = false;
                        saveReply = null;
                        throw error;
                    }
                    break;
                case "abort":
                    if (!savingBackup) clearBackup();
                    reply.postMessage("ok");
                    break;
                default: throw new IllegalArgumentException("Unsupported operation");
            }
        } catch (Exception error) {
            if (!savingBackup) clearBackup();
            reply.postMessage("error:" + error.getMessage());
        }
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == PICK_FILE && fileCallback != null) {
            Uri[] selected = null;
            if (result == RESULT_OK) {
                selected = cameraUri != null ? new Uri[]{cameraUri} : WebChromeClient.FileChooserParams.parseResult(result, data);
                if (selected != null) {
                    for (Uri uri : selected) if (!"content".equals(uri.getScheme())) { selected = null; break; }
                }
            }
            fileCallback.onReceiveValue(selected);
            fileCallback = null;
            cameraUri = null;
        }
        if (request == SAVE_BACKUP) {
            if (result != RESULT_OK || data == null || data.getData() == null || backupFile == null) {
                finishSave("cancelled");
                return;
            }
            Uri destination = data.getData();
            File source = backupFile;
            fileWorker.execute(() -> {
                String outcome = "ok";
                try (FileInputStream input = new FileInputStream(source);
                     OutputStream output = getContentResolver().openOutputStream(destination, "wt")) {
                    if (output == null) throw new java.io.IOException("Destination unavailable");
                    byte[] buffer = new byte[65536];
                    int count;
                    while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                } catch (Exception error) { outcome = "error:Couldn't save the backup. Please try again."; }
                String finalOutcome = outcome;
                runOnUiThread(() -> finishSave(finalOutcome));
            });
        }
    }

    @SuppressLint("RequiresFeature") // A reply exists only after the feature-gated listener receives an export.
    private void finishSave(String outcome) {
        if (saveReply != null) {
            try { saveReply.postMessage(outcome); } catch (Exception ignored) { }
        }
        saveReply = null;
        savingBackup = false;
        clearBackup();
        toast(outcome.equals("ok") ? "Backup saved" : outcome.equals("cancelled") ? "Backup save cancelled" : "Couldn't save backup");
    }
    private void clearBackup() {
        try { if (backupStream != null) backupStream.close(); } catch (Exception ignored) { }
        backupStream = null;
        if (backupFile != null) backupFile.delete();
        backupFile = null;
    }
    private void cleanOldCameraFiles() {
        File[] photos = new File(getCacheDir(), "camera").listFiles();
        if (photos != null) for (File photo : photos) {
            if (photo.lastModified() < System.currentTimeMillis() - 86400000L) photo.delete();
        }
        File[] exports = getCacheDir().listFiles((dir, name) -> name.startsWith("export-"));
        if (exports != null) for (File export : exports) export.delete();
    }
    private void openExternal(Uri uri) {
        String scheme = uri.getScheme();
        if (!("https".equals(scheme) || "mailto".equals(scheme) || "tel".equals(scheme))) return;
        try { startActivity(new Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE)); }
        catch (Exception error) { toast("No app available to open this link"); }
    }
    private void showConnectionError() { loading.setVisibility(View.GONE); errorView.setVisibility(View.VISIBLE); }
    private void toast(String text) { Toast.makeText(this, text, Toast.LENGTH_LONG).show(); }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    @Override public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else new AlertDialog.Builder(this).setTitle("Close Grocery Tracker?")
            .setMessage("Save any receipt you are reviewing before closing.")
            .setNegativeButton("Keep open", null).setPositiveButton("Close", (dialog, which) -> finish()).show();
    }
    @Override protected void onSaveInstanceState(Bundle state) { web.saveState(state); super.onSaveInstanceState(state); }
    @Override protected void onPause() { CookieManager.getInstance().flush(); web.onPause(); super.onPause(); }
    @Override protected void onResume() { super.onResume(); if (web != null) web.onResume(); }
    @Override protected void onDestroy() {
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        if (!savingBackup) clearBackup();
        fileWorker.shutdown();
        web.destroy();
        super.onDestroy();
    }
}
