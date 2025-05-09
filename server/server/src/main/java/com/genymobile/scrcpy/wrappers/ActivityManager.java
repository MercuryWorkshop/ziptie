package com.genymobile.scrcpy.wrappers;

import com.genymobile.scrcpy.AndroidVersions;
import com.genymobile.scrcpy.FakeContext;
import com.genymobile.scrcpy.util.Ln;

import android.annotation.SuppressLint;
import android.annotation.TargetApi;
import android.content.IContentProvider;
import android.content.Intent;
import android.os.Binder;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.os.IInterface;
import android.os.UserHandle;
import android.util.Log;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.List;

@SuppressLint("PrivateApi,DiscouragedPrivateApi")
public final class ActivityManager {

    private final IInterface manager;
    private Method getContentProviderExternalMethod;
    private boolean getContentProviderExternalMethodNewVersion = true;
    private Method removeContentProviderExternalMethod;
    private Method startActivityAsUserMethod;
    private Method forceStopPackageMethod;
    private Method getRecentTasksMethod;

    static ActivityManager create() {
        try {
            // On old Android versions, the ActivityManager is not exposed via AIDL,
            // so use ActivityManagerNative.getDefault()
            Class<?> cls = Class.forName("android.app.ActivityManagerNative");
            Method getDefaultMethod = cls.getDeclaredMethod("getDefault");
            IInterface am = (IInterface) getDefaultMethod.invoke(null);
            return new ActivityManager(am);
        } catch (ReflectiveOperationException e) {
            throw new AssertionError(e);
        }
    }

    private ActivityManager(IInterface manager) {
        this.manager = manager;
    }

    private Method getGetContentProviderExternalMethod() throws NoSuchMethodException {
        if (getContentProviderExternalMethod == null) {
            try {
                getContentProviderExternalMethod = manager.getClass()
                        .getMethod("getContentProviderExternal", String.class, int.class, IBinder.class, String.class);
            } catch (NoSuchMethodException e) {
                // old version
                getContentProviderExternalMethod = manager.getClass().getMethod("getContentProviderExternal", String.class, int.class, IBinder.class);
                getContentProviderExternalMethodNewVersion = false;
            }
        }
        return getContentProviderExternalMethod;
    }

    private Method getRemoveContentProviderExternalMethod() throws NoSuchMethodException {
        if (removeContentProviderExternalMethod == null) {
            removeContentProviderExternalMethod = manager.getClass().getMethod("removeContentProviderExternal", String.class, IBinder.class);
        }
        return removeContentProviderExternalMethod;
    }

    @TargetApi(AndroidVersions.API_29_ANDROID_10)
    public IContentProvider getContentProviderExternal(String name, IBinder token) {
        try {
            Method method = getGetContentProviderExternalMethod();
            Object[] args;
            if (getContentProviderExternalMethodNewVersion) {
                // new version
                args = new Object[]{name, FakeContext.ROOT_UID, token, null};
            } else {
                // old version
                args = new Object[]{name, FakeContext.ROOT_UID, token};
            }
            // ContentProviderHolder providerHolder = getContentProviderExternal(...);
            Object providerHolder = method.invoke(manager, args);
            if (providerHolder == null) {
                return null;
            }
            // IContentProvider provider = providerHolder.provider;
            Field providerField = providerHolder.getClass().getDeclaredField("provider");
            providerField.setAccessible(true);
            return (IContentProvider) providerField.get(providerHolder);
        } catch (ReflectiveOperationException e) {
            Ln.e("Could not invoke method", e);
            return null;
        }
    }

    void removeContentProviderExternal(String name, IBinder token) {
        try {
            Method method = getRemoveContentProviderExternalMethod();
            method.invoke(manager, name, token);
        } catch (ReflectiveOperationException e) {
            Ln.e("Could not invoke method", e);
        }
    }

    public ContentProvider createSettingsProvider() {
        IBinder token = new Binder();
        IContentProvider provider = getContentProviderExternal("settings", token);
        if (provider == null) {
            return null;
        }
        return new ContentProvider(this, provider, "settings", token);
    }

    private Method getStartActivityAsUserMethod() throws NoSuchMethodException, ClassNotFoundException {
        if (startActivityAsUserMethod == null) {
            Class<?> iApplicationThreadClass = Class.forName("android.app.IApplicationThread");
            Class<?> profilerInfo = Class.forName("android.app.ProfilerInfo");
            startActivityAsUserMethod = manager.getClass()
                    .getMethod("startActivityAsUser", iApplicationThreadClass, String.class, Intent.class, String.class, IBinder.class, String.class,
                            int.class, int.class, profilerInfo, Bundle.class, int.class);
        }
        return startActivityAsUserMethod;
    }

    public int startActivity(Intent intent) {
        return startActivity(intent, null);
    }

    @SuppressWarnings("ConstantConditions")
    public int startActivity(Intent intent, Bundle options) {
        try {
            Method method = getStartActivityAsUserMethod();
            return (int) method.invoke(
                    /* this */ manager,
                    /* caller */ null,
                    /* callingPackage */ FakeContext.PACKAGE_NAME,
                    /* intent */ intent,
                    /* resolvedType */ null,
                    /* resultTo */ null,
                    /* resultWho */ null,
                    /* requestCode */ 0,
                    /* startFlags */ 0,
                    /* profilerInfo */ null,
                    /* bOptions */ options,
                    /* userId */ /* UserHandle.USER_CURRENT */ -2);
        } catch (Throwable e) {
            Ln.e("Could not invoke method", e);
            return 0;
        }
    }
//    @TargetApi(Build.VERSION_CODES.N)
//    @SuppressLint("PrivateApi")
//    public static IContentProvider getContentProviderExternalSettings(IInterface activityManager) {
//        try {
//            IBinder token = new Binder();
//            java.lang.reflect.Method method = activityManager.getClass().getMethod(
//                    "getContentProviderExternal",
//                    String.class,
//                    int.class,
//                    IBinder.class
//            );
//
//            Object provider = method.invoke(activityManager, "settings", UserHandle.getUserHandleForUid(2000), token);
//
//            // Handle the result based on Android version
//            if (provider != null) {
//                // For older versions, it might return an IContentProvider directly
//                if (provider instanceof IContentProvider) {
//                    return (IContentProvider) provider;
//                } else {
//                    // For newer versions, it might return a ContentProviderHolder
//                    java.lang.reflect.Field providerField = provider.getClass().getField("provider");
//                    return (IContentProvider) providerField.get(provider);
//                }
//            } else {
//                return null;
//            }
//        } catch (NoSuchMethodException e) {
//            Ln.d( "Error getting AAA: " + e.getMessage());
//        } catch (Exception e) {
//            Ln.d( "Error getting content provider: " + e.getMessage());
//            return null;
//        }
//    }
    private Method getForceStopPackageMethod() throws NoSuchMethodException {
        if (forceStopPackageMethod == null) {
            forceStopPackageMethod = manager.getClass().getMethod("forceStopPackage", String.class, int.class);
        }
        return forceStopPackageMethod;
    }

    public void forceStopPackage(String packageName) {
        try {
            Method method = getForceStopPackageMethod();
            method.invoke(manager, packageName, /* userId */ /* UserHandle.USER_CURRENT */ -2);
        } catch (Throwable e) {
            Ln.e("Could not invoke method", e);
        }
    }

    private Method getGetRecentTasksMethod() throws NoSuchMethodException {
        if (getRecentTasksMethod == null) {
            try {
                // Try the newer API first
                getRecentTasksMethod = manager.getClass().getMethod("getRecentTasks", int.class, int.class, int.class);
            } catch (NoSuchMethodException e) {
                // Fall back to older API
                getRecentTasksMethod = manager.getClass().getMethod("getRecentTasks", int.class, int.class);
            }
        }
        return getRecentTasksMethod;
    }

    @SuppressWarnings("unchecked")
    public List<android.app.ActivityManager.RecentTaskInfo> getRecentTasks(int maxNum, int flags) {
        try {
            Method method = getGetRecentTasksMethod();
            Object result;
            if (method.getParameterCount() == 3) {
                // Newer API with userId parameter
                result = method.invoke(manager, maxNum, flags, FakeContext.ROOT_UID);
            } else {
                // Older API without userId parameter
                result = method.invoke(manager, maxNum, flags);
            }
            
            // Handle ParceledListSlice
            if (result != null) {
                Class<?> parceledListSliceClass = Class.forName("android.content.pm.ParceledListSlice");
                if (parceledListSliceClass.isInstance(result)) {
                    Method getListMethod = parceledListSliceClass.getMethod("getList");
                    return (List<android.app.ActivityManager.RecentTaskInfo>) getListMethod.invoke(result);
                }
            }
            return null;
        } catch (ReflectiveOperationException e) {
            Ln.e("Could not get recent tasks", e);
            return null;
        }
    }
}
