// Top-level build file where you can add configuration options common to all sub-projects/modules.
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.compose) apply false
    id("com.google.gms.google-services") version "4.4.2" apply false
}

allprojects {
    // Repositories are configured in settings.gradle.kts via
    // dependencyResolutionManagement to enforce a single source of truth.
    // Do not declare repositories here when repositoriesMode is
    // RepositoriesMode.FAIL_ON_PROJECT_REPOS.
}