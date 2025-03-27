package org.mercuryworkshop.ziptie

import android.content.Intent
import android.content.pm.PackageInfo
import android.os.Build
import android.os.IInterface
import android.util.Log
import java.lang.reflect.Method

import android.content.pm.PackageManager;
import android.os.UserHandle

class PackageManager(private val manager: IInterface) {
    companion object {
        private const val TAG = "Ziptie.PackageManager"
    }

    private val getPackageInfoMethod: Method by lazy {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) manager.javaClass.getMethod(
            "getPackageInfo",
            String::class.java, java.lang.Long.TYPE, Integer.TYPE
        ) else manager.javaClass.getMethod(
            "getPackageInfo",
            String::class.java, Integer.TYPE, Integer.TYPE
        )
    }

    private val getLaunchIntentForPackageMethod by lazy {
        manager.javaClass.getMethod(
            "getLaunchIntentForPackage",
            String::class.java, Int::class.javaPrimitiveType
        )
    }

    private val getInstalledPackagesMethod by lazy {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            manager.javaClass.getMethod(
                "getInstalledPackages",
                Long::class.javaPrimitiveType, Int::class.javaPrimitiveType
            )
        } else {
            manager.javaClass.getMethod(
                "getInstalledPackages",
                Int::class.javaPrimitiveType, Int::class.javaPrimitiveType
            )
        }
    }

    fun getLaunchIntentForPackage(packageName: String): Intent? {
        Log.i(TAG, "Get launch intent for package: $packageName")
        return getLaunchIntentForPackageMethod.invoke(manager, packageName, 0) as? Intent
    }

    fun getInstalledPackages(flags: Int): List<PackageInfo> {
        return FakeContext.get().packageManager.getInstalledPackages(PackageManager.GET_ACTIVITIES);
    }

    fun getPackageInfo(packageName: String, flags: Int): PackageInfo {
        Log.i(TAG, "Get package info: $packageName")

        return getPackageInfoMethod.invoke(manager, packageName, flags, 0) as PackageInfo
    }
}