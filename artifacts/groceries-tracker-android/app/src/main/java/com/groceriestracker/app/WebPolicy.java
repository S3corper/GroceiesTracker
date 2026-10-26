package com.groceriestracker.app;

import java.net.URI;

/** Only the deployed grocery site gets in-app navigation and the export bridge. */
final class WebPolicy {
    static final String HOME = "https://s3corper.github.io/GroceiesTracker/";
    static final String ORIGIN = "https://s3corper.github.io";
    static boolean trusted(String value) {
        try {
            URI uri = new URI(value);
            String path = uri.getRawPath();
            return "https".equals(uri.getScheme()) && "s3corper.github.io".equals(uri.getHost())
                && uri.getUserInfo() == null && (uri.getPort() == -1 || uri.getPort() == 443)
                && path != null && (path.equals("/GroceiesTracker") || path.startsWith("/GroceiesTracker/"))
                && !path.contains("%") && !path.contains("\\") && path.equals(uri.normalize().getRawPath());
        } catch (Exception ignored) { return false; }
    }
    static String backupName(String name) {
        String clean = name.replaceAll("[^a-zA-Z0-9._-]", "_");
        if (clean.length() > 100) clean = clean.substring(0, 100);
        return clean.endsWith(".json") ? clean : clean + ".json";
    }
}
