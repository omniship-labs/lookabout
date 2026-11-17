import XCTest
@testable import Lookabout

final class HubAuthTests: XCTestCase {
    // MARK: PKCE

    func testChallengeMatchesTheRFC7636Vector() {
        XCTAssertEqual(
            PKCE.challenge(for: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        )
    }

    func testMakesAFreshURLSafeVerifierWithItsChallenge() {
        let a = PKCE.make(), b = PKCE.make()
        XCTAssertEqual(a.verifier.count, 43)
        XCTAssertNil(a.verifier.range(of: "[^A-Za-z0-9_-]", options: .regularExpression))
        XCTAssertEqual(a.challenge, PKCE.challenge(for: a.verifier))
        XCTAssertNotEqual(a.verifier, b.verifier)
    }

    // MARK: Links

    func testParsesTheQRPairingLink() {
        let url = URL(string: "lookabout://hub?address=http%3A%2F%2Flookabout.local%3A8787&code=K7QM-2XPA")!
        XCTAssertEqual(HubLink.parse(url), .pair(address: "http://lookabout.local:8787", code: "K7QM-2XPA"))
    }

    func testParsesTheEndOfABrowserSignIn() {
        XCTAssertEqual(HubLink.parse(URL(string: "lookabout://hub/signed-in?code=abc123")!), .signedIn(code: "abc123"))
        XCTAssertEqual(
            HubLink.parse(URL(string: "lookabout://hub/signed-in?error=not_invited&message=Ask%20an%20admin")!),
            .signInFailed(message: "Ask an admin")
        )
        XCTAssertEqual(
            HubLink.parse(URL(string: "lookabout://hub/signed-in?error=cancelled")!),
            .signInFailed(message: "That sign-in didn’t work.")
        )
    }

    func testIgnoresLinksThatAreNotForTheHub() {
        for text in [
            "https://hub.example.com/?code=1",
            "lookabout://other?address=a&code=b",
            "lookabout://hub?address=only-an-address",
            "lookabout://hub/signed-in",
            "lookabout://hub/elsewhere?code=1",
        ] {
            XCTAssertNil(HubLink.parse(URL(string: text)!), text)
        }
    }

    // MARK: Addresses

    func testNormalizesHubAddresses() {
        XCTAssertEqual(HubAddress.normalize("lookabout.local")?.absoluteString, "http://lookabout.local:8787")
        XCTAssertEqual(HubAddress.normalize("  192.168.1.5 ")?.absoluteString, "http://192.168.1.5:8787")
        XCTAssertEqual(HubAddress.normalize("http://192.168.1.5:9000/")?.absoluteString, "http://192.168.1.5:9000")
        XCTAssertEqual(HubAddress.normalize("https://hub.example.com/some/path?x=1")?.absoluteString, "https://hub.example.com")
        XCTAssertNil(HubAddress.normalize(""))
        XCTAssertNil(HubAddress.normalize("http://"))
    }

    // MARK: Errors

    private func body(_ text: String) -> Data { Data(text.utf8) }

    func testMapsTheHubsErrorsToWhatTheAppDoes() {
        XCTAssertEqual(HubFailure.from(status: 401, body: body(#"{"code":"not_signed_in"}"#)), .notSignedIn)
        XCTAssertEqual(HubFailure.from(status: 423, body: nil), .setupRequired)
        XCTAssertEqual(HubFailure.from(status: 403, body: body(#"{"code":"admin_only"}"#)), .adminOnly)
        XCTAssertEqual(HubFailure.from(status: 403, body: body(#"{"code":"manage_only"}"#)), .manageOnly)
        XCTAssertEqual(HubFailure.from(status: 404, body: body(#"{"code":"not_found"}"#)), .notFound)
        XCTAssertEqual(
            HubFailure.from(status: 403, body: body(#"{"error":"Not allowed.","code":"bad_origin"}"#)),
            .other(status: 403, message: "Not allowed.")
        )
    }

    func testSaysHowLongToWaitWhenThereAreTooManyTries() {
        let failure = HubFailure.from(status: 429, body: nil, retryAfter: "120")
        XCTAssertEqual(failure, .tooManyTries(retryAfter: 120))
        XCTAssertEqual(failure.message, "Too many tries. Wait 2 min and try again.")
        XCTAssertEqual(HubFailure.from(status: 429, body: nil).message, "Too many tries. Wait a bit and try again.")
    }

    func testAnErrorWithNoJSONBodyStillSaysSomething() {
        XCTAssertEqual(HubFailure.from(status: 500, body: body("<html>oops</html>")), .other(status: 500, message: "The hub answered 500."))
    }

    // MARK: /api/me

    private func me(cameras: Any?, role: String = "member") -> Any {
        var json: [String: Any] = [
            "member": ["id": "m-1", "name": "Sam", "role": role],
            "household": ["name": "Home"],
        ]
        if let cameras { json["cameras"] = cameras }
        return json
    }

    func testAnAdminSeesAndManagesEveryCamera() throws {
        let parsed = try XCTUnwrap(HubMe.parse(me(cameras: "all", role: "admin")))
        XCTAssertTrue(parsed.isAdmin)
        XCTAssertTrue(parsed.canSee("anything"))
        XCTAssertTrue(parsed.canManage("anything"))
    }

    func testAMemberOnlySeesWhatTheyAreGranted() throws {
        let parsed = try XCTUnwrap(HubMe.parse(me(cameras: ["cam-1": "manage", "cam-2": "view"])))
        XCTAssertTrue(parsed.canManage("cam-1"))
        XCTAssertTrue(parsed.canSee("cam-2"))
        XCTAssertFalse(parsed.canManage("cam-2"))
        XCTAssertFalse(parsed.canSee("cam-3"))
        XCTAssertEqual(parsed.visible(["cam-1", "cam-2", "cam-3"], id: { $0 }), ["cam-1", "cam-2"])
    }

    func testAnUnexpectedCamerasValueShowsNothingRatherThanEverything() throws {
        XCTAssertFalse(try XCTUnwrap(HubMe.parse(me(cameras: nil))).canSee("cam-1"))
        XCTAssertFalse(try XCTUnwrap(HubMe.parse(me(cameras: "some"))).canSee("cam-1"))
        XCTAssertFalse(try XCTUnwrap(HubMe.parse(me(cameras: ["cam-1": "owner"]))).canSee("cam-1"))
    }

    func testAReplyWithoutAMemberIsNotAMe() {
        XCTAssertNil(HubMe.parse(nil))
        XCTAssertNil(HubMe.parse([String: Any]()))
    }
}
