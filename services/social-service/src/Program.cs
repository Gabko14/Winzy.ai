using Winzy.Common.Health;
using Winzy.Common.Http;
using Winzy.Common.Messaging;
using Winzy.Common.Observability;
using Winzy.Common.Persistence;
using Winzy.SocialService.Data;
using Winzy.SocialService.Endpoints;
using Winzy.SocialService.Subscribers;

var builder = WebApplication.CreateBuilder(args);

builder.AddObservability("social-service");
builder.Services.AddServiceDatabase<SocialDbContext>(builder.Configuration);
builder.Services.AddNatsMessaging(builder.Configuration);
builder.Services.AddHostedService<UserDeletedSubscriber>();
builder.Services.AddHostedService<HabitCreatedSubscriber>();
builder.Services.AddHostedService<HabitArchivedSubscriber>();
builder.Services.AddOpenApi();
builder.Services.AddHealthChecks()
    .AddDbContextCheck<SocialDbContext>()
    .AddNatsHealthCheck();

builder.Services.AddServiceHttpClient(builder.Configuration, "HabitService", "HabitServiceUrl", "http://habit-service:5002");
builder.Services.AddServiceHttpClient(builder.Configuration, "AuthService", "AuthServiceUrl", "http://auth-service:5001");

var app = builder.Build();

app.UseObservability();
app.MapOpenApi();
app.MapServiceHealthChecks();

// --- Route map ---
app.MapFriendEndpoints();
app.MapVisibilityEndpoints();
app.MapWitnessLinkEndpoints();
app.MapInternalEndpoints();

app.Run();
// Make Program accessible for WebApplicationFactory in tests
public partial class Program;
