using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Winzy.NotificationService.Entities;
using Winzy.NotificationService.Tests.Fixtures;
using Xunit;

namespace Winzy.NotificationService.Tests.Integration;

public class DeviceTokenEndpointTests : IClassFixture<NotificationServiceFixture>, IAsyncLifetime
{
    private readonly NotificationServiceFixture _fixture;
    private readonly Guid _userId = Guid.NewGuid();

    private CancellationToken CT => TestContext.Current.CancellationToken;

    public DeviceTokenEndpointTests(NotificationServiceFixture fixture) => _fixture = fixture;

    public async ValueTask InitializeAsync() => await _fixture.ResetDataAsync();
    public ValueTask DisposeAsync() => ValueTask.CompletedTask;

    // --- POST /notifications/devices ---

    [Fact]
    public async Task RegisterDevice_WebPush_CreatesToken()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        var response = await client.PostAsJsonAsync("/notifications/devices", new
        {
            platform = "web_push",
            token = "{\"endpoint\":\"https://push.example.com/sub/abc\",\"keys\":{\"p256dh\":\"key1\",\"auth\":\"key2\"}}",
            deviceId = "browser-abc-123"
        }, CT);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);

        using var db = _fixture.CreateDbContext();
        var saved = await db.DeviceTokens.FirstOrDefaultAsync(t => t.UserId == _userId, CT);
        Assert.NotNull(saved);
        Assert.Equal("web_push", saved.Platform);
        Assert.Equal("browser-abc-123", saved.DeviceId);
    }

    [Fact]
    public async Task RegisterDevice_UpsertsSameDeviceId()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        // First registration
        await client.PostAsJsonAsync("/notifications/devices", new
        {
            platform = "web_push",
            token = "old-token",
            deviceId = "device-1"
        }, CT);

        // Second registration with same device ID
        var response = await client.PostAsJsonAsync("/notifications/devices", new
        {
            platform = "web_push",
            token = "new-token",
            deviceId = "device-1"
        }, CT);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);

        using var db = _fixture.CreateDbContext();
        var tokens = await db.DeviceTokens.Where(t => t.UserId == _userId).ToListAsync(CT);
        Assert.Single(tokens);
        Assert.Equal("new-token", tokens[0].Token);
    }

    [Fact]
    public async Task RegisterDevice_InvalidPlatform_ReturnsBadRequest()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        var response = await client.PostAsJsonAsync("/notifications/devices", new
        {
            platform = "invalid_platform",
            token = "some-token",
            deviceId = "device-1"
        }, CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task RegisterDevice_MissingToken_ReturnsBadRequest()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        var response = await client.PostAsJsonAsync("/notifications/devices", new
        {
            platform = "web_push",
            token = "",
            deviceId = "device-1"
        }, CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task RegisterDevice_MissingUserId_ReturnsBadRequest()
    {
        using var client = _fixture.Factory.CreateClient();

        var response = await client.PostAsJsonAsync("/notifications/devices", new
        {
            platform = "web_push",
            token = "some-token"
        }, CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // --- DELETE /notifications/devices ---

    [Fact]
    public async Task UnregisterDevice_DeletesToken()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        // Register first
        await client.PostAsJsonAsync("/notifications/devices", new
        {
            platform = "web_push",
            token = "token-to-delete",
            deviceId = "device-to-remove"
        }, CT);

        // Now unregister
        var request = new HttpRequestMessage(HttpMethod.Delete, "/notifications/devices")
        {
            Content = JsonContent.Create(new { deviceId = "device-to-remove" })
        };
        var response = await client.SendAsync(request, CT);

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);

        using var db = _fixture.CreateDbContext();
        var remaining = await db.DeviceTokens.CountAsync(t => t.UserId == _userId, CT);
        Assert.Equal(0, remaining);
    }

    [Fact]
    public async Task UnregisterDevice_NotFound_Returns404()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);

        var request = new HttpRequestMessage(HttpMethod.Delete, "/notifications/devices")
        {
            Content = JsonContent.Create(new { deviceId = "nonexistent-device" })
        };
        var response = await client.SendAsync(request, CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task UnregisterDevice_DoesNotDeleteOtherUsersTokens()
    {
        var otherUserId = Guid.NewGuid();

        // Register device for other user
        using var otherClient = _fixture.CreateAuthenticatedClient(otherUserId);
        await otherClient.PostAsJsonAsync("/notifications/devices", new
        {
            platform = "web_push",
            token = "other-token",
            deviceId = "shared-device-id"
        }, CT);

        // Try to delete from our user
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var request = new HttpRequestMessage(HttpMethod.Delete, "/notifications/devices")
        {
            Content = JsonContent.Create(new { deviceId = "shared-device-id" })
        };
        var response = await client.SendAsync(request, CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);

        // Other user's token should still exist
        using var db = _fixture.CreateDbContext();
        var otherTokenExists = await db.DeviceTokens.AnyAsync(t => t.UserId == otherUserId, CT);
        Assert.True(otherTokenExists);
    }

    // --- GET /notifications/vapid-public-key ---

    [Fact]
    public async Task GetVapidPublicKey_WhenNotConfigured_ReturnsNotFound()
    {
        // The test fixture doesn't configure VAPID keys, so this should return 404
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var response = await client.GetAsync("/notifications/vapid-public-key", CT);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}
