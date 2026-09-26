import os
import sys
import shutil
import zipfile
import urllib.request
import subprocess
import glob

BUILD_DIR = r"D:\RoadShield AI\android_builder"
SDK_DIR = os.path.join(BUILD_DIR, "sdk")
JDK_DIR = os.path.join(BUILD_DIR, "jdk17")
PROJECT_DIR = r"D:\RoadShield AI\android_project"
OUTPUT_APK = r"D:\RoadShield AI\roadshield-ai.apk"

JDK_URL = "https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.10%2B7/OpenJDK17U-jdk_x64_windows_hotspot_17.0.10_7.zip"
SDK_URL = "https://dl.google.com/android/repository/commandlinetools-win-10406996_latest.zip"
GRADLE_URL = "https://services.gradle.org/distributions/gradle-8.5-bin.zip"

def download_and_extract(url, target_zip, extract_to):
    if not os.path.exists(target_zip):
        print(f"[DOWNLOAD] Downloading: {url}...")
        def progress(count, block_size, total_size):
            if total_size > 0:
                pct = int(count * block_size * 100 / total_size)
                sys.stdout.write(f"\rDownloading {os.path.basename(target_zip)}: {pct}%")
                sys.stdout.flush()
        urllib.request.urlretrieve(url, target_zip, reporthook=progress)
        print("\n[OK] Download completed.")

    if not os.path.exists(extract_to) or len(os.listdir(extract_to)) == 0:
        print(f"[EXTRACT] Extracting {target_zip} to {extract_to}...")
        os.makedirs(extract_to, exist_ok=True)
        with zipfile.ZipFile(target_zip, 'r') as zip_ref:
            zip_ref.extractall(extract_to)
        print("[OK] Extraction complete.")

def setup_environment():
    os.makedirs(BUILD_DIR, exist_ok=True)
    
    jdk_zip = os.path.join(BUILD_DIR, "jdk17.zip")
    download_and_extract(JDK_URL, jdk_zip, JDK_DIR)
    
    # Locate java bin dir
    java_home = None
    for root, dirs, files in os.walk(JDK_DIR):
        if "javac.exe" in files:
            java_home = os.path.dirname(os.path.dirname(os.path.join(root, "javac.exe")))
            break
            
    if not java_home:
        print("[ERROR] JDK installation failed.")
        sys.exit(1)
        
    print(f"[JAVA] JAVA_HOME configured: {java_home}")
    
    sdk_zip = os.path.join(BUILD_DIR, "sdk_tools.zip")
    cmdline_extract = os.path.join(SDK_DIR, "cmdline-tools")
    download_and_extract(SDK_URL, sdk_zip, cmdline_extract)
    
    # Fix cmdline-tools directory structure required by sdkmanager (cmdline-tools/latest/bin)
    latest_dir = os.path.join(cmdline_extract, "latest")
    if os.path.exists(latest_dir):
        shutil.rmtree(latest_dir)
        
    os.makedirs(latest_dir, exist_ok=True)
    
    # Look for the extracted bin directory
    inner_cmdline = os.path.join(cmdline_extract, "cmdline-tools")
    if os.path.exists(inner_cmdline):
        for item in os.listdir(inner_cmdline):
            src = os.path.join(inner_cmdline, item)
            dst = os.path.join(latest_dir, item)
            shutil.move(src, dst)
        shutil.rmtree(inner_cmdline)

    gradle_zip = os.path.join(BUILD_DIR, "gradle.zip")
    gradle_dir = os.path.join(BUILD_DIR, "gradle")
    download_and_extract(GRADLE_URL, gradle_zip, gradle_dir)
    
    gradle_home = None
    for root, dirs, files in os.walk(gradle_dir):
        if "gradle.bat" in files:
            gradle_home = root
            break

    return java_home, SDK_DIR, gradle_home

def install_sdk_components(java_home, sdk_dir):
    env = os.environ.copy()
    env["JAVA_HOME"] = java_home
    env["ANDROID_HOME"] = sdk_dir
    env["PATH"] = os.path.join(java_home, "bin") + ";" + os.path.join(sdk_dir, "cmdline-tools", "latest", "bin") + ";" + env["PATH"]
    
    sdkmanager = os.path.join(sdk_dir, "cmdline-tools", "latest", "bin", "sdkmanager.bat")
    
    print("[SDK] Creating license agreements...")
    licenses_dir = os.path.join(sdk_dir, "licenses")
    os.makedirs(licenses_dir, exist_ok=True)

    with open(os.path.join(licenses_dir, "android-sdk-license"), "w") as f:
        f.write("893737222f1906e11d70223f14cb7088f214dbb2\n7393598d36080ea47138b7779fea2b8725a12c0c\n243336874b1d24d771818a7284300bf54c5ce02e\n")

    with open(os.path.join(licenses_dir, "android-sdk-preview-license"), "w") as f:
        f.write("84831b9409646a918e30573bab4c9c91346d8abd\n")

    with open(os.path.join(licenses_dir, "intel-android-extra-license"), "w") as f:
        f.write("d975f751698a77b39ddd0b12179942d366b47309\n")

    print("[SDK] Installing Android SDK Platform 34 & Build-Tools 34.0.0...")
    # Pipe multiple y inputs to accept any additional prompts
    p = subprocess.Popen(f'"{sdkmanager}" --sdk_root="{sdk_dir}" --licenses', stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env, shell=True, text=True)
    try:
        p.communicate(input="y\ny\ny\ny\ny\ny\ny\ny\ny\ny\n", timeout=15)
    except Exception:
        p.kill()
    
    cmd_install = f'"{sdkmanager}" --sdk_root="{sdk_dir}" "platforms;android-34" "build-tools;34.0.0" "platform-tools"'
    res = subprocess.run(cmd_install, shell=True, env=env, capture_output=True, text=True)
    print("[SDK Output]:", res.stdout[:300])

def create_android_project():
    print(f"[PROJECT] Generating Android Native Project in: {PROJECT_DIR}...")
    if os.path.exists(PROJECT_DIR):
        shutil.rmtree(PROJECT_DIR)
        
    os.makedirs(os.path.join(PROJECT_DIR, "app", "src", "main", "java", "com", "roadshield", "ai"), exist_ok=True)
    os.makedirs(os.path.join(PROJECT_DIR, "app", "src", "main", "res", "values"), exist_ok=True)
    os.makedirs(os.path.join(PROJECT_DIR, "app", "src", "main", "res", "mipmap-hdpi"), exist_ok=True)
    
    # 1. Root build.gradle
    with open(os.path.join(PROJECT_DIR, "build.gradle"), "w") as f:
        f.write("""buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath 'com.android.tools.build:gradle:8.2.2'
    }
}
allprojects {
    repositories {
        google()
        mavenCentral()
    }
}
task clean(type: Delete) {
    delete rootProject.buildDir
}
""")

    # 2. settings.gradle
    with open(os.path.join(PROJECT_DIR, "settings.gradle"), "w") as f:
        f.write("include ':app'\nrootProject.name = 'RoadShieldAI'\n")

    # 3. gradle.properties
    with open(os.path.join(PROJECT_DIR, "gradle.properties"), "w") as f:
        f.write("""android.useAndroidX=true
android.enableJetifier=true
org.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8
""")

    # 4. app/build.gradle
    with open(os.path.join(PROJECT_DIR, "app", "build.gradle"), "w") as f:
        f.write("""apply plugin: 'com.android.application'

android {
    namespace 'com.roadshield.ai'
    compileSdk 34

    defaultConfig {
        applicationId "com.roadshield.ai"
        minSdk 24
        targetSdk 34
        versionCode 1
        versionName "1.0"
    }

    buildTypes {
        release {
            minifyEnabled false
            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
        }
    }
    
    compileOptions {
        sourceCompatibility JavaVersion.VERSION_17
        targetCompatibility JavaVersion.VERSION_17
    }
}

dependencies {
    implementation 'androidx.appcompat:appcompat:1.6.1'
    implementation 'com.google.android.material:material:1.11.0'
    implementation 'androidx.webkit:webkit:1.10.0'
}
""")

    # 5. AndroidManifest.xml
    with open(os.path.join(PROJECT_DIR, "app", "src", "main", "AndroidManifest.xml"), "w") as f:
        f.write("""<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <uses-permission android:name="android.permission.CAMERA" />
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" />
    <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" />
    <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />

    <uses-feature android:name="android.hardware.camera" android:required="true" />
    <uses-feature android:name="android.hardware.camera.autofocus" android:required="false" />
    <uses-feature android:name="android.hardware.location.gps" android:required="false" />

    <application
        android:allowBackup="true"
        android:label="RoadShield AI"
        android:supportsRtl="true"
        android:hardwareAccelerated="true"
        android:theme="@style/Theme.AppCompat.NoActionBar">
        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:configChanges="orientation|screenSize|keyboardHidden"
            android:screenOrientation="unspecified">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>

</manifest>
""")

    # 6. res/values/styles.xml & strings.xml
    with open(os.path.join(PROJECT_DIR, "app", "src", "main", "res", "values", "strings.xml"), "w") as f:
        f.write('<resources><string name="app_name">RoadShield AI</string></resources>')

    # 7. MainActivity.java
    with open(os.path.join(PROJECT_DIR, "app", "src", "main", "java", "com", "roadshield", "ai", "MainActivity.java"), "w") as f:
        f.write("""package com.roadshield.ai;

import android.Manifest;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.webkit.WebViewAssetLoader;

public class MainActivity extends AppCompatActivity {

    private static final int PERMISSION_REQ_CODE = 101;
    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        setContentView(webView);

        final WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setGeolocationEnabled(true);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, String url) {
                return assetLoader.shouldInterceptRequest(Uri.parse(url));
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> request.grant(request.getResources()));
            }

            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, android.webkit.GeolocationPermissions.Callback callback) {
                callback.invoke(origin, true, false);
            }
        });

        requestAppPermissions();
        webView.loadUrl("https://appassets.androidplatform.net/assets/index.html");
    }

    private void requestAppPermissions() {
        String[] permissions = {
            Manifest.permission.CAMERA,
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION,
            Manifest.permission.READ_EXTERNAL_STORAGE,
            Manifest.permission.WRITE_EXTERNAL_STORAGE
        };

        boolean needReq = false;
        for (String p : permissions) {
            if (ContextCompat.checkSelfPermission(this, p) != PackageManager.PERMISSION_GRANTED) {
                needReq = true;
                break;
            }
        }

        if (needReq) {
            ActivityCompat.requestPermissions(this, permissions, PERMISSION_REQ_CODE);
        }
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
""")

    # 8. Copy Assets from mobile_app/ to app/src/main/assets/
    assets_dst = os.path.join(PROJECT_DIR, "app", "src", "main", "assets")
    assets_src = r"D:\RoadShield AI\mobile_app"
    print(f"[ASSETS] Copying mobile web application & ONNX model into APK assets...")
    shutil.copytree(assets_src, assets_dst, dirs_exist_ok=True)

def build_apk(java_home, sdk_dir, gradle_home):
    env = os.environ.copy()
    env["JAVA_HOME"] = java_home
    env["ANDROID_HOME"] = sdk_dir
    env["PATH"] = os.path.join(java_home, "bin") + ";" + gradle_home + ";" + os.path.join(sdk_dir, "platform-tools") + ";" + env["PATH"]

    gradle_cmd = os.path.join(gradle_home, "gradle.bat")
    
    print("[BUILD] Compiling Android APK with Gradle...")
    cmd = f'"{gradle_cmd}" assembleDebug'
    res = subprocess.run(cmd, shell=True, cwd=PROJECT_DIR, env=env, capture_output=True, text=True)
    
    print("Gradle stdout tail:", res.stdout[-800:])
    if res.returncode != 0:
        print("[ERROR] Gradle compilation failed!")
        print("Stderr:", res.stderr[-1000:])
        sys.exit(1)

    # Locate generated APK
    apk_search = os.path.join(PROJECT_DIR, "app", "build", "outputs", "apk", "debug", "*.apk")
    found_apks = glob.glob(apk_search)
    if found_apks:
        built_apk = found_apks[0]
        shutil.copy(built_apk, OUTPUT_APK)
        print(f"\n[SUCCESS] Android APK successfully built and saved to:")
        print(f"-> {OUTPUT_APK} ({os.path.getsize(OUTPUT_APK)} bytes)")
    else:
        print("[ERROR] APK file not found after build.")
        sys.exit(1)

def main():
    print("=== RoadShield AI - Android APK Build System ===")
    java_home, sdk_dir, gradle_home = setup_environment()
    install_sdk_components(java_home, sdk_dir)
    create_android_project()
    build_apk(java_home, sdk_dir, gradle_home)

if __name__ == "__main__":
    main()
