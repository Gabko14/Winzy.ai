using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Winzy.NotificationService.Tests.Fixtures;
using Xunit;

namespace Winzy.NotificationService.Tests.Integration;

public class ErrorHandlingTests : IClassFixture<NotificationServiceFixture>, IAsyncLifetime
{
    private readonly NotificationServiceFixture _fixture;
    private readonly Guid _userId = Guid.NewGuid();

    private CancellationToken CT => TestContext.Current.CancellationToken;

    public ErrorHandlingTests(NotificationServiceFixture fixture) => _fixture = fixture;

    public async ValueTask InitializeAsync() => await _fixture.ResetDataAsync();
    public ValueTask DisposeAsync() => ValueTask.CompletedTask;

    // --- PUT /notifications/settings — invalid JSON ---

    [Fact]
    public async Task UpdateSettings_InvalidJson_Returns400()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var content = new StringContent("not valid json{{{", Encoding.UTF8, "application/json");
        var response = await client.PutAsync("/notifications/settings", content, CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal("Invalid JSON in request body", body.GetProperty("error").GetString());
    }

    [Fact]
    public async Task UpdateSettings_HtmlBody_Returns400()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var content = new StringContent("<html>not json</html>", Encoding.UTF8, "application/json");
        var response = await client.PutAsync("/notifications/settings", content, CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal("Invalid JSON in request body", body.GetProperty("error").GetString());
    }

    // --- POST /notifications/devices — invalid JSON ---

    [Fact]
    public async Task RegisterDevice_InvalidJson_Returns400()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var content = new StringContent("{broken json", Encoding.UTF8, "application/json");
        var response = await client.PostAsync("/notifications/devices", content, CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal("Invalid JSON in request body", body.GetProperty("error").GetString());
    }

    [Fact]
    public async Task RegisterDevice_BinaryGarbage_Returns400()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var content = new StringContent("\x00\x01\x02", Encoding.UTF8, "application/json");
        var response = await client.PostAsync("/notifications/devices", content, CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // --- DELETE /notifications/devices — invalid JSON ---

    [Fact]
    public async Task UnregisterDevice_InvalidJson_Returns400()
    {
        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var request = new HttpRequestMessage(HttpMethod.Delete, "/notifications/devices")
        {
            Content = new StringContent("%%%not-json%%%", Encoding.UTF8, "application/json")
        };
        var response = await client.SendAsync(request, CT);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        Assert.Equal("Invalid JSON in request body", body.GetProperty("error").GetString());
    }

    // --- Valid JSON data renders correctly through TryParseJson ---

    [Fact]
    public async Task GetNotifications_ValidJsonData_ReturnsDataAsObject()
    {
        using var db = _fixture.CreateDbContext();
        db.Notifications.Add(new Entities.Notification
        {
            UserId = _userId,
            Type = Entities.NotificationType.HabitCompleted,
            Data = """{"habitName":"Meditation","streak":5}"""
        });
        await db.SaveChangesAsync(CT);

        using var client = _fixture.CreateAuthenticatedClient(_userId);
        var response = await client.GetAsync("/notifications", CT);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(CT);
        var items = body.GetProperty("items");
        Assert.Equal(1, items.GetArrayLength());
        var data = items[0].GetProperty("data");
        Assert.Equal("Meditation", data.GetProperty("habitName").GetString());
        Assert.Equal(5, data.GetProperty("streak").GetInt32());
    }
}
