package com.groceriestracker.app;

import org.junit.Test;
import static org.junit.Assert.*;

public class WebPolicyTest {
    @Test public void acceptsWebsiteAndInvitations() {
        assertTrue(WebPolicy.trusted(WebPolicy.HOME));
        assertTrue(WebPolicy.trusted(WebPolicy.HOME + "?invite=abc%2B123"));
        assertTrue(WebPolicy.trusted(WebPolicy.HOME + "ocr.html"));
    }
    @Test public void rejectsUntrustedNavigation() {
        for (String url : new String[]{null, "", "http://s3corper.github.io/GroceiesTracker/",
            "https://s3corper.github.io.evil.test/GroceiesTracker/", "https://evil.test/",
            "https://s3corper.github.io/OtherProject/", "https://s3corper.github.io/GroceiesTrackerEvil/",
            "https://evil@s3corper.github.io/GroceiesTracker/", "https://s3corper.github.io:8443/GroceiesTracker/",
            WebPolicy.HOME + "../OtherProject", WebPolicy.HOME + "%2e%2e/OtherProject",
            "file:///etc/passwd", "javascript:alert(1)", "intent://scan"}) {
            assertFalse("Must reject " + url, WebPolicy.trusted(url));
        }
    }
    @Test public void sanitizesBackupFilenames() {
        assertEquals("groceries-Home-backup.json", WebPolicy.backupName("groceries-Home-backup.json"));
        assertEquals(".._.._private.json", WebPolicy.backupName("../../private"));
        assertTrue(WebPolicy.backupName("a".repeat(300)).length() <= 105);
    }
}
