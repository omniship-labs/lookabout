package dev.omniship.lookabout.hub

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.security.SecureRandom

class HubAuthTest {
    // PKCE

    @Test
    fun pkceChallengeMatchesTheRfc7636Vector() {
        assertEquals(
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
            Pkce.challengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
        )
    }

    @Test
    fun pkceMakesAFreshUrlSafeVerifierWithItsChallenge() {
        val a = Pkce.make(SecureRandom())
        val b = Pkce.make(SecureRandom())
        assertEquals(43, a.verifier.length)
        assertTrue(a.verifier.matches(Regex("[A-Za-z0-9_-]+")))
        assertEquals(Pkce.challengeFor(a.verifier), a.challenge)
        assertNotEquals(a.verifier, b.verifier)
    }

    // Links

    @Test
    fun parsesTheQrPairingLink() {
        val link = HubLink.parse("lookabout://hub?address=http%3A%2F%2Flookabout.local%3A8787&code=K7QM-2XPA")
        assertEquals(HubLink.Pair("http://lookabout.local:8787", "K7QM-2XPA"), link)
    }

    @Test
    fun parsesTheEndOfABrowserSignIn() {
        assertEquals(HubLink.SignedIn("abc123"), HubLink.parse("lookabout://hub/signed-in?code=abc123"))
        assertEquals(
            HubLink.SignInFailed("Ask an admin"),
            HubLink.parse("lookabout://hub/signed-in?error=not_invited&message=Ask%20an%20admin"),
        )
        assertEquals(
            HubLink.SignInFailed("That sign-in didn’t work."),
            HubLink.parse("lookabout://hub/signed-in?error=cancelled"),
        )
    }

    @Test
    fun ignoresLinksThatAreNotForTheHub() {
        assertNull(HubLink.parse(null))
        assertNull(HubLink.parse("https://hub.example.com/?code=1"))
        assertNull(HubLink.parse("lookabout://other?address=a&code=b"))
        assertNull(HubLink.parse("lookabout://hub?address=only-an-address"))
        assertNull(HubLink.parse("lookabout://hub/signed-in"))
        assertNull(HubLink.parse("lookabout://hub/elsewhere?code=1"))
        assertNull(HubLink.parse("not a url"))
    }

    // Addresses

    @Test
    fun normalizesHubAddresses() {
        assertEquals("http://lookabout.local:8787", HubAddress.normalize("lookabout.local"))
        assertEquals("http://192.168.1.5:8787", HubAddress.normalize("  192.168.1.5 "))
        assertEquals("http://192.168.1.5:9000", HubAddress.normalize("http://192.168.1.5:9000/"))
        assertEquals("https://hub.example.com", HubAddress.normalize("HTTPS://hub.example.com/some/path?x=1"))
        assertNull(HubAddress.normalize(""))
        assertNull(HubAddress.normalize("http://"))
    }

    // Errors

    @Test
    fun mapsTheHubsErrorsToWhatTheAppDoes() {
        assertSame(HubFailure.NotSignedIn, HubFailure.from(401, """{"code":"not_signed_in"}"""))
        assertSame(HubFailure.SetupRequired, HubFailure.from(423, null))
        assertSame(HubFailure.AdminOnly, HubFailure.from(403, """{"code":"admin_only"}"""))
        assertSame(HubFailure.ManageOnly, HubFailure.from(403, """{"code":"manage_only"}"""))
        assertSame(HubFailure.NotFound, HubFailure.from(404, """{"code":"not_found"}"""))
        val other = HubFailure.from(403, """{"error":"Not allowed.","code":"bad_origin"}""") as HubFailure.Other
        assertEquals(403, other.status)
        assertEquals("Not allowed.", other.text)
    }

    @Test
    fun saysHowLongToWaitWhenThereAreTooManyTries() {
        val failure = HubFailure.from(429, null, "120") as HubFailure.TooManyTries
        assertEquals(120, failure.retryAfter)
        assertEquals("Too many tries. Wait 2 min and try again.", failure.text)
        assertEquals("Too many tries. Wait a bit and try again.", (HubFailure.from(429, null, null)).text)
    }

    @Test
    fun anErrorWithNoJsonBodyStillSaysSomething() {
        assertEquals("The hub answered 500.", HubFailure.from(500, "<html>oops</html>").text)
    }

    // /api/me

    private fun me(cameras: Any?, role: String = "member") = JSONObject()
        .put("member", JSONObject().put("id", "m-1").put("name", "Sam").put("role", role))
        .put("household", JSONObject().put("name", "Home"))
        .apply { if (cameras != null) put("cameras", cameras) }

    @Test
    fun anAdminSeesAndManagesEveryCamera() {
        val parsed = HubMe.parse(me("all", "admin"))!!
        assertTrue(parsed.isAdmin)
        assertTrue(parsed.canSee("anything"))
        assertTrue(parsed.canManage("anything"))
    }

    @Test
    fun aMemberOnlySeesWhatTheyAreGranted() {
        val parsed = HubMe.parse(me(JSONObject().put("cam-1", "manage").put("cam-2", "view")))!!
        assertTrue(parsed.canManage("cam-1"))
        assertTrue(parsed.canSee("cam-2"))
        assertFalse(parsed.canManage("cam-2"))
        assertFalse(parsed.canSee("cam-3"))
        assertEquals(listOf("cam-1", "cam-2"), parsed.visible(listOf("cam-1", "cam-2", "cam-3")) { it })
    }

    @Test
    fun anUnexpectedCamerasValueShowsNothingRatherThanEverything() {
        val missing = HubMe.parse(me(null))!!
        assertFalse(missing.canSee("cam-1"))
        val odd = HubMe.parse(me("some"))!!
        assertFalse(odd.canSee("cam-1"))
        val unknownLevel = HubMe.parse(me(JSONObject().put("cam-1", "owner")))!!
        assertFalse(unknownLevel.canSee("cam-1"))
    }

    @Test
    fun aReplyWithoutAMemberIsNotAMe() {
        assertNull(HubMe.parse(null))
        assertNull(HubMe.parse(JSONObject()))
    }

    private fun assertSame(expected: Any, actual: Any) = org.junit.Assert.assertSame(expected, actual)
}
