package com.awlirezaz.qafiyehbaz;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;

import androidx.annotation.RequiresApi;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Puts a finished video file (written by the web app into the app cache) into the phone's gallery.
 *
 * Android 10+ : inserted through MediaStore into Movies/<album> (no permission needed). The entry stays
 *               "pending" until the copy is complete, so the gallery only ever sees the whole video.
 * Android 7–9 : copied into the public Movies/<album> folder (WRITE_EXTERNAL_STORAGE, asked for by the
 *               web app first) and handed to the media scanner.
 *
 * JS: GallerySaver.saveVideo({ path: "file:///…/cache/x.webm", name: "x.webm", mime: "video/webm", album: "Qafiyeh-Baz" })
 *     → { uri, folder }
 */
@CapacitorPlugin(name = "GallerySaver")
public class GallerySaverPlugin extends Plugin {

    @PluginMethod
    public void saveVideo(final PluginCall call) {
        final String path = call.getString("path");
        final String name = call.getString("name");
        final String mime = call.getString("mime", "video/mp4");
        final String album = call.getString("album", "Qafiyeh-Baz");
        if (path == null || name == null) {
            call.reject("path and name are required");
            return;
        }
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    String filePath = path.startsWith("file:") ? Uri.parse(path).getPath() : path;
                    File src = new File(filePath);
                    if (!src.isFile() || src.length() == 0) throw new IOException("recorded file not found");
                    JSObject ret = new JSObject();
                    ret.put("folder", Environment.DIRECTORY_MOVIES + "/" + album);
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        ret.put("uri", insertWithMediaStore(src, name, mime, album).toString());
                    } else {
                        ret.put("uri", Uri.fromFile(copyToPublicMovies(src, name, mime, album)).toString());
                    }
                    call.resolve(ret);
                } catch (Exception e) {
                    call.reject("Saving to the gallery failed: " + e.getMessage(), e);
                }
            }
        }).start();
    }

    @RequiresApi(api = Build.VERSION_CODES.Q)
    private Uri insertWithMediaStore(File src, String name, String mime, String album) throws IOException {
        ContentResolver resolver = getContext().getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.Video.Media.DISPLAY_NAME, name);
        values.put(MediaStore.Video.Media.MIME_TYPE, mime);
        values.put(MediaStore.Video.Media.RELATIVE_PATH, Environment.DIRECTORY_MOVIES + "/" + album);
        values.put(MediaStore.Video.Media.IS_PENDING, 1);
        Uri collection = MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
        Uri item = resolver.insert(collection, values);
        if (item == null) throw new IOException("MediaStore refused the new video");
        try {
            OutputStream out = resolver.openOutputStream(item);
            if (out == null) throw new IOException("could not open the gallery file");
            copy(src, out);
        } catch (IOException e) {
            resolver.delete(item, null, null);
            throw e;
        }
        ContentValues done = new ContentValues();
        done.put(MediaStore.Video.Media.IS_PENDING, 0);
        resolver.update(item, done, null, null);
        return item;
    }

    @SuppressWarnings("deprecation")
    private File copyToPublicMovies(File src, String name, String mime, String album) throws IOException {
        File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MOVIES), album);
        if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("could not create " + dir);
        File dst = new File(dir, name);
        copy(src, new FileOutputStream(dst));
        MediaScannerConnection.scanFile(getContext(), new String[] { dst.getAbsolutePath() }, new String[] { mime }, null);
        return dst;
    }

    private static void copy(File src, OutputStream out) throws IOException {
        InputStream in = new FileInputStream(src);
        try {
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            out.flush();
        } finally {
            try { in.close(); } catch (IOException ignored) { }
            out.close();
        }
    }
}
