package com.genymobile.scrcpy.wrappers;

import com.genymobile.scrcpy.FakeContext;
import com.genymobile.scrcpy.util.Ln;
import android.os.IInterface;
import android.os.UserHandle;

import java.lang.reflect.Method;

public final class WindowManager {
    private final IInterface manager;
    private static Method setForcedDisplaySizeMethod;
    private static Method setForcedDisplayDensityForUserMethod;

    private WindowManager(IInterface manager) {
        this.manager = manager;
    }

    public static WindowManager create() {
        try {
            IInterface manager = ServiceManager.getService("window", "android.view.IWindowManager");
            return new WindowManager(manager);
        } catch (Exception e) {
            Ln.e("Could not create WindowManager", e);
            return null;
        }
    }

    public boolean setForcedDisplaySize(int displayId, int width, int height) {
        try {
            if (setForcedDisplaySizeMethod == null) {
                setForcedDisplaySizeMethod = manager.getClass().getMethod("setForcedDisplaySize", int.class, int.class, int.class);
            }
            setForcedDisplaySizeMethod.invoke(manager, displayId, width, height);
            return true;
        } catch (Exception e) {
            Ln.e("Could not set forced display size", e);
            return false;
        }
    }

    public boolean setForcedDisplayDensity(int displayId, int density) {
        try {
            if (setForcedDisplayDensityForUserMethod == null) {
                setForcedDisplayDensityForUserMethod = manager.getClass().getMethod("setForcedDisplayDensityForUser", int.class, int.class, int.class);
            }
            Class<?> userHandleClass = Class.forName("android.os.UserHandle");
            Method getCallingUserIdMethod = userHandleClass.getMethod("getCallingUserId");
            int userId = (int) getCallingUserIdMethod.invoke(null);
            setForcedDisplayDensityForUserMethod.invoke(manager, displayId, density, userId);
            return true;
        } catch (Exception e) {
            Ln.e("Could not set forced display density", e);
            return false;
        }
    }
} 