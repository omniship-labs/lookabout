package dev.omniship.lookabout.hub

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * The session token, encrypted with an AES-GCM key that never leaves the Android
 * Keystore. Only the ciphertext is in SharedPreferences (never the token, never a URL).
 */
class TokenVault(context: Context) {
    private val prefs = context.getSharedPreferences("lookabout-hub", Context.MODE_PRIVATE)

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generator.generateKey()
    }

    fun save(token: String) {
        val cipher = Cipher.getInstance(TRANSFORM).apply { init(Cipher.ENCRYPT_MODE, key()) }
        val sealed = cipher.doFinal(token.toByteArray(Charsets.UTF_8))
        prefs.edit()
            .putString("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
            .putString("token", Base64.encodeToString(sealed, Base64.NO_WRAP))
            .apply()
    }

    /** null when nothing is saved, or the key is gone (a restored backup, a new lock screen): sign in again. */
    fun load(): String? = runCatching {
        val iv = Base64.decode(prefs.getString("iv", null) ?: return null, Base64.NO_WRAP)
        val sealed = Base64.decode(prefs.getString("token", null) ?: return null, Base64.NO_WRAP)
        val cipher = Cipher.getInstance(TRANSFORM).apply { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, iv)) }
        String(cipher.doFinal(sealed), Charsets.UTF_8)
    }.getOrNull()

    fun clear() = prefs.edit().remove("iv").remove("token").apply()

    private companion object {
        const val ALIAS = "lookabout-hub-token"
        const val TRANSFORM = "AES/GCM/NoPadding"
    }
}
