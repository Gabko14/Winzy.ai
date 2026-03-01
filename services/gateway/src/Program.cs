using System.Text;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.IdentityModel.Tokens;
using Winzy.Gateway.Middleware;

var builder = WebApplication.CreateBuilder(args);

// YARP reverse proxy
builder.Services.AddReverseProxy()
    .LoadFromConfig(builder.Configuration.GetSection("ReverseProxy"));

// JWT authentication
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(
                Encoding.UTF8.GetBytes(
                    builder.Configuration["Jwt:Secret"]
                    ?? throw new InvalidOperationException("Jwt:Secret not configured"))),
            ValidateIssuer = false,
            ValidateAudience = false,
            ValidateLifetime = true,
            ClockSkew = TimeSpan.Zero
        };
    });

builder.Services.AddAuthorization(options =>
{
    options.AddPolicy("authenticated", policy => policy.RequireAuthenticatedUser());
});

// Rate limiting
builder.Services.AddRateLimiter(options =>
{
    options.AddPolicy("standard", context =>
        RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            factory: _ => new FixedWindowRateLimiterOptions
            {
                Window = TimeSpan.FromMinutes(1),
                PermitLimit = 100,
                QueueLimit = 0
            }));
    options.AddPolicy("auth", context =>
        RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            factory: _ => new FixedWindowRateLimiterOptions
            {
                Window = TimeSpan.FromMinutes(1),
                PermitLimit = 10,
                QueueLimit = 0
            }));
    options.RejectionStatusCode = 429;
});

// CORS
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.WithOrigins(
                builder.Configuration.GetSection("Cors:Origins").Get<string[]>()
                ?? ["http://localhost:8081"])
            .AllowAnyHeader()
            .AllowAnyMethod()
            .AllowCredentials();
    });
});

// Health checks with downstream service probes
var authUrl = builder.Configuration["ReverseProxy:Clusters:auth-cluster:Destinations:destination1:Address"] ?? "http://auth-service:5001";
var habitUrl = builder.Configuration["ReverseProxy:Clusters:habit-cluster:Destinations:destination1:Address"] ?? "http://habit-service:5002";
var socialUrl = builder.Configuration["ReverseProxy:Clusters:social-cluster:Destinations:destination1:Address"] ?? "http://social-service:5003";
var challengeUrl = builder.Configuration["ReverseProxy:Clusters:challenge-cluster:Destinations:destination1:Address"] ?? "http://challenge-service:5004";
var notificationUrl = builder.Configuration["ReverseProxy:Clusters:notification-cluster:Destinations:destination1:Address"] ?? "http://notification-service:5005";
var activityUrl = builder.Configuration["ReverseProxy:Clusters:activity-cluster:Destinations:destination1:Address"] ?? "http://activity-service:5006";

builder.Services.AddHealthChecks()
    .AddUrlGroup(new Uri($"{authUrl}/health"), "auth-service", tags: ["downstream"])
    .AddUrlGroup(new Uri($"{habitUrl}/health"), "habit-service", tags: ["downstream"])
    .AddUrlGroup(new Uri($"{socialUrl}/health"), "social-service", tags: ["downstream"])
    .AddUrlGroup(new Uri($"{challengeUrl}/health"), "challenge-service", tags: ["downstream"])
    .AddUrlGroup(new Uri($"{notificationUrl}/health"), "notification-service", tags: ["downstream"])
    .AddUrlGroup(new Uri($"{activityUrl}/health"), "activity-service", tags: ["downstream"]);

builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    options.KnownIPNetworks.Clear();
    options.KnownProxies.Clear();
});

var app = builder.Build();

app.UseForwardedHeaders();
app.UseCors();
app.UseRateLimiter();
app.UseMiddleware<InternalRouteBlockMiddleware>();
app.UseAuthentication();
app.UseAuthorization();
app.UseMiddleware<UserIdHeaderMiddleware>();

app.MapHealthChecks("/health");
app.MapReverseProxy();

app.Run();
