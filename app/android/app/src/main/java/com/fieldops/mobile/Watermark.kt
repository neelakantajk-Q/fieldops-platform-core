package com.fieldops.mobile

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint

/** Anti-cheat watermark: stamps timestamp/GPS/user/plate onto proof photos. */
object Watermark {

    fun stamp(src: Bitmap, lines: List<String>): Bitmap {
        val maxW = 1280
        val bmp = if (src.width > maxW) {
            val scale = maxW.toFloat() / src.width
            Bitmap.createScaledBitmap(
                src, maxW, Math.round(src.height * scale), true
            )
        } else src

        val out = bmp.copy(Bitmap.Config.ARGB_8888, true)
        val canvas = Canvas(out)
        val density = out.width / 420f

        val barH = (lines.size * 26 + 20) * density
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.argb(170, 0, 0, 0)
        }
        canvas.drawRect(0f, out.height - barH, out.width.toFloat(), out.height.toFloat(), paint)

        val text = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE
            textSize = 16 * density
            isFakeBoldText = true
        }
        var y = out.height - barH + 22 * density
        for (line in lines) {
            canvas.drawText(line, 10 * density, y, text)
            y += 26 * density
        }
        if (bmp !== src) src.recycle()
        return out
    }
}
