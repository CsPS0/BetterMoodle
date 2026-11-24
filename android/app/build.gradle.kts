import groovy.json.JsonSlurper

plugins {
    id("com.android.application")
}

// Single source of truth: the extension manifest (the release workflow stamps it from the git tag).
val extensionDir = rootProject.file("../extension")
val manifest = JsonSlurper().parse(extensionDir.resolve("manifest.json")) as Map<*, *>
val extVersion = manifest["version"] as String
val (vMajor, vMinor, vPatch) = extVersion.split(".").map { it.toInt() }

android {
    namespace = "io.github.csps0.bettermoodle"
    compileSdk = 36

    defaultConfig {
        applicationId = "io.github.csps0.bettermoodle"
        minSdk = 29
        targetSdk = 36
        versionName = extVersion
        versionCode = vMajor * 10000 + vMinor * 100 + vPatch
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

// The wrapper ships the extension's own content.js / content.css unchanged.
androidComponents {
    onVariants { variant ->
        variant.sources.assets?.addStaticSourceDirectory(extensionDir.resolve("content").absolutePath)
    }
}

dependencies {
    implementation("androidx.activity:activity:1.13.0")
    implementation("androidx.webkit:webkit:1.15.0")
}
