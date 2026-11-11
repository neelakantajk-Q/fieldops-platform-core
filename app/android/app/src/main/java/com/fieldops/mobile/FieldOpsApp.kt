package com.fieldops.mobile

import android.app.Application

class FieldOpsApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Prefs.init(this)
        Notify.ensureChannels(this)
    }
}
