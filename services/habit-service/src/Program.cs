using Winzy.Common.Health;
using Winzy.Common.Http;
using Winzy.Common.Messaging;
using Winzy.Common.Observability;
using Winzy.Common.Persistence;
using Winzy.HabitService.Data;
using Winzy.HabitService.Endpoints;
using Winzy.HabitService.Subscribers;

var builder = WebApplication.CreateBuilder(args);

builder.AddObservability("habit-service");
builder.Services.AddServiceDatabase<HabitDbContext>(builder.Configuration);
builder.Services.AddNatsMessaging(builder.Configuration);
builder.Services.AddHostedService<UserDeletedSubscriber>();
builder.Services.AddOpenApi();
builder.Services.AddHealthChecks()
    .AddDbContextCheck<HabitDbContext>()
    .AddNatsHealthCheck();

builder.Services.AddServiceHttpClient(builder.Configuration, "AuthService", "AuthServiceUrl", "http://auth-service:5001");
builder.Services.AddServiceHttpClient(builder.Configuration, "SocialService", "SocialServiceUrl", "http://social-service:5003");

var app = builder.Build();

app.UseObservability();
app.MapOpenApi();
app.MapServiceHealthChecks();

// --- Route map ---
app.MapHabitEndpoints();
app.MapCompletionEndpoints();
app.MapPromiseEndpoints();
app.MapPublicEndpoints();
app.MapInternalEndpoints();

app.Run();

// Make Program accessible for WebApplicationFactory in tests
public partial class Program;
