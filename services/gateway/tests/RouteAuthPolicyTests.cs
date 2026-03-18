using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Headers;
using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.IdentityModel.Tokens;

namespace Winzy.Gateway.Tests;

/// <summary>
/// Verifies that YARP routes enforce the correct authorization policies.
/// Public routes (register, login, refresh, habits/public, vapid-key) must
/// be reachable without a JWT. Protected routes must return 401 without one.
/// </summary>
[Collection("Gateway")]
public class RouteAuthPolicyTests : IDisposable
{
    private const string TestSecret = "test-secret-key-that-is-long-enough-for-hmac-sha256-validation";

    public RouteAuthPolicyTests()
    {
        Environment.SetEnvironmentVariable("Jwt__Secret", TestSecret);
    }

    public void Dispose()
    {
        Environment.SetEnvironmentVariable("Jwt__Secret", null);
    }

    private static HttpClient CreateClient()
    {
        var factory = new WebApplicationFactory<Program>();
        return factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            // Don't follow redirects — we want raw status codes
            AllowAutoRedirect = false
        });
    }

    private static string GenerateValidToken()
    {
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(TestSecret));
        var credentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var token = new JwtSecurityToken(
            claims:
            [
                new Claim(JwtRegisteredClaimNames.Sub, Guid.NewGuid().ToString()),
                new Claim(JwtRegisteredClaimNames.Email, "test@example.com"),
                new Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString())
            ],
            expires: DateTime.UtcNow.AddMinutes(15),
            signingCredentials: credentials);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    // ── Public routes: no JWT required ──────────────────────────────────

    [Theory]
    [InlineData("/auth/register", "POST")]
    [InlineData("/auth/login", "POST")]
    [InlineData("/auth/refresh", "POST")]
    public async Task PublicAuthRoutes_DoNotReturn401(string path, string method)
    {
        using var client = CreateClient();
        var request = new HttpRequestMessage(new HttpMethod(method), path);
        // Send empty JSON body for POST routes
        request.Content = new StringContent("{}", Encoding.UTF8, "application/json");

        var response = await client.SendAsync(request, TestContext.Current.CancellationToken);

        // These routes proxy to auth-service which isn't running, so we expect
        // a 502 (Bad Gateway) — NOT 401. The key assertion is that the gateway
        // did NOT reject the request for missing auth.
        Assert.NotEqual(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task HabitsPublicRoute_DoesNotRequireAuth()
    {
        using var client = CreateClient();

        var response = await client.GetAsync("/habits/public/someuser", TestContext.Current.CancellationToken);

        // Should proxy (502 since downstream isn't running), NOT reject for auth
        Assert.NotEqual(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task NotificationsVapidKeyRoute_DoesNotRequireAuth()
    {
        using var client = CreateClient();

        var response = await client.GetAsync("/notifications/vapid-public-key", TestContext.Current.CancellationToken);

        Assert.NotEqual(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // ── Protected routes: 401 without JWT ───────────────────────────────

    [Theory]
    [InlineData("/habits", "GET")]
    [InlineData("/habits", "POST")]
    [InlineData("/habits/some-id", "PUT")]
    [InlineData("/social/friends", "GET")]
    [InlineData("/challenges", "GET")]
    [InlineData("/challenges/some-id", "GET")]
    [InlineData("/notifications/subscribe", "POST")]
    [InlineData("/activity/feed", "GET")]
    [InlineData("/auth/profile", "GET")]
    [InlineData("/auth/logout", "POST")]
    public async Task ProtectedRoutes_Return401WithoutToken(string path, string method)
    {
        using var client = CreateClient();
        var request = new HttpRequestMessage(new HttpMethod(method), path);

        var response = await client.SendAsync(request, TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // ── Protected routes with valid JWT: should NOT get 401 ─────────────

    [Theory]
    [InlineData("/habits", "GET")]
    [InlineData("/social/friends", "GET")]
    [InlineData("/challenges", "GET")]
    [InlineData("/notifications/subscribe", "POST")]
    [InlineData("/activity/feed", "GET")]
    [InlineData("/auth/profile", "GET")]
    public async Task ProtectedRoutes_AcceptValidToken(string path, string method)
    {
        using var client = CreateClient();
        var token = GenerateValidToken();
        var request = new HttpRequestMessage(new HttpMethod(method), path);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.SendAsync(request, TestContext.Current.CancellationToken);

        // With a valid JWT the gateway should pass the request through (502 since
        // downstream isn't running), but must NOT return 401.
        Assert.NotEqual(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // ── Expired/invalid tokens: must be rejected ────────────────────────

    [Fact]
    public async Task ProtectedRoute_RejectsExpiredToken()
    {
        using var client = CreateClient();

        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(TestSecret));
        var credentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);
        var token = new JwtSecurityToken(
            claims: [new Claim(JwtRegisteredClaimNames.Sub, Guid.NewGuid().ToString())],
            expires: DateTime.UtcNow.AddMinutes(-5), // already expired
            signingCredentials: credentials);
        var tokenString = new JwtSecurityTokenHandler().WriteToken(token);

        var request = new HttpRequestMessage(HttpMethod.Get, "/habits");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", tokenString);

        var response = await client.SendAsync(request, TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task ProtectedRoute_RejectsTokenSignedWithWrongKey()
    {
        using var client = CreateClient();

        var wrongKey = new SymmetricSecurityKey(
            Encoding.UTF8.GetBytes("a-completely-different-secret-key-that-is-long-enough!!"));
        var credentials = new SigningCredentials(wrongKey, SecurityAlgorithms.HmacSha256);
        var token = new JwtSecurityToken(
            claims: [new Claim(JwtRegisteredClaimNames.Sub, Guid.NewGuid().ToString())],
            expires: DateTime.UtcNow.AddMinutes(15),
            signingCredentials: credentials);
        var tokenString = new JwtSecurityTokenHandler().WriteToken(token);

        var request = new HttpRequestMessage(HttpMethod.Get, "/habits");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", tokenString);

        var response = await client.SendAsync(request, TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task ProtectedRoute_RejectsGarbageToken()
    {
        using var client = CreateClient();
        var request = new HttpRequestMessage(HttpMethod.Get, "/habits");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", "not-a-real-jwt");

        var response = await client.SendAsync(request, TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // ── Route ordering: specific public routes win over catch-all auth ──

    [Fact]
    public async Task HabitsPublicRoute_TakesPriorityOverProtectedHabitsRoute()
    {
        using var client = CreateClient();

        // /habits/public/username should match habits-public-route (Order=1, no auth)
        // and NOT fall through to habits-route (Order=2, authenticated)
        var publicResponse = await client.GetAsync("/habits/public/testuser",
            TestContext.Current.CancellationToken);
        Assert.NotEqual(HttpStatusCode.Unauthorized, publicResponse.StatusCode);

        // /habits (no public prefix) should require auth
        var protectedResponse = await client.GetAsync("/habits",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Unauthorized, protectedResponse.StatusCode);
    }

    [Fact]
    public async Task AuthRegisterRoute_TakesPriorityOverProtectedAuthRoute()
    {
        using var client = CreateClient();

        // POST /auth/register should match auth-register-route (Order=1, no auth)
        var registerRequest = new HttpRequestMessage(HttpMethod.Post, "/auth/register")
        {
            Content = new StringContent("{}", Encoding.UTF8, "application/json")
        };
        var registerResponse = await client.SendAsync(registerRequest,
            TestContext.Current.CancellationToken);
        Assert.NotEqual(HttpStatusCode.Unauthorized, registerResponse.StatusCode);

        // GET /auth/profile should match auth-route (Order=2, authenticated)
        var profileResponse = await client.GetAsync("/auth/profile",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Unauthorized, profileResponse.StatusCode);
    }
}
