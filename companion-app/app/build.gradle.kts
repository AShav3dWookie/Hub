import groovy.json.JsonSlurper

plugins {
    id("com.android.application")
}

// One version for the whole repo: the app reads the root package.json that `npm run release`
// bumps, so a release tag, the server image and the APK always agree. 1.2.3 -> code 10203.
val repoVersion = (JsonSlurper().parse(rootDir.resolve("../package.json")) as Map<*, *>)["version"] as String
val (major, minor, patch) = repoVersion.split(".").map { it.toInt() }

// Release signing comes from the environment (scripts/run.sh, or CI secrets) and never from the
// repo. Without it the release APK is unsigned — buildable, but not installable.
val keystorePath: String? = System.getenv("COMPANION_KEYSTORE")

android {
    namespace = "uk.aaronhanna.hub.companion"
    compileSdk {
        version = release(37)
    }
    // The image's build-tools (docker/Dockerfile). Left to AGP's default, every run in the
    // throwaway container downloaded another version first.
    buildToolsVersion = "37.0.0"

    defaultConfig {
        applicationId = "uk.aaronhanna.hub.companion"
        // Android 12: the Pixel 6 shipped with it, and it brings the widget and speech APIs used.
        minSdk = 31
        targetSdk = 37
        versionCode = major * 10_000 + minor * 100 + patch
        versionName = repoVersion
    }

    signingConfigs {
        if (keystorePath != null) {
            create("release") {
                storeFile = file(keystorePath)
                storePassword = System.getenv("COMPANION_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("COMPANION_KEY_ALIAS")
                keyPassword = System.getenv("COMPANION_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    testOptions {
        // Robolectric needs the merged resources to inflate layouts and widgets.
        unitTests.isIncludeAndroidResources = true
        // HubClient logs a failed connection with android.util.Log, a stub on the plain JVM.
        unitTests.isReturnDefaultValues = true
    }
}

// The contract test talks to a real hub at HUB_URL (scripts/contract-test.sh sets it). It is
// not an input Gradle knows about, so without this a contract run after a normal one would be
// skipped as up to date.
tasks.withType<Test>().configureEach {
    // Robolectric's Android 17 framework (ApplicationSharedMemory) reaches into a JDK-internal
    // package; JDK 21 refuses unless the test JVM exports it.
    jvmArgs("--add-exports=java.base/jdk.internal.access=ALL-UNNAMED")

    val hubUrl = System.getenv("HUB_URL") ?: ""
    inputs.property("hubUrl", hubUrl)
    if (hubUrl.isNotEmpty()) outputs.upToDateWhen { false }
}

dependencies {
    implementation("androidx.core:core-ktx:1.19.1")
    implementation("androidx.activity:activity-ktx:1.13.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.11.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.11.0")
    // Geofencing and a one-off current location: battery-friendly in a way raw GPS isn't.
    implementation("com.google.android.gms:play-services-location:21.4.0")
    // Play Services brings an old androidx.fragment, whose activity-result handling is broken
    // (lint's InvalidFragmentVersionForActivityResult); this lifts it to a current one.
    implementation("androidx.fragment:fragment:1.9.1")
    // Sends "Got it" taps made with no signal once the hub is reachable, across restarts too.
    implementation("androidx.work:work-runtime-ktx:2.12.0")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.17")
    testImplementation("androidx.test:core:1.7.0")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.11.0")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.1")
    testImplementation("androidx.work:work-testing:2.12.0")
    // android.jar's org.json is a stub on the plain JVM; the real one for the non-Robolectric tests.
    testImplementation("org.json:json:20260814")
}
