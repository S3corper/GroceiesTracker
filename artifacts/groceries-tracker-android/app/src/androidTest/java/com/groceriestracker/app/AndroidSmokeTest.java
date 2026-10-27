package com.groceriestracker.app;

import android.app.Activity;
import android.content.Intent;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.By;
import androidx.test.uiautomator.UiDevice;
import androidx.test.uiautomator.UiObject2;
import androidx.test.uiautomator.Until;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.json.JSONArray;
import org.json.JSONObject;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

/** Creates only its own disposable cloud account; always deletes it in finally. */
@RunWith(AndroidJUnit4.class)
public class AndroidSmokeTest {
    private static final String API = "https://iwadadmqtvvihprezfkk.supabase.co";
    private static final String KEY = "sb_publishable_MVDTjGXI_gpJv3eEG5V57Q_CN9levjc";
    private String token;
    private WebView web;
    private Activity activity;

    @Test public void receiptOcrRunsInsideAndroidWebView() throws Exception {
        Intent launch = new Intent(InstrumentationRegistry.getInstrumentation().getTargetContext(), MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        activity = InstrumentationRegistry.getInstrumentation().startActivitySync(launch);
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            web = findWeb(activity.getWindow().getDecorView());
            web.loadUrl(WebPolicy.HOME + "ocr.html");
        });
        try {
            awaitJs("typeof window.groceryScan === 'function'");
            byte[] photo;
            try (java.io.InputStream input = InstrumentationRegistry.getInstrumentation().getContext().getAssets().open("receipt.png");
                 java.io.ByteArrayOutputStream output = new java.io.ByteArrayOutputStream()) {
                byte[] buffer = new byte[4096]; int count;
                while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                photo = output.toByteArray();
            }
            String body = new JSONObject().put("imageBase64", android.util.Base64.encodeToString(photo, android.util.Base64.NO_WRAP)).put("mimeType", "image/png").toString();
            js("window.ReactNativeWebView={postMessage: message=>{window.__qaOcr=JSON.parse(message)}};window.groceryScan('qa'," + body + ")");
            awaitJs("window.__qaOcr && (window.__qaOcr.result || window.__qaOcr.error)");
            assertEquals("null", js("window.__qaOcr.error"));
            assertEquals("5.5", js("window.__qaOcr.result.total"));
            assertEquals("true", js("JSON.stringify(window.__qaOcr.result).toUpperCase().includes('CARROT')"));
            assertEquals("true", js("JSON.stringify(window.__qaOcr.result).toUpperCase().includes('POTATO')"));
        } finally {
            InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> activity.finish());
        }
    }

    private Object request(String path, JSONObject body) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(API + path).openConnection();
        connection.setRequestMethod("POST"); connection.setConnectTimeout(30000); connection.setReadTimeout(30000);
        connection.setRequestProperty("apikey", KEY);
        connection.setRequestProperty("Content-Type", "application/json");
        if (token != null) connection.setRequestProperty("Authorization", "Bearer " + token);
        connection.setDoOutput(true);
        try (java.io.OutputStream out = connection.getOutputStream()) { out.write(body.toString().getBytes(StandardCharsets.UTF_8)); }
        int status = connection.getResponseCode();
        String text;
        try (java.util.Scanner scanner = new java.util.Scanner(status < 400 ? connection.getInputStream() : connection.getErrorStream(), "UTF-8").useDelimiter("\\A")) {
            text = scanner.hasNext() ? scanner.next() : "null";
        } finally { connection.disconnect(); }
        assertTrue("Test API status " + status, status < 400);
        return new org.json.JSONTokener(text).nextValue();
    }
    private Object rpc(String method, String path, JSONObject payload) throws Exception {
        return request("/rest/v1/rpc/grocery_api", new JSONObject().put("method", method).put("path", path)
            .put("query", new JSONObject()).put("payload", payload));
    }
    private String js(String code) throws Exception {
        CountDownLatch done = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>();
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> web.evaluateJavascript(code, value -> { result.set(value); done.countDown(); }));
        assertTrue("WebView JavaScript callback", done.await(15, TimeUnit.SECONDS));
        return result.get();
    }
    private void awaitJs(String expression) throws Exception {
        long deadline = System.currentTimeMillis() + 90000;
        while (System.currentTimeMillis() < deadline) {
            if ("true".equals(js("Boolean(" + expression + ")"))) return;
            Thread.sleep(300);
        }
        fail("Web condition not met: " + expression + "; page: " + js("document.body.innerText.slice(0,1500)"));
    }
    private WebView findWeb(View view) {
        if (view instanceof WebView) return (WebView)view;
        if (view instanceof ViewGroup) for (int i = 0; i < ((ViewGroup)view).getChildCount(); i++) {
            WebView found = findWeb(((ViewGroup)view).getChildAt(i)); if (found != null) return found;
        }
        return null;
    }
    private void clickText(String text) throws Exception {
        assertEquals("Button exists: " + text, "true", js("(() => {const button=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===" + JSONObject.quote(text) + ");if(!button)return false;button.click();return true;})()"));
    }

    @Test public void loginSharedDataPersistenceAndAndroidFiles() throws Exception {
        String stamp = Long.toString(System.currentTimeMillis());
        String email = "grocery-qa-android-" + stamp + "@example.com";
        String password = java.util.UUID.randomUUID().toString() + "aA1!";
        JSONObject signup = (JSONObject)request("/auth/v1/signup", new JSONObject().put("email", email).put("password", password));
        token = signup.getString("access_token");
        try {
            JSONArray spaces = (JSONArray)rpc("GET", "/api/spaces", new JSONObject());
            String spaceId = null;
            for (int i = 0; i < spaces.length(); i++) if ("household".equals(spaces.getJSONObject(i).getString("kind"))) spaceId = spaces.getJSONObject(i).getString("id");
            assertNotNull(spaceId);
            rpc("POST", "/api/receipts", new JSONObject().put("spaceId", spaceId).put("merchant", "Android parity test store")
                .put("purchaseDate", "2026-10-26").put("total", 5.5).put("items", new JSONArray()
                    .put(new JSONObject().put("name", "Carrots").put("quantity", 1).put("linePrice", 5.5).put("category", "Produce"))));
            rpc("POST", "/api/spaces/" + spaceId + "/list", new JSONObject().put("name", "Website to Android apples"));

            Intent launch = new Intent(InstrumentationRegistry.getInstrumentation().getTargetContext(), MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            activity = InstrumentationRegistry.getInstrumentation().startActivitySync(launch);
            InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> web = findWeb(activity.getWindow().getDecorView()));
            assertNotNull(web);
            awaitJs("document.querySelector('input[type=email]')");
            js("(() => { const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;"
                + "const email=document.querySelector('input[type=email]');set.call(email," + JSONObject.quote(email) + ");email.dispatchEvent(new Event('input',{bubbles:true}));"
                + "const password=document.querySelector('input[type=password]');set.call(password," + JSONObject.quote(password) + ");password.dispatchEvent(new Event('input',{bubbles:true}));})()");
            clickText("Sign in");
            awaitJs("!document.querySelector('input[type=email]') && document.body.innerText.includes('Dashboard')");
            clickText("Receipts");
            awaitJs("document.body.innerText.includes('Android parity test store')");
            assertEquals("true", js("Boolean(window.__groceryAndroidBridge)"));
            js("window.__qaBeforeReload = true");
            InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> web.reload());
            awaitJs("!window.__qaBeforeReload && !document.querySelector('input[type=email]') && document.body.innerText.includes('Dashboard')");
            clickText("Receipts");
            awaitJs("document.body.innerText.includes('Android parity test store')");
            clickText("Grocery Lists");
            awaitJs("document.body.innerText.includes('Website to Android apples')");
            js("(() => {let input=document.querySelector('input[placeholder=\"Add an item\"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Android to website milk');input.dispatchEvent(new Event('input',{bubbles:true}));})()");
            clickText("Add item");
            awaitJs("document.body.innerText.includes('Android to website milk')");
            assertTrue(rpc("GET", "/api/spaces/" + spaceId + "/list", new JSONObject()).toString().contains("Android to website milk"));

            // Real export from the site, including the immediately revoked Blob URL.
            clickText("Settings");
            awaitJs("Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Export backup')");
            clickText("Export backup");
            UiDevice device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
            assertTrue("Android save dialog", device.wait(Until.hasObject(By.textContains("SAVE")), 20000));
            UiObject2 save = device.findObject(By.text("SAVE"));
            assertNotNull(save);
            save.click();
            assertTrue("Return from save dialog", device.wait(Until.hasObject(By.pkg("com.groceriestracker.app")), 20000));
            Thread.sleep(1500);
            String exported = device.executeShellCommand("cat /sdcard/Download/groceries-My-household-backup.json");
            assertTrue("Saved backup contains cloud receipt", exported.contains("Android parity test store"));
            device.executeShellCommand("rm /sdcard/Download/groceries-My-household-backup.json");

            // Verify the website's camera input starts Android's camera and cancel returns cleanly.
            clickText("Receipts");
            clickText("Add receipt");
            awaitJs("document.querySelector('input[capture]')");
            js("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Take a photo').scrollIntoView({block:'center'})");
            UiObject2 takePhoto = device.wait(Until.findObject(By.text("Take a photo")), 10000);
            assertNotNull("Camera button", takePhoto);
            takePhoto.click();
            assertTrue("Camera activity opened", device.wait(Until.hasObject(By.pkg("com.android.camera2")), 15000));
            device.pressBack();
            assertTrue("Return from camera", device.wait(Until.hasObject(By.pkg("com.groceriestracker.app")), 15000));
        } finally {
            rpc("DELETE", "/api/auth/me", new JSONObject().put("confirmation", "DELETE ACCOUNT"));
            if (web != null) js("localStorage.clear()");
            if (activity != null) InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> activity.finish());
        }
    }
}
