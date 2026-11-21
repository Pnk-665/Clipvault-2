import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export async function buildAndroidApkProjectZip(appOrigin: string): Promise<string> {
  const buildId = crypto.randomUUID();
  const rootDir = path.join(os.tmpdir(), `clipvault-android-${buildId}`);
  const zipPath = path.join(os.tmpdir(), `ClipVault-Android-APK-Project-${buildId}.zip`);

  const cleanOrigin = appOrigin.replace(/\/+$/, '');
  let host = 'clipvault.app';
  try {
    host = new URL(cleanOrigin).host;
  } catch {
    // fallback host
  }

  const write = (relPath: string, content: string) => {
    const full = path.join(rootDir, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
  };

  // 1. README with clear build paths (PWABuilder, GitHub Actions, Android Studio, Bubblewrap)
  write(
    'README.md',
    `# ClipVault — Android APK Project

This bundle contains everything required to generate a signed, installable \`ClipVault.apk\` for Android pointing to your live ClipVault app (\`${cleanOrigin}\`).

## Fastest Option 1: Online APK Build (Zero Local Setup)
1. Visit https://www.pwabuilder.com
2. Enter your ClipVault URL: \`${cleanOrigin}\`
3. Select **Package for Stores -> Android -> Generate Package** to download a ready-to-install signed \`.apk\`.

## Option 2: Automated GitHub Actions APK Build (Free, Zero Local SDK)
1. Create a GitHub repository and upload the contents of this folder.
2. Open the **Actions** tab and run **Build ClipVault Android APK**.
3. Download \`ClipVault-debug.apk\` directly from the workflow **Artifacts** section and install it on your Android device.

## Option 3: Local Android Studio / Gradle Build
1. Open the \`android/\` folder in **Android Studio** (JDK 17 + Android SDK 34).
2. Click **Build -> Build Bundle(s) / APK(s) -> Build APK(s)** (or run \`cd android && gradle assembleDebug\`).
3. Copy \`android/app/build/outputs/apk/debug/app-debug.apk\` to your Android phone.

## Option 4: Bubblewrap Trusted Web Activity (TWA)
Run \`./build-apk.sh\` (requires Node.js 18+ and JDK 17) to build an Android TWA APK from \`twa-manifest.json\`.
`
  );

  // 2. Bubblewrap TWA Manifest
  write(
    'twa-manifest.json',
    JSON.stringify(
      {
        packageId: 'com.clipvault.app',
        host,
        name: 'ClipVault',
        launcherName: 'ClipVault',
        display: 'standalone',
        themeColor: '#141517',
        themeColorDark: '#0E0F11',
        navigationColor: '#141517',
        navigationColorDark: '#0E0F11',
        backgroundColor: '#F7F7F5',
        enableNotifications: true,
        startUrl: '/',
        iconUrl: `${cleanOrigin}/pwa-512x512.png`,
        maskableIconUrl: `${cleanOrigin}/pwa-maskable-512x512.png`,
        splashScreenFadeOutDuration: 300,
        signingKey: {
          path: './android.keystore',
          alias: 'clipvault',
        },
        appVersionName: '1.0.0',
        appVersionCode: 1,
        fallbackType: 'customtabs',
        enableSiteSettingsShortcut: true,
        orientation: 'default',
        webManifestUrl: `${cleanOrigin}/manifest.json`,
      },
      null,
      2
    )
  );

  // 3. One-command Bubblewrap script
  write(
    'build-apk.sh',
    `#!/usr/bin/env bash
set -euo pipefail
echo "Building ClipVault Android APK via Bubblewrap..."
npx @bubblewrap/cli update --manifest="${cleanOrigin}/manifest.json" || true
npx @bubblewrap/cli build
echo "Done! Look for app-release-signed.apk in this directory."
`
  );

  // 4. GitHub Actions automated cloud APK builder
  write(
    '.github/workflows/build-apk.yml',
    `name: Build ClipVault Android APK

on:
  workflow_dispatch:
  push:
    branches: [ main, master ]

jobs:
  build-apk:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout project
        uses: actions/checkout@v4

      - name: Set up JDK 17
        uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: '17'

      - name: Set up Android SDK
        uses: android-actions/setup-android@v3

      - name: Set up Gradle
        uses: gradle/actions/setup-gradle@v4
        with:
          gradle-version: '8.7'

      - name: Assemble Android APK
        working-directory: android
        run: gradle assembleDebug

      - name: Upload ClipVault.apk Artifact
        uses: actions/upload-artifact@v4
        with:
          name: ClipVault-APK
          path: android/app/build/outputs/apk/debug/app-debug.apk
`
  );

  // 5. Complete Native Android Gradle + Kotlin WebView Project (supports YouTube Share Intent + Downloads + File Picker)
  write(
    'android/settings.gradle.kts',
    `pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}
rootProject.name = "ClipVault"
include(":app")
`
  );

  write(
    'android/build.gradle.kts',
    `plugins {
    id("com.android.application") version "8.5.2" apply false
    id("org.jetbrains.kotlin.android") version "1.9.24" apply false
}
`
  );

  write(
    'android/gradle.properties',
    `org.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8
android.useAndroidX=true
kotlin.code.style=official
`
  );

  write(
    'android/app/build.gradle.kts',
    `plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.clipvault.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.clipvault.app"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"
        buildConfigField("String", "CLIPVAULT_URL", "\\"${cleanOrigin}\\"")
    }

    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.webkit:webkit:1.11.0")
}
`
  );

  write('android/app/proguard-rules.pro', '# Keep WebView JS interfaces if added\n');

  write(
    'android/app/src/main/AndroidManifest.xml',
    `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="28" />

    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:roundIcon="@mipmap/ic_launcher"
        android:supportsRtl="true"
        android:theme="@style/Theme.ClipVault"
        android:usesCleartextTraffic="false">

        <activity
            android:name=".MainActivity"
            android:configChanges="orientation|screenSize|keyboardHidden"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>

            <!-- Accept YouTube links directly from Android Share menu -->
            <intent-filter>
                <action android:name="android.intent.action.SEND" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="text/plain" />
            </intent-filter>
        </activity>
    </application>
</manifest>
`
  );

  write(
    'android/app/src/main/res/values/strings.xml',
    `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">ClipVault</string>
</resources>
`
  );

  write(
    'android/app/src/main/res/values/themes.xml',
    `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="Theme.ClipVault" parent="Theme.AppCompat.DayNight.NoActionBar">
        <item name="android:statusBarColor">#141517</item>
        <item name="android:navigationBarColor">#141517</item>
    </style>
</resources>
`
  );

  write(
    'android/app/src/main/java/com/clipvault/app/MainActivity.kt',
    `package com.clipvault.app

import android.annotation.SuppressLint
import android.app.DownloadManager
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.webkit.CookieManager
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import java.net.URLEncoder

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private var filePathCallback: ValueCallback<Array<Uri>>? = null

    private val filePickerLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val uris = WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
            filePathCallback?.onReceiveValue(uris)
            filePathCallback = null
        }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        webView = WebView(this)
        setContentView(webView)

        val settings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true
        settings.mediaPlaybackRequiresUserGesture = false
        settings.allowFileAccess = true
        settings.allowContentAccess = true
        settings.cacheMode = WebSettings.LOAD_DEFAULT

        webView.webViewClient = WebViewClient()
        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                view: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?
            ): Boolean {
                this@MainActivity.filePathCallback?.onReceiveValue(null)
                this@MainActivity.filePathCallback = filePathCallback
                val intent = fileChooserParams?.createIntent() ?: return false
                return try {
                    filePickerLauncher.launch(intent)
                    true
                } catch (_: Exception) {
                    this@MainActivity.filePathCallback = null
                    false
                }
            }
        }

        webView.setDownloadListener { url, userAgent, contentDisposition, mimeType, _ ->
            if (url.startsWith("http://") || url.startsWith("https://")) {
                val request = DownloadManager.Request(Uri.parse(url))
                val filename = URLUtil.guessFileName(url, contentDisposition, mimeType)
                request.setMimeType(mimeType)
                request.addRequestHeader("cookie", CookieManager.getInstance().getCookie(url))
                request.addRequestHeader("User-Agent", userAgent)
                request.setTitle(filename)
                request.setDescription("Downloading via ClipVault")
                request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, filename)
                val dm = getSystemService(DOWNLOAD_SERVICE) as DownloadManager
                dm.enqueue(request)
                Toast.makeText(this, "Saving $filename to Downloads", Toast.LENGTH_SHORT).show()
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack() else finish()
            }
        })

        loadUrlFromIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        loadUrlFromIntent(intent)
    }

    private fun loadUrlFromIntent(intent: Intent?) {
        val baseUrl = BuildConfig.CLIPVAULT_URL
        val sharedText = if (intent?.action == Intent.ACTION_SEND && intent.type == "text/plain") {
            intent.getStringExtra(Intent.EXTRA_TEXT)
        } else {
            null
        }

        if (!sharedText.isNullOrBlank()) {
            val encoded = URLEncoder.encode(sharedText.trim(), "UTF-8")
            webView.loadUrl("$baseUrl/?url=$encoded")
        } else {
            webView.loadUrl(baseUrl)
        }
    }
}
`
  );

  // Copy real generated PNG icons into mipmap folders
  const icon192 = path.resolve(process.cwd(), 'public/pwa-192x192.png');
  const icon512 = path.resolve(process.cwd(), 'public/pwa-512x512.png');
  const mipmapDir = path.join(rootDir, 'android/app/src/main/res/mipmap-xxxhdpi');
  fs.mkdirSync(mipmapDir, { recursive: true });
  if (fs.existsSync(icon192)) {
    fs.copyFileSync(icon192, path.join(mipmapDir, 'ic_launcher.png'));
  } else if (fs.existsSync(icon512)) {
    fs.copyFileSync(icon512, path.join(mipmapDir, 'ic_launcher.png'));
  }

  // Package into a clean standard ZIP archive using Python 3 stdlib zipfile
  const pyScript = `
import os, sys, zipfile
src, dst = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED) as zf:
    for root, _, files in os.walk(src):
        for f in files:
            full = os.path.join(root, f)
            rel = os.path.relpath(full, src)
            zf.write(full, os.path.join('ClipVault-Android-APK', rel))
`;
  await execFileAsync('python3', ['-c', pyScript, rootDir, zipPath]);
  await fs.promises.rm(rootDir, { recursive: true, force: true }).catch(() => {});

  return zipPath;
}
