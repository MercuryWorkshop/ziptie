plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "org.webrtc.stub"
    compileSdk = 35

    defaultConfig {
        minSdk = 21
    }
}

dependencies {
    implementation("androidx.annotation:annotation:1.6.0")
}
