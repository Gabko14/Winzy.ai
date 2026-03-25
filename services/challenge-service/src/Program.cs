using Winzy.ChallengeService.Data;
using Winzy.ChallengeService.Endpoints;
using Winzy.ChallengeService.Subscribers;
using Winzy.Common.Health;
using Winzy.Common.Http;
using Winzy.Common.Messaging;
using Winzy.Common.Observability;
using Winzy.Common.Persistence;

var builder = WebApplication.CreateBuilder(args);

builder.AddObservability("challenge-service");
builder.Services.AddServiceDatabase<ChallengeDbContext>(builder.Configuration);
builder.Services.AddNatsMessaging(builder.Configuration);
builder.Services.AddHostedService<HabitCompletedSubscriber>();
builder.Services.AddHostedService<UserDeletedSubscriber>();
builder.Services.AddOpenApi();
builder.Services.AddHealthChecks()
    .AddDbContextCheck<ChallengeDbContext>()
    .AddNatsHealthCheck();

builder.Services.AddServiceHttpClient(builder.Configuration, "SocialService", "SocialServiceUrl", "http://social-service:5003");
builder.Services.AddServiceHttpClient(builder.Configuration, "HabitService", "HabitServiceUrl", "http://habit-service:5002");
builder.Services.AddServiceHttpClient(builder.Configuration, "AuthService", "AuthServiceUrl", "http://auth-service:5001");

var app = builder.Build();

app.UseObservability();
app.MapOpenApi();
app.MapServiceHealthChecks();

// --- Route map ---
app.MapChallengeEndpoints();

app.Run();

// Make Program accessible for WebApplicationFactory in tests
public partial class Program;
