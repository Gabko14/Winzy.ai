using Winzy.AuthService.Data;
using Winzy.AuthService.Endpoints;
using Winzy.AuthService.Services;
using Winzy.Common.Health;
using Winzy.Common.Messaging;
using Winzy.Common.Observability;
using Winzy.Common.Persistence;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddServiceDatabase<AuthDbContext>(builder.Configuration);
builder.Services.AddNatsMessaging(builder.Configuration);
builder.Services.AddSingleton<PasswordHasher>();
builder.Services.AddSingleton<TokenService>();
builder.Services.AddHttpClient("HabitService", client =>
{
    var url = builder.Configuration["Services:HabitServiceUrl"] ?? "http://habit-service:5002";
    client.BaseAddress = new Uri(url);
    client.Timeout = TimeSpan.FromSeconds(30);
});
builder.Services.AddHttpClient("SocialService", client =>
{
    var url = builder.Configuration["Services:SocialServiceUrl"] ?? "http://social-service:5003";
    client.BaseAddress = new Uri(url);
    client.Timeout = TimeSpan.FromSeconds(30);
});
builder.Services.AddHttpClient("ChallengeService", client =>
{
    var url = builder.Configuration["Services:ChallengeServiceUrl"] ?? "http://challenge-service:5004";
    client.BaseAddress = new Uri(url);
    client.Timeout = TimeSpan.FromSeconds(30);
});
builder.Services.AddHttpClient("NotificationService", client =>
{
    var url = builder.Configuration["Services:NotificationServiceUrl"] ?? "http://notification-service:5005";
    client.BaseAddress = new Uri(url);
    client.Timeout = TimeSpan.FromSeconds(30);
});
builder.Services.AddHttpClient("ActivityService", client =>
{
    var url = builder.Configuration["Services:ActivityServiceUrl"] ?? "http://activity-service:5006";
    client.BaseAddress = new Uri(url);
    client.Timeout = TimeSpan.FromSeconds(30);
});
builder.Services.AddOpenApi();
builder.Services.AddHealthChecks()
    .AddDbContextCheck<AuthDbContext>()
    .AddNatsHealthCheck();

var app = builder.Build();

app.UseObservability();
app.MapOpenApi();
app.MapServiceHealthChecks();
app.MapAuthEndpoints();

app.Run();

public partial class Program;
