using System.Net;
using System.Text;
using System.Text.Json;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.IdentityModel.Tokens;
using Winzy.Gateway.Middleware;

var builder = WebApplication.CreateBuilder(args);

// YARP reverse proxy
builder.Services.AddReverseProxy()
    .LoadFromConfig(builder.Configuration.GetSection("ReverseProxy"));

// JWT secret validation — fail fast if missing, too short, or still the old placeholder
var jwtSecret = builder.Configuration["Jwt:Secret"];
const string oldPlaceholder = "CHANGE-THIS-IN-PRODUCTION-minimum-32-characters-long";

if (string.IsNullOrWhiteSpace(jwtSecret))
    throw new InvalidOperationException(
        "Jwt:Secret is not configured. Set it via environment variable Jwt__Secret, appsettings, or user-secrets.");

if (string.Equals(jwtSecret, oldPlaceholder, StringComparison.Ordinal))
    throw new InvalidOperationException(
        $"Jwt:Secret is still the placeholder value '{oldPlaceholder}'. Provide a real secret.");

if (jwtSecret.Length < 32)
    throw new InvalidOperationException(
        $"Jwt:Secret must be at least 32 characters (got {jwtSecret.Length}). Use a cryptographically random value.");

// JWT authentication
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSecret)),
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

// Forwarded headers: only trust explicitly configured proxies.
// Without configured proxies, X-Forwarded-For headers are ignored, preventing
// clients from forging their IP to bypass rate limiting.
builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;

    var trustedProxies = builder.Configuration.GetSection("ReverseProxy:TrustedProxies").Get<string[]>();
    if (trustedProxies is { Length: > 0 })
    {
        foreach (var entry in trustedProxies)
        {
            if (entry.Contains('/'))
            {
                // CIDR notation (e.g., "172.17.0.0/16") — add as a network range
                var parts = entry.Split('/');
                options.KnownIPNetworks.Add(new System.Net.IPNetwork(IPAddress.Parse(parts[0]), int.Parse(parts[1])));
            }
            else
            {
                // Single IP address
                options.KnownProxies.Add(IPAddress.Parse(entry));
            }
        }
    }
});

var app = builder.Build();

app.UseForwardedHeaders();
app.UseCors();
app.UseRateLimiter();
app.UseMiddleware<InternalRouteBlockMiddleware>();
app.UseAuthentication();
app.UseAuthorization();
app.UseMiddleware<UserIdHeaderMiddleware>();

app.MapHealthChecks("/health", new HealthCheckOptions
{
    ResponseWriter = async (context, report) =>
    {
        context.Response.ContentType = "application/json";

        var checks = report.Entries.ToDictionary(
            entry => entry.Key,
            entry => new
            {
                status = entry.Value.Status.ToString(),
                description = entry.Value.Description,
                duration = entry.Value.Duration.TotalMilliseconds
            });

        var response = new
        {
            status = report.Status.ToString(),
            totalDuration = report.TotalDuration.TotalMilliseconds,
            checks
        };

        await context.Response.WriteAsync(
            JsonSerializer.Serialize(response, new JsonSerializerOptions
            {
                PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
                WriteIndented = true
            }));
    }
});
app.MapReverseProxy();

app.Run();
