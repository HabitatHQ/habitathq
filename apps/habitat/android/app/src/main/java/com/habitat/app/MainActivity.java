package com.habitat.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private String pendingShareUrl = null;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BatteryOptimPlugin.class);
        super.onCreate(savedInstanceState);
        handleShareIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleShareIntent(intent);
    }

    @Override
    public void onResume() {
        super.onResume();
        if (pendingShareUrl != null) {
            final String path = pendingShareUrl;
            pendingShareUrl = null;
            getBridge().getWebView().postDelayed(() -> {
                getBridge().getWebView().loadUrl("https://localhost" + path);
            }, 600);
        }
    }

    private void handleShareIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        String type = intent.getType();

        if (!Intent.ACTION_SEND.equals(action) || type == null) return;

        if (type.startsWith("text/")) {
            String sharedText = intent.getStringExtra(Intent.EXTRA_TEXT);
            String sharedSubject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
            if (sharedText != null) {
                String encodedText = Uri.encode(sharedText);
                String encodedTitle = sharedSubject != null ? Uri.encode(sharedSubject) : "";

                if (sharedText.startsWith("http://") || sharedText.startsWith("https://")) {
                    pendingShareUrl = "/_share?url=" + encodedText + "&title=" + encodedTitle;
                } else {
                    pendingShareUrl = "/_share?text=" + encodedText + "&title=" + encodedTitle;
                }
            }
        } else if (type.startsWith("image/")) {
            Uri imageUri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (imageUri != null) {
                String encodedPath = Uri.encode(imageUri.toString());
                pendingShareUrl = "/_share?image=" + encodedPath;
            }
        }

        intent.setAction(null);
    }
}
