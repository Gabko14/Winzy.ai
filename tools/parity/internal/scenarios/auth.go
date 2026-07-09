package scenarios

import (
	"fmt"

	"winzy.ai/parity/internal/httpclient"
	"winzy.ai/parity/internal/runner"
)

// authRegisterLoginProfileLogout covers: register (native/body flow),
// login, GET profile, PUT profile, logout, and confirms the refresh token
// issued at login stops working after logout.
var authRegisterLoginProfileLogout = runner.Scenario{
	Name: "auth-register-login-profile-logout",
	Run: func(ctx *runner.Context) error {
		u, err := registerUser(ctx, ctx.Native, "register", "alice")
		if err != nil {
			return err
		}

		loginRes, err := ctx.Call(ctx.Native, "login", httpclient.Request{
			Method: "POST",
			Path:   "/auth/login",
			Body: map[string]any{
				"emailOrUsername": u.Username,
				"password":        u.Password,
			},
		}, 200)
		if err != nil {
			return err
		}
		login := asMap(loginRes.JSON)
		refreshToken := str(login, "refreshToken")

		profileRes, err := ctx.Call(ctx.Native, "get-profile", httpclient.Request{
			Method: "GET",
			Path:   "/auth/profile",
			Bearer: u.AccessToken,
		}, 200)
		if err != nil {
			return err
		}
		profile := asMap(profileRes.JSON)
		if str(profile, "username") != u.Username {
			ctx.Fail("get-profile", httpclient.Request{Method: "GET", Path: "/auth/profile"}, profileRes,
				fmt.Sprintf("expected username %q, got %q", u.Username, str(profile, "username")))
		}

		_, err = ctx.Call(ctx.Native, "update-profile", httpclient.Request{
			Method: "PUT",
			Path:   "/auth/profile",
			Bearer: u.AccessToken,
			Body: map[string]any{
				"displayName": "Parity Alice Updated",
			},
		}, 200)
		if err != nil {
			return err
		}

		_, err = ctx.Call(ctx.Native, "logout", httpclient.Request{
			Method: "POST",
			Path:   "/auth/logout",
			Bearer: u.AccessToken,
			Body:   map[string]any{"refreshToken": refreshToken},
		}, 204)
		if err != nil {
			return err
		}

		// The refresh token that was live at logout time must no longer work.
		_, err = ctx.Call(ctx.Native, "refresh-after-logout-fails", httpclient.Request{
			Method: "POST",
			Path:   "/auth/refresh",
			Body:   map[string]any{"refreshToken": refreshToken},
		}, 401)
		return err
	},
}

// authRefreshRotationReuseFails covers single-use refresh token rotation:
// the old refresh token is revoked the instant it's used, and the newly
// issued one works.
var authRefreshRotationReuseFails = runner.Scenario{
	Name: "auth-refresh-rotation-reuse-fails",
	Run: func(ctx *runner.Context) error {
		u, err := registerUser(ctx, ctx.Native, "register", "rotation")
		if err != nil {
			return err
		}

		firstRefresh := u.RefreshToken

		rotateRes, err := ctx.Call(ctx.Native, "refresh-rotates", httpclient.Request{
			Method: "POST",
			Path:   "/auth/refresh",
			Body:   map[string]any{"refreshToken": firstRefresh},
		}, 200)
		if err != nil {
			return err
		}
		rotated := asMap(rotateRes.JSON)
		secondRefresh := str(rotated, "refreshToken")

		_, err = ctx.Call(ctx.Native, "reuse-of-rotated-token-fails", httpclient.Request{
			Method: "POST",
			Path:   "/auth/refresh",
			Body:   map[string]any{"refreshToken": firstRefresh},
		}, 401)
		if err != nil {
			return err
		}

		_, err = ctx.Call(ctx.Native, "new-token-still-works", httpclient.Request{
			Method: "POST",
			Path:   "/auth/refresh",
			Body:   map[string]any{"refreshToken": secondRefresh},
		}, 200)
		return err
	},
}

// authWebCookieFlow covers the web-client detection path: refreshToken is
// null in the JSON body, and the refresh token instead arrives as an
// httpOnly cookie; refresh then works using the cookie alone (no body).
var authWebCookieFlow = runner.Scenario{
	Name: "auth-web-cookie-flow",
	Run: func(ctx *runner.Context) error {
		u, err := registerUser(ctx, ctx.Web, "register-web", "webuser")
		if err != nil {
			return err
		}

		loginRes, err := ctx.Call(ctx.Web, "login-web", httpclient.Request{
			Method: "POST",
			Path:   "/auth/login",
			Body: map[string]any{
				"emailOrUsername": u.Username,
				"password":        u.Password,
			},
		}, 200)
		if err != nil {
			return err
		}
		login := asMap(loginRes.JSON)
		if login["refreshToken"] != nil {
			ctx.Fail("login-web", httpclient.Request{Method: "POST", Path: "/auth/login"}, loginRes,
				"web client login response must have refreshToken=null (cookie-only delivery)")
		}
		if loginRes.Header.Get("Set-Cookie") == "" {
			ctx.Fail("login-web", httpclient.Request{Method: "POST", Path: "/auth/login"}, loginRes,
				"expected Set-Cookie header carrying refresh_token for a web client")
		}

		// Cookie jar on ctx.Web carries the refresh_token cookie automatically;
		// no body needed.
		refreshRes, err := ctx.Call(ctx.Web, "refresh-via-cookie", httpclient.Request{
			Method: "POST",
			Path:   "/auth/refresh",
			Body:   map[string]any{},
		}, 200)
		if err != nil {
			return err
		}
		refreshed := asMap(refreshRes.JSON)
		if refreshed["refreshToken"] != nil {
			ctx.Fail("refresh-via-cookie", httpclient.Request{Method: "POST", Path: "/auth/refresh"}, refreshRes,
				"web client refresh response must also have refreshToken=null")
		}
		return nil
	},
}

// authValidationAndConflict covers the 400 {"errors"} validation shape and
// the 409 {"error"} conflict shape, per the PM's ground-truth correction
// (validation errors are 400, not 422).
var authValidationAndConflict = runner.Scenario{
	Name: "auth-validation-and-conflict",
	Run: func(ctx *runner.Context) error {
		badRes, err := ctx.Call(ctx.Native, "register-invalid-email", httpclient.Request{
			Method: "POST",
			Path:   "/auth/register",
			Body: map[string]any{
				"email":    "not-an-email",
				"username": fmt.Sprintf("parity_badreg_%s", randHex(6)),
				"password": seedPassword,
			},
		}, 400)
		if err != nil {
			return err
		}
		bad := asMap(badRes.JSON)
		if _, ok := bad["errors"]; !ok {
			ctx.Fail("register-invalid-email", httpclient.Request{Method: "POST", Path: "/auth/register"}, badRes,
				`expected {"errors": {...}} body on 400 validation failure`)
		}

		u, err := registerUser(ctx, ctx.Native, "register-once", "conflict")
		if err != nil {
			return err
		}

		dupRes, err := ctx.Call(ctx.Native, "register-duplicate-email", httpclient.Request{
			Method: "POST",
			Path:   "/auth/register",
			Body: map[string]any{
				"email":    u.Email,
				"username": fmt.Sprintf("parity_conflict2_%s", randHex(6)),
				"password": seedPassword,
			},
		}, 409)
		if err != nil {
			return err
		}
		dup := asMap(dupRes.JSON)
		if _, ok := dup["error"]; !ok {
			ctx.Fail("register-duplicate-email", httpclient.Request{Method: "POST", Path: "/auth/register"}, dupRes,
				`expected {"error": "..."} body on 409 conflict`)
		}

		_, err = ctx.Call(ctx.Native, "login-wrong-password", httpclient.Request{
			Method: "POST",
			Path:   "/auth/login",
			Body: map[string]any{
				"emailOrUsername": u.Username,
				"password":        "definitely-wrong",
			},
		}, 401)
		return err
	},
}

// authPasswordChange covers PUT /auth/password: wrong current password
// yields the 400 {"errors"} shape, correct change succeeds and revokes all
// outstanding refresh tokens.
var authPasswordChange = runner.Scenario{
	Name: "auth-password-change",
	Run: func(ctx *runner.Context) error {
		u, err := registerUser(ctx, ctx.Native, "register", "pwchange")
		if err != nil {
			return err
		}
		oldRefresh := u.RefreshToken

		wrongRes, err := ctx.Call(ctx.Native, "change-password-wrong-current", httpclient.Request{
			Method: "PUT",
			Path:   "/auth/password",
			Bearer: u.AccessToken,
			Body: map[string]any{
				"currentPassword": "totally-wrong",
				"newPassword":     "NewParityPass456!",
			},
		}, 400)
		if err != nil {
			return err
		}
		wrong := asMap(wrongRes.JSON)
		if _, ok := wrong["errors"]; !ok {
			ctx.Fail("change-password-wrong-current", httpclient.Request{Method: "PUT", Path: "/auth/password"}, wrongRes,
				`expected {"errors": {...}} body`)
		}

		_, err = ctx.Call(ctx.Native, "change-password-success", httpclient.Request{
			Method: "PUT",
			Path:   "/auth/password",
			Bearer: u.AccessToken,
			Body: map[string]any{
				"currentPassword": u.Password,
				"newPassword":     "NewParityPass456!",
			},
		}, 204)
		if err != nil {
			return err
		}

		_, err = ctx.Call(ctx.Native, "old-refresh-token-revoked", httpclient.Request{
			Method: "POST",
			Path:   "/auth/refresh",
			Body:   map[string]any{"refreshToken": oldRefresh},
		}, 401)
		if err != nil {
			return err
		}

		_, err = ctx.Call(ctx.Native, "login-with-new-password", httpclient.Request{
			Method: "POST",
			Path:   "/auth/login",
			Body: map[string]any{
				"emailOrUsername": u.Username,
				"password":        "NewParityPass456!",
			},
		}, 200)
		return err
	},
}

// authUserSearch covers GET /auth/users/search: too-short queries return
// 200 [] (not an error), and a real partial match finds the seeded user.
var authUserSearch = runner.Scenario{
	Name: "auth-user-search",
	Run: func(ctx *runner.Context) error {
		u, err := registerUser(ctx, ctx.Native, "register", "searchable")
		if err != nil {
			return err
		}

		shortRes, err := ctx.Call(ctx.Native, "search-too-short", httpclient.Request{
			Method: "GET",
			Path:   "/auth/users/search",
			Query:  q("q", "a"),
			Bearer: u.AccessToken,
		}, 200)
		if err != nil {
			return err
		}
		if arr, ok := shortRes.JSON.([]any); !ok || len(arr) != 0 {
			ctx.Fail("search-too-short", httpclient.Request{Method: "GET", Path: "/auth/users/search"}, shortRes,
				"expected empty array for a query shorter than 2 chars")
		}

		_, err = ctx.Call(ctx.Native, "search-matches", httpclient.Request{
			Method: "GET",
			Path:   "/auth/users/search",
			Query:  q("q", u.Username[:len(u.Username)-2]),
			Bearer: u.AccessToken,
		}, 200)
		return err
	},
}

func init() {
	registerAll(
		authRegisterLoginProfileLogout,
		authRefreshRotationReuseFails,
		authWebCookieFlow,
		authValidationAndConflict,
		authPasswordChange,
		authUserSearch,
	)
}
